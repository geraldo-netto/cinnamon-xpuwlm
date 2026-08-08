"use strict";

const Domain = require("./domain.js");
const FailureReporter = require("./failure-reporter.js");

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

class WorkloadManager {
    constructor({
        repository,
        runtimeGateway,
        errorReporter,
        clock = Date,
        logger = createSilentLogger(),
    }) {
        if (!repository || typeof repository.load !== "function" || typeof repository.save !== "function") {
            throw new TypeError("A profile repository with load/save is required");
        }
        if (!runtimeGateway || typeof runtimeGateway.read !== "function") {
            throw new TypeError("A runtime gateway with read is required");
        }
        if (!clock || typeof clock.now !== "function") {
            throw new TypeError("A clock with now is required");
        }
        this._repository = repository;
        this._runtimeGateway = runtimeGateway;
        this._clock = clock;
        this._logger = logger;
        this._errors = FailureReporter.requireFailureReporter(errorReporter, "manager error");
        this._portfolio = new Domain.WorkloadPortfolio();
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
            this._portfolio = new Domain.WorkloadPortfolio(saved?.portfolio);
            this._selectedTab = sanitizeTab(saved?.selectedTab);
        } catch (error) {
            this._logger.warn(`Could not load applet state: ${error}`);
            this._portfolio = new Domain.WorkloadPortfolio();
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

    _refreshRuntime(forceDeviceDetection) {
        this._ensureActive();
        try {
            this._snapshot = this._runtimeGateway.read({forceDeviceDetection});
            this._errors.recover(RUNTIME_READ_FAILURE);
        } catch (error) {
            this._errors.report(
                RUNTIME_READ_FAILURE,
                `Could not read runtime state: ${error}`,
                this._clock.now(),
            );
            this._snapshot = Domain.unavailableSnapshot(
                "Runtime state could not be read",
                this._clock.now(),
                "error",
            );
        }
        this._publish();
        return this.state();
    }

    replaceRuntimeGateway(runtimeGateway) {
        this._ensureActive();
        if (!runtimeGateway || typeof runtimeGateway.read !== "function") {
            throw new TypeError("A runtime gateway with read is required");
        }
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
        const activeAlerts = this._snapshot.alerts.filter((alert) => !alert.resolved);
        return {
            selectedTab: this._selectedTab,
            paused: this._portfolio.paused,
            profiles: this._portfolio.list(this._snapshot.profiles),
            device: {...this._snapshot.device},
            metrics: {...this._snapshot.metrics},
            alerts: this._snapshot.alerts.map((alert) => ({...alert})),
            attentionCount: activeAlerts.length,
            stale: this._snapshot.stale,
            source: this._snapshot.source,
            generatedAt: this._snapshot.generatedAt,
        };
    }

    dispose() {
        if (this._disposed) {
            return false;
        }
        this._disposed = true;
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
    createSilentLogger,
    sanitizeTab,
};
