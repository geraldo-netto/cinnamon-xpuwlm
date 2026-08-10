"use strict";

const Domain = require("./domain.js");
const FailureReporter = require("./failure-reporter.js");
const I18n = require("./i18n.js");
const RuntimeControl = require("./runtime-control-contract.js");
const RuntimeRefusal = require("./runtime-refusal-contract.js");
const WorkloadReconciliation = require("./workload-reconciliation.js");
const WorkloadRegistry = require("./workload-registry.js");

const {_, N_} = I18n;

const TABS = Object.freeze(["overview", "profiles", "alerts"]);
const TAB_SET = new Set(TABS);
const RUNTIME_READ_FAILURE = "runtime-read";
const STATE_SAVE_FAILURE = "state-save";
const RUNTIME_CONTROL_FAILURE = "runtime-control";

const NO_CATALOG_CHANGES = Object.freeze({
    installed: Object.freeze([]),
    upgraded: Object.freeze([]),
    removed: Object.freeze([]),
});

function hasCatalogChanges(changes) {
    return changes.installed.length + changes.upgraded.length + changes.removed.length > 0;
}

// Per-caller quotas make a refusal an ordinary outcome, not an edge case, so
// every refusal code gets its own sentence: "could not apply the change" tells
// a rate-limited user nothing about waiting and retrying.
const REFUSAL_TEXTS = Object.freeze({
    "rate-limit-exceeded": N_("The runtime service is rate limiting requests; wait and retry"),
    "concurrency-limit-exceeded": N_("The runtime service is busy with other requests; retry shortly"),
    "payload-too-large": N_("The runtime service rejected the request as too large"),
    "payload-invalid": N_("The runtime service rejected the request as malformed"),
    "identity-asserted": N_("The runtime service rejected a request that asserts its own caller identity"),
    "method-unknown": N_("The runtime service does not support this request; it may be an older version"),
    "quota-invalid": N_("The runtime service has an invalid request quota; the change was not applied"),
});

// A missing service, an unreachable one, an older one that never learned the
// method, and one that answers with something else are four different
// problems with four different remedies. They used to collapse into one
// sentence, which told the user nothing about which of them they had.
const TRANSPORT_FAILURES = Object.freeze([
    Object.freeze([
        /ServiceUnknown|NameHasNoOwner|NoServer/u,
        N_("The runtime service is not running; the change was not applied"),
    ]),
    Object.freeze([
        /TimedOut|Timeout|NoReply/u,
        N_("The runtime service did not respond; the change was not applied"),
    ]),
    Object.freeze([
        /UnknownMethod|UnknownInterface|UnknownObject|UnknownProperty/u,
        N_("The runtime service does not support this request; it may be an older version"),
    ]),
    Object.freeze([
        /AccessDenied|AuthFailed/u,
        N_("The runtime service refused access; the change was not applied"),
    ]),
]);

const UNINTELLIGIBLE_REPLY_TEXT = N_("The runtime service replied in a form this applet cannot read");
const SERVICE_STOPPED_TEXT = N_("The runtime service stopped; changes are not being applied");

