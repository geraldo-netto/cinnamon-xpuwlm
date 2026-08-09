"use strict";

const Domain = require("./domain.js");
const FailureReporter = require("./failure-reporter.js");
const RuntimeControl = require("./runtime-control-contract.js");
const WorkloadReconciliation = require("./workload-reconciliation.js");
const WorkloadRegistry = require("./workload-registry.js");

const TABS = Object.freeze(["overview", "profiles", "alerts"]);
const TAB_SET = new Set(TABS);
const RUNTIME_READ_FAILURE = "runtime-read";
const STATE_SAVE_FAILURE = "state-save";
const RUNTIME_CONTROL_FAILURE = "runtime-control";

// Transport failures reach the user as plain guidance; the raw error text
// stays in the log where it belongs.
function controlFailureText(error) {
    const text = String(error);
    if (text.includes("ServiceUnknown") || text.includes("NameHasNoOwner")) {
        return "The runtime service is not running; the change was not applied";
    }
    if (text.includes("TimedOut") || text.includes("Timeout")) {
        return "The runtime service did not respond; the change was not applied";
    }
    return "The runtime service could not apply the change";
}

function sanitizeTab(value) {
    return TAB_SET.has(value) ? value : "overview";
}

function createSilentLogger() {
    return {warn() {}, error() {}};
}

// Freshness still expires without a host timer: every projection re-checks the
// deadline against the clock, the scheduler only makes the change observable.
function createInertScheduler() {
    return {schedule() { return null; }, cancel() { return false; }};
}

function requireRepository(candidate) {
    if (!candidate || typeof candidate.load !== "function" || typeof candidate.save !== "function") {
        throw new TypeError("A profile repository with load/save is required");
    }
    return candidate;
}

function requireClock(candidate) {
    if (!candidate || typeof candidate.now !== "function") {
        throw new TypeError("A clock with now is required");
    }
    return candidate;
}

function requireRuntimeGateway(candidate) {
    if (!candidate || typeof candidate.read !== "function") {
        throw new TypeError("A runtime gateway with read is required");
    }
    return candidate;
}

function requireScheduler(candidate) {
    if (!candidate
        || typeof candidate.schedule !== "function"
        || typeof candidate.cancel !== "function") {
        throw new TypeError("A scheduler with schedule/cancel is required");
    }
    return candidate;
}

class WorkloadManager {
    constructor({
        repository,
        runtimeGateway,
        controlGateway = null,
        errorReporter,
        clock = Date,
        logger = createSilentLogger(),
        scheduler = createInertScheduler(),
        staleAfterMs = Domain.DEFAULT_STALE_AFTER_MS,
        workloadRegistry,
    }) {
        this._repository = requireRepository(repository);
        requireRuntimeGateway(runtimeGateway);
        requireClock(clock);
        this._runtimeGateway = runtimeGateway;
        this._controlGateway = controlGateway === null
            ? null
            : RuntimeControl.requireControlGateway(controlGateway);
        this._clock = clock;
        this._logger = logger;
        this._scheduler = requireScheduler(scheduler);
        this._refreshSequence = 0;
        this._controlSequence = 0;
        this._runtimeRevision = 0;
        this._controlPending = null;
        this._controlMessage = "";
        this._staleAfterMs = Domain.normalizeStaleAfterMs(staleAfterMs);
        this._expiryHandle = null;
        this._errors = FailureReporter.requireFailureReporter(errorReporter, "manager error");
        this._workloadRegistry = WorkloadRegistry.requireWorkloadRegistry(workloadRegistry);
        const initial = WorkloadReconciliation.reconcilePortfolioState(null, this._workloadRegistry);
        this._catalog = initial.catalog;
        this._pluginVersions = initial.state.pluginVersions;
        this._portfolio = new Domain.WorkloadPortfolio(null, this._catalog);
        this._selectedTab = "overview";
        this._snapshot = Domain.unavailableSnapshot("Monitoring has not started", this._clock.now());
        this._listeners = new Set();
        this._started = false;
        this._disposed = false;
    }

    start() {
        this._ensureActive();
        if (this._started) {
            return false;
        }
        try {
            const saved = this._repository.load();
            const reconciled = WorkloadReconciliation.reconcilePortfolioState(
                saved?.portfolio,
                this._workloadRegistry,
            );
            this._catalog = reconciled.catalog;
            this._pluginVersions = reconciled.state.pluginVersions;
            this._portfolio = new Domain.WorkloadPortfolio(reconciled.state, this._catalog);
            this._selectedTab = sanitizeTab(saved?.selectedTab);
            if (reconciled.changed) {
                this._persist();
            }
        } catch (error) {
            this._logger.warn(`Could not load applet state: ${error}`);
            this._portfolio = new Domain.WorkloadPortfolio(null, this._catalog);
            this._selectedTab = "overview";
        }
        this._started = true;
        this.refresh();
        return true;
    }

