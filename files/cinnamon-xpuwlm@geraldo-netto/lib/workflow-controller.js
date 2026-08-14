"use strict";

// Shared lifecycle mechanics for runtime-backed, one-shot workflows. Workload
// controllers retain selection, submission, result, and cancellation policy.

const Validation = require("./validation.js");

const boundedText = Validation.boundedText;

function requirePort(candidate, methods, label) {
    if (!candidate || methods.some((name) => typeof candidate[name] !== "function")) {
        throw new TypeError(`${label} is required`);
    }
    return candidate;
}

class RuntimeWorkflowController {
    constructor({clock, cloneState, gateway, initialState, labels, pollIntervalMs, scheduler}) {
        this._gateway = requirePort(
            gateway, ["submit", "requestResult", "cancelJob", "cancel"], labels.gateway,
        );
        this._scheduler = requirePort(scheduler, ["schedule", "cancel"], labels.scheduler);
        if (!clock || typeof clock.now !== "function") {
            throw new TypeError(`${labels.clock} is required`);
        }
        this._clock = clock;
        this._cloneState = cloneState;
        this._initialState = initialState;
        this._labels = labels;
        this._pollIntervalMs = pollIntervalMs;
        this._state = initialState();
        this._listeners = new Set();
        this._sequence = 0;
        this._polls = 0;
        this._pollHandle = null;
        this._disposed = false;
    }

    state() {
        return this._cloneState(this._state);
    }

    subscribe(listener) {
        if (typeof listener !== "function") {
            throw new TypeError(`${this._labels.listener} is required`);
        }
        this._listeners.add(listener);
        return () => this._listeners.delete(listener);
    }

    setAvailability(available, detail = "") {
        const next = available === true;
        const text = boundedText(detail, 0, 240) ? detail : "";
        if (next === this._state.available && text === this._state.availabilityDetail) {
            return false;
        }
        this._replace({available: next, availabilityDetail: text});
        return true;
    }

    _schedulePoll(sequence) {
        this._pollHandle = this._scheduler.schedule(this._pollIntervalMs, () => {
            this._pollHandle = null;
            this._poll(sequence);
        });
    }

    _reset(blockedPhases) {
        this._ensureActive();
        if (blockedPhases.includes(this._state.phase)) {
            return false;
        }
        const availability = {
            available: this._state.available,
            availabilityDetail: this._state.availabilityDetail,
        };
        this._state = {...this._initialState(), ...availability};
        this._publish();
        return true;
    }

    _dispose(...cancelPorts) {
        if (this._disposed) {
            return false;
        }
        this._disposed = true;
        this._nextSequence();
        this._clearPoll();
        for (const port of cancelPorts) {
            port.cancel();
        }
        this._gateway.cancel();
        this._listeners.clear();
        this._state = this._initialState();
        return true;
    }

    _replace(patch) {
        this._state = {...this._state, ...patch};
        this._publish();
    }

    _fail(message, phase = "error") {
        this._clearPoll();
        this._replace({
            phase,
            message: boundedText(message, 1, 500) ? message : this._labels.failure,
        });
        return false;
    }

    _publish() {
        for (const listener of this._listeners) {
            try {
                listener(this.state());
            } catch {
                // A view subscriber cannot unwind a transport or scheduler callback.
            }
        }
    }

    _nextSequence() {
        this._sequence += 1;
        return this._sequence;
    }

    _current(sequence) {
        return !this._disposed && sequence === this._sequence;
    }

    _clearPoll() {
        if (this._pollHandle === null) {
            return false;
        }
        this._scheduler.cancel(this._pollHandle);
        this._pollHandle = null;
        return true;
    }

    _ensureActive() {
        if (this._disposed) {
            throw new Error(`${this._labels.disposed} is disposed`);
        }
    }
}

module.exports = {RuntimeWorkflowController, requirePort};