// Transport failures reach the user as plain guidance; the raw error text
// stays in the log where it belongs.
function controlFailureText(error) {
    const refusal = RuntimeRefusal.refusalOf(error);
    if (refusal !== null) {
        return _(REFUSAL_TEXTS[refusal.code]);
    }
    if (RuntimeControl.isContractViolation(error)) {
        return _(UNINTELLIGIBLE_REPLY_TEXT);
    }
    const text = String(error);
    for (const [pattern, message] of TRANSPORT_FAILURES) {
        if (pattern.test(text)) {
            return _(message);
        }
    }
    return _("The runtime service could not apply the change");
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

// An optional collaborator is either absent or valid: a present but malformed
// one must still fail loudly at construction rather than at first use.
function optionalPort(candidate, requirePort) {
    return candidate === null ? null : requirePort(candidate);
}

// The bus tells the applet when the control service appears and disappears;
// without that it only ever finds out by failing a command the user issued.
function requireControlWatch(candidate) {
    if (!candidate || typeof candidate.watch !== "function") {
        throw new TypeError("A control service watch with watch is required");
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
        controlWatch = null,
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
        this._controlGateway = optionalPort(controlGateway, RuntimeControl.requireControlGateway);
        this._controlWatch = optionalPort(controlWatch, requireControlWatch);
        this._unwatchControl = null;
        // Tri-state: null until the bus has said anything, so an applet built
        // without a watch never claims the service is absent.
        this._controlServiceAvailable = null;
        this._clock = clock;
        this._logger = logger;
        this._scheduler = requireScheduler(scheduler);
        this._refreshSequence = 0;
        this._controlSequence = 0;
        this._runtimeRevision = 0;
        this._revisionKnown = false;
        this._controlPending = null;
        this._controlMessage = "";
        this._staleAfterMs = Domain.normalizeStaleAfterMs(staleAfterMs);
        this._expiryHandle = null;
        this._errors = FailureReporter.requireFailureReporter(errorReporter, "manager error");
        this._workloadRegistry = WorkloadRegistry.requireWorkloadRegistry(workloadRegistry);
        const initial = WorkloadReconciliation.reconcilePortfolioState(null, this._workloadRegistry);
        this._catalog = initial.catalog;
        this._pluginVersions = initial.state.pluginVersions;
        this._catalogChanges = NO_CATALOG_CHANGES;
        this._portfolio = new Domain.WorkloadPortfolio(null, this._catalog);
        this._selectedTab = "overview";
        this._snapshot = Domain.unavailableSnapshot(_("Monitoring has not started"), this._clock.now());
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
            // A first run installs the whole catalog; announcing that as news
            // would bury the plug-in changes this notice exists to report.
            this._catalogChanges = reconciled.firstRun ? NO_CATALOG_CHANGES : reconciled.changes;
            this._portfolio = new Domain.WorkloadPortfolio(reconciled.state, this._catalog);
            this._selectedTab = sanitizeTab(saved?.selectedTab);
            if (reconciled.changed) {
                this._persist();
            }
        } catch (error) {
            this._logger.warn(`Could not load applet state: ${error}`);
            this._catalogChanges = NO_CATALOG_CHANGES;
            this._portfolio = new Domain.WorkloadPortfolio(null, this._catalog);
            this._selectedTab = "overview";
        }
        this._started = true;
        this._startControlWatch();
        this.refresh();
        return true;
    }

    _startControlWatch() {
        if (this._controlWatch === null) {
            return false;
        }
        const unwatch = this._controlWatch.watch(
            (available) => this._acceptControlAvailability(available),
        );
        this._unwatchControl = typeof unwatch === "function" ? unwatch : null;
        return true;
    }

    // A control service that has just appeared is a fresh instance: its policy
    // revision starts over, so the revision learned from the previous one is
    // forgotten rather than replayed against a runtime that never issued it.
    _acceptControlAvailability(available) {
        if (this._disposed) {
            return false;
        }
        const next = available === true;
        if (this._controlServiceAvailable === next) {
            return false;
        }
        this._controlServiceAvailable = next;
        if (next) {
            this._runtimeRevision = 0;
            this._revisionKnown = false;
            if (this._controlPending === null) {
                this._controlMessage = "";
                this._errors.recover(RUNTIME_CONTROL_FAILURE);
            }
        } else {
            this._controlMessage = _(SERVICE_STOPPED_TEXT);
            this._errors.report(RUNTIME_CONTROL_FAILURE, this._controlMessage, this._clock.now());
        }
        this._publish();
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
                _("Runtime state could not be read"),
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

    // Plug-in installs, upgrades, and removals are announced once. The
    // acknowledgement itself is not persisted: reconciliation already saved the
    // new versions, so the next start has nothing left to report.
    acknowledgeCatalogChanges() {
        this._ensureActive();
        if (!hasCatalogChanges(this._catalogChanges)) {
            return false;
        }
        this._catalogChanges = NO_CATALOG_CHANGES;
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
            catalogChanges: {
                installed: [...this._catalogChanges.installed],
                upgraded: [...this._catalogChanges.upgraded],
                removed: [...this._catalogChanges.removed],
            },
            control: {
                pending: this._controlPending !== null,
                message: this._controlMessage,
                available: this._controlServiceAvailable,
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
        this._stopControlWatch();
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
            this._controlMessage = _("Runtime control service is unavailable; start it and retry");
            this._errors.report(RUNTIME_CONTROL_FAILURE, this._controlMessage, this._clock.now());
            this._publish();
            return false;
        }
        // The bus already told the applet the name has no owner, so the call
        // would only buy the same answer after a five-second timeout.
        if (this._controlServiceAvailable === false) {
            this._controlMessage = _(SERVICE_STOPPED_TEXT);
            this._errors.report(RUNTIME_CONTROL_FAILURE, this._controlMessage, this._clock.now());
            this._publish();
            return false;
        }
        this._controlMessage = _("Applying change in runtime…");
        return this._dispatchControl({operation, profileId, value}, false);
    }

    // The command is rebuilt on every attempt because `expectedRevision` and
    // the command id must both describe the attempt actually being made, not
    // the one that was rejected.
    _dispatchControl(intent, resynchronised) {
        this._controlSequence += 1;
        const sequence = this._controlSequence;
        const command = {
            version: RuntimeControl.CONTROL_VERSION,
            id: `tpuwm-${this._clock.now()}-${sequence}`,
            issuedAt: this._clock.now(),
            expectedRevision: this._runtimeRevision,
            operation: intent.operation,
            profileId: intent.profileId,
            value: intent.value,
        };
        this._controlPending = {sequence, command, intent, resynchronised};
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

    // Nothing tells the applet the runtime's policy revision before it has
    // spoken to the runtime: the snapshot carries no `revision`, so the first
    // command of every session guesses 0 and is rejected for revision drift.
    // That rejection carries the real revision, so the cold guess is corrected
    // and the command is resent once, spending a round trip instead of the
    // user's click. Later drift is a genuine conflict with another writer and
    // is still reported rather than silently overwritten.
    _shouldResynchronise(pending, acknowledgement, revisionKnown) {
        return !revisionKnown
            && !pending.resynchronised
            && acknowledgement.status === "rejected"
            && acknowledgement.revision !== pending.command.expectedRevision;
    }

    _acceptControl(sequence, error, acknowledgement) {
        if (this._disposed || this._controlPending?.sequence !== sequence) {
            return false;
        }
        const pending = this._controlPending;
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
        const revisionKnown = this._revisionKnown;
        this._revisionKnown = true;
        this._runtimeRevision = acknowledgement.revision;
        this._portfolio = new Domain.WorkloadPortfolio(acknowledgement.portfolio, this._catalog);
        if (this._shouldResynchronise(pending, acknowledgement, revisionKnown)) {
            this._dispatchControl(pending.intent, true);
            return false;
        }
        if (acknowledgement.status === "rejected") {
            this._controlMessage = acknowledgement.message || _("Runtime rejected the change; retry");
            this._errors.report(RUNTIME_CONTROL_FAILURE, this._controlMessage, this._clock.now());
        } else {
            this._controlMessage = "";
            this._errors.recover(RUNTIME_CONTROL_FAILURE);
            this._persist();
        }
        this._publish();
        return acknowledgement.status === "applied";
    }

    _stopControlWatch() {
        if (this._unwatchControl === null) {
            return false;
        }
        const unwatch = this._unwatchControl;
        this._unwatchControl = null;
        unwatch();
        return true;
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
    NO_CATALOG_CHANGES,
    REFUSAL_TEXTS,
    RUNTIME_READ_FAILURE,
    RUNTIME_CONTROL_FAILURE,
    SERVICE_STOPPED_TEXT,
    TRANSPORT_FAILURES,
    UNINTELLIGIBLE_REPLY_TEXT,
    controlFailureText,
    STATE_SAVE_FAILURE,
    TABS,
    WorkloadManager,
    createInertScheduler,
    createSilentLogger,
    hasCatalogChanges,
    optionalPort,
    requireClock,
    requireControlWatch,
    requireRepository,
    requireRuntimeGateway,
    requireScheduler,
    sanitizeTab,
};