    refresh() {
        return this._refreshRuntime(false);
    }

    retryDeviceDetection() {
        return this._refreshRuntime(true);
    }

    // Refreshes are asynchronous and sequenced: a completion that arrives after
    // a newer refresh, or after disposal, is discarded instead of publishing
    // state the applet has already moved past.
    _refreshRuntime(forceDeviceDetection) {
        this._ensureActive();
        this._refreshSequence += 1;
        const sequence = this._refreshSequence;
        try {
            this._runtimeGateway.read({forceDeviceDetection}, (snapshot) => {
                this._acceptSnapshot(sequence, snapshot);
            });
            return true;
        } catch (error) {
            this._errors.report(
                RUNTIME_READ_FAILURE,
                `Could not read runtime state: ${error}`,
                this._clock.now(),
            );
            this._acceptSnapshot(sequence, Domain.unavailableSnapshot(
                "Runtime state could not be read",
                this._clock.now(),
                "error",
            ), false);
            return false;
        }
    }

    _acceptSnapshot(sequence, snapshot, recovered = true) {
        if (this._disposed || sequence !== this._refreshSequence) {
            return false;
        }
        this._snapshot = snapshot;
        if (recovered) {
            this._errors.recover(RUNTIME_READ_FAILURE);
        }
        this._scheduleExpiry();
        this._publish();
        return true;
    }

    _scheduleExpiry() {
        this._cancelExpiry();
        const delayMs = Domain.snapshotExpiryDelayMs(
            this._snapshot,
            this._clock.now(),
            this._staleAfterMs,
        );
        if (delayMs === null) {
            return false;
        }
        this._expiryHandle = this._scheduler.schedule(delayMs, () => {
            this._expiryHandle = null;
            this._expireSnapshot();
        });
        return true;
    }

    _cancelRuntimeRead() {
        this._refreshSequence += 1;
        if (typeof this._runtimeGateway.cancel !== "function") {
            return false;
        }
        this._runtimeGateway.cancel();
        return true;
    }

    _cancelExpiry() {
        if (this._expiryHandle === null) {
            return false;
        }
        const handle = this._expiryHandle;
        this._expiryHandle = null;
        this._scheduler.cancel(handle);
        return true;
    }

    _expireSnapshot() {
        if (this._disposed) {
            return false;
        }
        const expired = this._freshSnapshot();
        if (expired === this._snapshot) {
            return false;
        }
        this._snapshot = expired;
        this._publish();
        return true;
    }

    _freshSnapshot() {
        return Domain.expireSnapshot(this._snapshot, this._clock.now(), this._staleAfterMs);
    }

    replaceRuntimeGateway(runtimeGateway) {
        this._ensureActive();
        requireRuntimeGateway(runtimeGateway);
        this._cancelRuntimeRead();
        this._runtimeGateway = runtimeGateway;
        if (this._started) {
            this.refresh();
        }
    }

    selectTab(tab) {
        this._ensureActive();
        const next = sanitizeTab(tab);
        if (next === this._selectedTab) {
            return false;
        }
        this._selectedTab = next;
        this._persist();
        this._publish();
        return true;
    }

    toggleProfile(id) {
        this._ensureActive();
        const profile = this._portfolio.profile(id);
        return this._sendControl("set-profile-enabled", id, !profile.enabled);
    }

    changeWeight(id, delta) {
        this._ensureActive();
        if (!Number.isInteger(delta) || delta === 0) {
            return false;
        }
        const profile = this._portfolio.profile(id);
        const value = Math.max(Domain.MIN_WEIGHT, Math.min(Domain.MAX_WEIGHT, profile.weight + delta));
        if (value === profile.weight) {
            return false;
        }
        return this._sendControl("set-profile-weight", id, value);
    }

    pauseAll() {
        this._ensureActive();
        return this._portfolio.paused ? false : this._sendControl("set-paused", null, true);
    }

    resumeAll() {
        this._ensureActive();
        return this._portfolio.paused ? this._sendControl("set-paused", null, false) : false;
    }

    subscribe(listener) {
        this._ensureActive();
        if (typeof listener !== "function") {
            throw new TypeError("A listener function is required");
        }
        this._listeners.add(listener);
        if (this._started) {
            this._notifyListener(listener);
        }
        return () => {
            const removed = this._listeners.delete(listener);
            this._errors.recover(listener);
            return removed;
        };
    }

