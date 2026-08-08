"use strict";

const Domain = require("./domain.js");
const FailureReporter = require("./failure-reporter.js");
const WorkloadRegistry = require("./workload-registry.js");

const TABS = Object.freeze(["overview", "profiles", "alerts"]);
const TAB_SET = new Set(TABS);
const RUNTIME_READ_FAILURE = "runtime-read";
const STATE_SAVE_FAILURE = "state-save";

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
        errorReporter,
        clock = Date,
        logger = createSilentLogger(),
        scheduler = createInertScheduler(),
        staleAfterMs = Domain.DEFAULT_STALE_AFTER_MS,
        workloadRegistry = null,
    }) {
        this._repository = requireRepository(repository);
        requireRuntimeGateway(runtimeGateway);
        requireClock(clock);
        this._runtimeGateway = runtimeGateway;
        this._clock = clock;
        this._logger = logger;
        this._scheduler = requireScheduler(scheduler);
        this._refreshSequence = 0;
        this._staleAfterMs = Domain.normalizeStaleAfterMs(staleAfterMs);
        this._expiryHandle = null;
        this._errors = FailureReporter.requireFailureReporter(errorReporter, "manager error");
        this._catalog = workloadRegistry === null
            ? Domain.DEFAULT_WORKLOAD_CATALOG
            : new Domain.WorkloadCatalog(WorkloadRegistry.profileDefinitions(workloadRegistry));
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
            this._portfolio = new Domain.WorkloadPortfolio(saved?.portfolio, this._catalog);
            this._selectedTab = sanitizeTab(saved?.selectedTab);
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
        return this._commitPortfolioChange(() => this._portfolio.setEnabled(id, !profile.enabled));
    }

    changeWeight(id, delta) {
        this._ensureActive();
        return this._commitPortfolioChange(() => this._portfolio.adjustWeight(id, delta));
    }

    pauseAll() {
        this._ensureActive();
        return this._commitPortfolioChange(() => this._portfolio.pauseAll());
    }

    resumeAll() {
        this._ensureActive();
        return this._commitPortfolioChange(() => this._portfolio.resumeAll());
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
            device: {...snapshot.device},
            health: {...snapshot.health},
            metrics: {...snapshot.metrics},
            alerts: snapshot.alerts.map((alert) => ({...alert})),
            attentionCount: activeAlerts.length,
            stale: snapshot.stale,
            source: snapshot.source,
            generatedAt: snapshot.generatedAt,
        };
    }

    dispose() {
        if (this._disposed) {
            return false;
        }
        this._disposed = true;
        this._cancelExpiry();
        this._cancelRuntimeRead();
        this._errors.recover(RUNTIME_READ_FAILURE);
        this._errors.recover(STATE_SAVE_FAILURE);
        for (const listener of this._listeners) {
            this._errors.recover(listener);
        }
        this._listeners.clear();
        return true;
    }

    _commitPortfolioChange(change) {
        const changed = change();
        if (!changed) {
            return false;
        }
        this._persist();
        this._publish();
        return true;
    }

    _persist() {
        try {
            this._repository.save({
                portfolio: this._portfolio.serialize(),
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
