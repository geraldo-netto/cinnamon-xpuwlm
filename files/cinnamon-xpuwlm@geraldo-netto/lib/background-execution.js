"use strict";

// Background work never runs from an event callback. A zero-delay dispatch
// yields to Cinnamon, queue growth is bounded/coalesced, and interactive work
// cancels then waits for the active background lease to be released.

const MAX_DEFINITIONS = 64;
const MAX_QUEUED = 64;
const MIN_INTERVAL_MS = 1000;
const MAX_INTERVAL_MS = 24 * 60 * 60 * 1000;
const MAX_IDENTIFIER_LENGTH = 80;
const IDENTIFIER = /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/u;
const TRIGGER_KINDS = Object.freeze(["event", "periodic"]);
const QUEUE_RESULTS = Object.freeze(["queued", "coalesced", "backpressure"]);

class ExecutionError extends Error {
    constructor(code, detail) {
        super(detail);
        this.name = "ExecutionError";
        this.code = code;
    }
}

function isRecord(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value);
}

function exactKeys(value, expected) {
    return isRecord(value)
        && Object.keys(value).length === expected.length
        && expected.every((name) => Object.hasOwn(value, name));
}

function identifier(value) {
    return typeof value === "string"
        && value.length >= 1
        && value.length <= MAX_IDENTIFIER_LENGTH
        && IDENTIFIER.test(value);
}

function validTrigger(trigger) {
    if (!isRecord(trigger) || !TRIGGER_KINDS.includes(trigger.kind)) {
        return false;
    }
    if (trigger.kind === "event") {
        return exactKeys(trigger, ["kind", "event"]) && identifier(trigger.event);
    }
    return exactKeys(trigger, ["kind", "intervalMs"])
        && Number.isSafeInteger(trigger.intervalMs)
        && trigger.intervalMs >= MIN_INTERVAL_MS
        && trigger.intervalMs <= MAX_INTERVAL_MS;
}

function validDefinition(value) {
    return exactKeys(value, ["id", "trigger", "run"])
        && identifier(value.id)
        && validTrigger(value.trigger)
        && typeof value.run === "function";
}

function requirePort(port, methods, label) {
    if (!port || methods.some((name) => typeof port[name] !== "function")) {
        throw new ExecutionError("port-invalid", `${label} port is invalid`);
    }
    return port;
}

class CancellationSignal {
    constructor() {
        this.cancelled = false;
        this.reason = null;
        this._listeners = new Set();
    }

    onCancel(listener) {
        if (typeof listener !== "function") {
            throw new ExecutionError("listener-invalid", "cancellation listener is invalid");
        }
        if (this.cancelled) {
            listener(this.reason);
            return () => false;
        }
        this._listeners.add(listener);
        return () => this._listeners.delete(listener);
    }

    cancel(reason) {
        if (this.cancelled) {
            return false;
        }
        this.cancelled = true;
        this.reason = reason;
        for (const listener of this._listeners) {
            listener(reason);
        }
        this._listeners.clear();
        return true;
    }

    throwIfCancelled() {
        if (this.cancelled) {
            throw new ExecutionError("cancelled", this.reason);
        }
    }
}

class BackgroundExecution {
    constructor({timer, leasePort, reportError, maxQueued = 16}) {
        if (!Number.isSafeInteger(maxQueued) || maxQueued < 1 || maxQueued > MAX_QUEUED) {
            throw new ExecutionError("queue-bound-invalid", "background queue bound is invalid");
        }
        this._timer = requirePort(timer, ["schedule", "cancel"], "timer");
        this._leasePort = requirePort(leasePort, ["acquire"], "lease");
        if (typeof reportError !== "function") {
            throw new ExecutionError("reporter-invalid", "background error reporter is invalid");
        }
        this._reportError = reportError;
        this._maxQueued = maxQueued;
        this._definitions = new Map();
        this._periodicHandles = new Map();
        this._queue = [];
        this._active = null;
        this._interactive = false;
        this._dispatchHandle = null;
        this._idleWaiters = new Set();
        this._disposed = false;
    }

    register(definition) {
        this._ensureActive();
        if (!validDefinition(definition)) {
            throw new ExecutionError("definition-invalid", "background definition is invalid");
        }
        if (this._definitions.has(definition.id) || this._definitions.size >= MAX_DEFINITIONS) {
            throw new ExecutionError("definition-conflict", "background definition conflicts or exceeds its bound");
        }
        const owned = Object.freeze({
            id: definition.id, trigger: Object.freeze({...definition.trigger}), run: definition.run,
        });
        this._definitions.set(owned.id, owned);
        if (owned.trigger.kind === "periodic") {
            this._armPeriodic(owned);
        }
        return () => this.unregister(owned.id);
    }

    unregister(id) {
        const definition = this._definitions.get(id);
        if (definition === undefined) {
            return false;
        }
        this.cancel(id);
        this._definitions.delete(id);
        const handle = this._periodicHandles.get(id);
        if (handle !== undefined) {
            this._timer.cancel(handle);
            this._periodicHandles.delete(id);
        }
        return true;
    }

    _armPeriodic(definition) {
        const handle = this._timer.schedule(definition.trigger.intervalMs, () => {
            this._periodicHandles.delete(definition.id);
            if (!this._disposed && this._definitions.get(definition.id) === definition) {
                this.triggerNow(definition.id, null);
                this._armPeriodic(definition);
            }
        });
        this._periodicHandles.set(definition.id, handle);
    }