    state() {
        const snapshot = this._freshSnapshot();
        const activeAlerts = snapshot.alerts.filter((alert) => !alert.resolved);
        return {
            selectedTab: this._selectedTab,
            paused: this._portfolio.paused,
            profiles: this._portfolio.list(snapshot.profiles),
            device: Domain.aggregateDevice(snapshot.devices, snapshot.health.detail),
            devices: snapshot.devices.map((device) => ({...device})),
            health: {...snapshot.health},
            metrics: {...snapshot.metrics},
            alerts: snapshot.alerts.map((alert) => ({...alert})),
            attentionCount: activeAlerts.length,
            stale: snapshot.stale,
            source: snapshot.source,
            generatedAt: snapshot.generatedAt,
            control: {
                pending: this._controlPending !== null,
                message: this._controlMessage,
            },
        };
    }

    dispose() {
        if (this._disposed) {
            return false;
        }
        this._disposed = true;
        this._cancelExpiry();
        this._cancelRuntimeRead();
        this._cancelRuntimeControl();
        this._errors.recover(RUNTIME_READ_FAILURE);
        this._errors.recover(STATE_SAVE_FAILURE);
        this._errors.recover(RUNTIME_CONTROL_FAILURE);
        for (const listener of this._listeners) {
            this._errors.recover(listener);
        }
        this._listeners.clear();
        return true;
    }

    _sendControl(operation, profileId, value) {
        if (this._controlPending !== null) {
            return false;
        }
        if (this._controlGateway === null) {
            this._controlMessage = "Runtime control service is unavailable; start it and retry";
            this._errors.report(RUNTIME_CONTROL_FAILURE, this._controlMessage, this._clock.now());
            this._publish();
            return false;
        }
        this._controlSequence += 1;
        const sequence = this._controlSequence;
        const command = {
            version: RuntimeControl.CONTROL_VERSION,
            id: `tpuwm-${this._clock.now()}-${sequence}`,
            issuedAt: this._clock.now(),
            expectedRevision: this._runtimeRevision,
            operation,
            profileId,
            value,
        };
        this._controlPending = {sequence, command};
        this._controlMessage = "Applying change in runtime…";
        this._publish();
        try {
            this._controlGateway.send(command, (error, acknowledgement) => {
                this._acceptControl(sequence, error, acknowledgement);
            });
        } catch (error) {
            this._acceptControl(sequence, error, null);
        }
        return true;
    }

    _acceptControl(sequence, error, acknowledgement) {
        if (this._disposed || this._controlPending?.sequence !== sequence) {
            return false;
        }
        this._controlPending = null;
        if (error) {
            this._controlMessage = controlFailureText(error);
            this._errors.report(
                RUNTIME_CONTROL_FAILURE,
                `Runtime did not apply the change: ${error}`,
                this._clock.now(),
            );
            this._publish();
            return false;
        }
        this._runtimeRevision = acknowledgement.revision;
        this._portfolio = new Domain.WorkloadPortfolio(acknowledgement.portfolio, this._catalog);
        if (acknowledgement.status === "rejected") {
            this._controlMessage = acknowledgement.message || "Runtime rejected the change; retry";
            this._errors.report(RUNTIME_CONTROL_FAILURE, this._controlMessage, this._clock.now());
        } else {
            this._controlMessage = "";
            this._errors.recover(RUNTIME_CONTROL_FAILURE);
            this._persist();
        }
        this._publish();
        return acknowledgement.status === "applied";
    }

    _cancelRuntimeControl() {
        this._controlSequence += 1;
        this._controlPending = null;
        return this._controlGateway === null ? false : this._controlGateway.cancel();
    }

    _persist() {
        try {
            this._repository.save({
                portfolio: {
                    ...this._portfolio.serialize(),
                    pluginVersions: {...this._pluginVersions},
                },
                selectedTab: this._selectedTab,
            });
            this._errors.recover(STATE_SAVE_FAILURE);
        } catch (error) {
            this._errors.report(
                STATE_SAVE_FAILURE,
                `Could not save applet state: ${error}`,
                this._clock.now(),
            );
        }
    }

    _publish() {
        for (const listener of this._listeners) {
            this._notifyListener(listener);
        }
    }

    _notifyListener(listener) {
        try {
            listener(this.state());
            this._errors.recover(listener);
        } catch (error) {
            this._errors.report(
                listener,
                `State listener failed: ${error}`,
                this._clock.now(),
            );
        }
    }

    _ensureActive() {
        if (this._disposed) {
            throw new Error("Workload manager is disposed");
        }
    }
}

module.exports = {
    RUNTIME_READ_FAILURE,
    RUNTIME_CONTROL_FAILURE,
    controlFailureText,
    STATE_SAVE_FAILURE,
    TABS,
    WorkloadManager,
    createInertScheduler,
    createSilentLogger,
    requireClock,
    requireRepository,
    requireRuntimeGateway,
    requireScheduler,
    sanitizeTab,
};