    emit(event, payload = null) {
        this._ensureActive();
        if (!identifier(event)) {
            throw new ExecutionError("event-invalid", "background event is invalid");
        }
        return Object.freeze([...this._definitions.values()]
            .filter((definition) => definition.trigger.kind === "event"
                && definition.trigger.event === event)
            .map((definition) => Object.freeze({
                id: definition.id, result: this._enqueue(definition, payload),
            })));
    }

    triggerNow(id, payload = null) {
        this._ensureActive();
        const definition = this._definitions.get(id);
        if (definition === undefined) {
            throw new ExecutionError("definition-missing", `background definition ${id} is missing`);
        }
        return this._enqueue(definition, payload);
    }

    _enqueue(definition, payload) {
        const existing = this._queue.find((item) => item.definition.id === definition.id);
        if (existing !== undefined) {
            existing.payload = payload;
            return "coalesced";
        }
        if (this._queue.length >= this._maxQueued) {
            return "backpressure";
        }
        this._queue.push({definition, payload});
        this._requestDrain();
        return "queued";
    }

    _requestDrain() {
        if (this._disposed || this._interactive || this._active !== null
            || this._dispatchHandle !== null || this._queue.length === 0) {
            this._notifyIdle();
            return false;
        }
        this._dispatchHandle = this._timer.schedule(0, () => {
            this._dispatchHandle = null;
            this._drainOne();
        });
        return true;
    }

    _drainOne() {
        if (this._disposed || this._interactive || this._active !== null) {
            this._notifyIdle();
            return false;
        }
        const queued = this._queue.shift();
        if (queued === undefined) {
            this._notifyIdle();
            return false;
        }
        const signal = new CancellationSignal();
        const active = {id: queued.definition.id, signal, promise: null};
        this._active = active;
        active.promise = this._executeBackground(queued, active);
        return true;
    }

    async _executeBackground(queued, active) {
        let lease = null;
        try {
            lease = await this._acquire("background", queued.definition.id);
            active.signal.throwIfCancelled();
            await queued.definition.run(Object.freeze({
                priority: "background", payload: queued.payload, signal: active.signal, lease,
            }));
        } catch (error) {
            if (!(error instanceof ExecutionError && error.code === "cancelled")) {
                this._reportError(queued.definition.id, error);
            }
        } finally {
            this._release(lease, queued.definition.id);
            if (this._active === active) {
                this._active = null;
            }
            this._requestDrain();
            this._notifyIdle();
        }
    }

    async _acquire(priority, id) {
        const lease = await this._leasePort.acquire(Object.freeze({priority, id}));
        if (!lease || typeof lease.release !== "function") {
            throw new ExecutionError("lease-invalid", "execution lease is invalid");
        }
        return lease;
    }

    _release(lease, id) {
        if (lease === null) {
            return false;
        }
        try {
            lease.release();
        } catch (error) {
            this._reportError(id, error);
        }
        return true;
    }

    cancel(id) {
        const before = this._queue.length;
        this._queue = this._queue.filter((item) => item.definition.id !== id);
        const queued = this._queue.length !== before;
        const running = this._active !== null && this._active.id === id
            ? this._active.signal.cancel("cancelled-by-user")
            : false;
        this._notifyIdle();
        return queued || running;
    }

    async runInteractive({id, run}) {
        this._ensureActive();
        if (!identifier(id) || typeof run !== "function") {
            throw new ExecutionError("interactive-invalid", "interactive execution is invalid");
        }
        if (this._interactive) {
            throw new ExecutionError("interactive-busy", "interactive execution is already active");
        }
        this._interactive = true;
        const background = this._active;
        if (background !== null) {
            background.signal.cancel("interactive-preemption");
            await background.promise;
        }
        let lease = null;
        try {
            lease = await this._acquire("interactive", id);
            return await run(Object.freeze({priority: "interactive", lease}));
        } finally {
            this._release(lease, id);
            this._interactive = false;
            this._requestDrain();
            this._notifyIdle();
        }
    }

    state() {
        return Object.freeze({
            disposed: this._disposed,
            interactive: this._interactive,
            activeBackgroundId: this._active === null ? null : this._active.id,
            queuedIds: Object.freeze(this._queue.map((item) => item.definition.id)),
            dispatchPending: this._dispatchHandle !== null,
        });
    }

    idle() {
        if (this._isIdle()) {
            return Promise.resolve();
        }
        return new Promise((resolve) => this._idleWaiters.add(resolve));
    }

    _isIdle() {
        return this._active === null && !this._interactive
            && this._queue.length === 0 && this._dispatchHandle === null;
    }

    _notifyIdle() {
        if (!this._isIdle()) {
            return false;
        }
        for (const resolve of this._idleWaiters) {
            resolve();
        }
        this._idleWaiters.clear();
        return true;
    }

    dispose() {
        if (this._disposed) {
            return false;
        }
        this._disposed = true;
        if (this._dispatchHandle !== null) {
            this._timer.cancel(this._dispatchHandle);
            this._dispatchHandle = null;
        }
        for (const handle of this._periodicHandles.values()) {
            this._timer.cancel(handle);
        }
        this._periodicHandles.clear();
        this._definitions.clear();
        this._queue = [];
        if (this._active !== null) {
            this._active.signal.cancel("disposed");
        }
        this._notifyIdle();
        return true;
    }

    _ensureActive() {
        if (this._disposed) {
            throw new ExecutionError("disposed", "background execution is disposed");
        }
    }
}

module.exports = {
    MAX_DEFINITIONS,
    MAX_QUEUED,
    MIN_INTERVAL_MS,
    MAX_INTERVAL_MS,
    MAX_IDENTIFIER_LENGTH,
    TRIGGER_KINDS,
    QUEUE_RESULTS,
    ExecutionError,
    CancellationSignal,
    BackgroundExecution,
    validTrigger,
    validDefinition,
};
