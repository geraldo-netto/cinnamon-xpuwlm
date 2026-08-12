"use strict";

const Domain = require("./domain.js");
const FailureReporter = require("./failure-reporter.js");
const I18n = require("./i18n.js");
const Job = require("./runtime-job-contract.js");
const JobSubmission = require("./job-submission.js");
const RuntimeContract = require("./runtime-contract.js");
const RuntimeControl = require("./runtime-control-contract.js");
const RuntimeRefusal = require("./runtime-refusal-contract.js");
const WorkloadReconciliation = require("./workload-reconciliation.js");
const WorkloadRegistry = require("./workload-registry.js");

const {_, N_} = I18n;

const TABS = Object.freeze(["overview", "profiles", "alerts", "setup"]);
const TAB_SET = new Set(TABS);
const RUNTIME_READ_FAILURE = "runtime-read";
const STATE_SAVE_FAILURE = "state-save";
const RUNTIME_CONTROL_FAILURE = "runtime-control";
const RUNTIME_CONTRACT_FAILURE = "runtime-contract";
const RUNTIME_JOB_FAILURE = "runtime-job";

const NO_JOB = Object.freeze({
    pending: false,
    profileId: "",
    sourceName: "",
    jobId: "",
    status: "",
    code: "",
    message: "",
    state: "",
    progress: null,
    reading: null,
});

// A job is accepted in milliseconds and finishes when it finishes: the queue
// is shared with every other profile and the model may still be loading. The
// interval is short enough that a 20 ms inference reads as immediate and the
// ceiling long enough to outlast a cold model load, after which the applet
// stops asking and says so rather than polling a runtime that has forgotten
// the job.
const JOB_POLL_INTERVAL_MS = 400;
const MAX_JOB_POLLS = 150;
const JOB_ABANDONED_TEXT = N_("The runtime did not report an outcome for this job; it may still be running");
const JOB_UNPOLLABLE_TEXT = N_("This runtime cannot report job outcomes; the job was accepted");

// Why a picture could not be turned into this profile's input. Every one of
// these is a fact the manifest states or fails to state, so the sentence names
// the profile's declaration rather than blaming the user's file — except the
// three that genuinely are about the file.
const JOB_REFUSAL_TEXTS = Object.freeze({
    "contract-absent": N_("This profile does not state what input it needs, so no picture can be prepared for it"),
    "dtype-unsupported": N_("This profile needs an input this applet cannot build from a picture"),
    "rank-unsupported": N_("This profile does not take a single picture as its input"),
    "batch-unsupported": N_("This profile takes more than one picture at a time"),
    "layout-unsupported": N_("This profile does not state how its input is laid out"),
    "channels-unsupported": N_("This profile wants a channel count a picture cannot fill"),
    "preprocess-undeclared": N_("This profile does not state how a picture becomes its input"),
    "normalisation-mismatch": N_("This profile's normalisation does not match its channel count"),
    "tensor-too-large": N_("This profile wants an input larger than the runtime accepts"),
    "image-decode-failed": N_("That file could not be read as a picture"),
    "image-invalid": N_("That file could not be read as a picture"),
    "image-truncated": N_("That picture is incomplete"),
    "image-size-mismatch": N_("That picture could not be resized to what this profile needs"),
    "staging-write-failed": N_("The input buffer could not be written where the runtime reads"),
    "staging-name-invalid": N_("The input buffer could not be given a usable name"),
    // Asking what became of a job changes nothing, so the control vocabulary's
    // "could not apply the change" would describe a failure that never
    // happened.
    "job-result-unavailable": N_("The runtime did not say what became of this job; it may still be running"),
});

const NO_INPUT_ROOTS_TEXT
    = N_("The runtime service is not configured to read input files; no picture can be submitted");
const JOB_PREPARING_TEXT = N_("Preparing the picture…");

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
// Said before anything is attempted, which is the whole point: after the fact
// a version mismatch is indistinguishable from a service that is simply down.
const CONTRACT_MISMATCH_TEXT
    = N_("This applet and the runtime service speak different versions; update whichever is older");
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

// A job can fail as a picture, as a contract, or as a bus call. The first two
// have their own sentences; the third already had one, so it is reused rather
// than duplicated with different wording for the same condition.
function jobFailureText(error) {
    const code = JobSubmission.refusalCode(error);
    return code !== null && Object.hasOwn(JOB_REFUSAL_TEXTS, code)
        ? _(JOB_REFUSAL_TEXTS[code])
        : controlFailureText(error);
}

function sanitizeTab(value) {
    return TAB_SET.has(value) ? value : "overview";
}

function sanitizeActivityClearedAt(value) {
    return Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

// Every method the manager calls, checked at construction. A port that is
// missing one fails here rather than at the moment a user is waiting for the
// outcome of a job that has already run.
const JOB_SUBMITTER_METHODS = Object.freeze([
    "submit", "cancel", "discard", "requestResult", "cancelResult", "sweepStaged",
]);

function requireJobSubmitter(candidate) {
    if (!candidate || JOB_SUBMITTER_METHODS.some((name) => typeof candidate[name] !== "function")) {
        throw new TypeError(
            `A job submitter with ${JOB_SUBMITTER_METHODS.join("/")} is required`,
        );
    }
    return candidate;
}

function requireInputCatalog(candidate) {
    if (!candidate || (typeof candidate.pictures !== "function"
            && typeof candidate.picturesAsync !== "function")) {
        throw new TypeError("An input catalog with pictures or picturesAsync is required");
    }
    return candidate;
}

function validPictureListing(candidate) {
    return Boolean(candidate)
        && Array.isArray(candidate.pictures)
        && Number.isSafeInteger(candidate.omitted)
        && candidate.omitted >= 0;
}

// What each profile declares about its input, read once from the same registry
// the catalog comes from. A descriptor that declares nothing maps to null,
// which the encoder refuses with `contract-absent` rather than guessing.
function inputContracts(registry) {
    const contracts = new Map();
    for (const descriptor of registry.descriptors()) {
        contracts.set(descriptor.id, typeof descriptor.inputContract === "function"
            ? descriptor.inputContract()
            : null);
    }
    return contracts;
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
function requireContractGateway(candidate) {
    if (!candidate
        || typeof candidate.describe !== "function"
        || typeof candidate.cancel !== "function") {
        throw new TypeError("A runtime contract gateway with describe/cancel is required");
    }
    return candidate;
}

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
        contractGateway = null,
        controlGateway = null,
        controlWatch = null,
        jobSubmitter,
        inputCatalog,
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
        this._contractGateway = optionalPort(contractGateway, requireContractGateway);
        this._contract = RuntimeContract.RuntimeContract.unknown();
        this._contractSequence = 0;
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
        this._attachJobPorts(jobSubmitter, inputCatalog);
        const initial = WorkloadReconciliation.reconcilePortfolioState(null, this._workloadRegistry);
        this._catalog = initial.catalog;
        this._pluginVersions = initial.state.pluginVersions;
        this._catalogChanges = NO_CATALOG_CHANGES;
        this._portfolio = new Domain.WorkloadPortfolio(null, this._catalog);
        this._selectedTab = "overview";
        this._activityClearedAt = 0;
        this._unknownContentKey = null;
        this._snapshot = Domain.unavailableSnapshot(_("Monitoring has not started"), this._clock.now());
        this._listeners = new Set();
        this._started = false;
        this._disposed = false;
    }

    // Both ports are optional: an applet built without them still monitors and
    // still changes policy, and says so rather than offering a control that
    // cannot work.
    _attachJobPorts(jobSubmitter, inputCatalog) {
        this._jobSubmitter = optionalPort(jobSubmitter ?? null, requireJobSubmitter);
        this._inputCatalog = optionalPort(inputCatalog ?? null, requireInputCatalog);
        this._inputContracts = inputContracts(this._workloadRegistry);
        this._pictures = [];
        this._omittedPictures = 0;
        this._listedRoots = "";
        this._inputListSequence = 0;
        this._cancelInputList = null;
        this._job = NO_JOB;
        this._jobPending = null;
        this._jobSequence = 0;
        this._polling = null;
        this._pollHandle = null;
        this._swept = false;
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
            this._activityClearedAt = sanitizeActivityClearedAt(saved?.activityClearedAt);
            if (reconciled.changed) {
                this._persist();
            }
        } catch (error) {
            this._logger.warn(`Could not load applet state: ${error}`);
            this._catalogChanges = NO_CATALOG_CHANGES;
            this._portfolio = new Domain.WorkloadPortfolio(null, this._catalog);
            this._selectedTab = "overview";
            this._activityClearedAt = 0;
        }
        this._started = true;
        this._startControlWatch();
        this._describeContract();
        this.refresh();
        return true;
    }

    // Asked once when the applet starts and again whenever the name changes
    // owner, because a service that has just appeared may be a different build
    // from the one that answered before. Nothing waits on the answer: an
    // applet that blocked its first paint on a handshake would show nothing at
    // all against a service that is merely slow.
    _describeContract() {
        if (this._contractGateway === null) {
            return false;
        }
        this._contractSequence += 1;
        const sequence = this._contractSequence;
        try {
            this._contractGateway.describe((error, contract) => {
                this._acceptContract(sequence, error, contract);
            });
        } catch (error) {
            this._acceptContract(sequence, error, null);
        }
        return true;
    }

    // A handshake that fails is not reported. It leaves the applet knowing no
    // less than before it asked, and every reason it can fail — an older
    // service without the method, a refusal, a service that stopped mid-call —
    // is already reported by whichever call actually needed it.
    _acceptContract(sequence, error, contract) {
        if (this._disposed || sequence !== this._contractSequence) {
            return false;
        }
        if (error || !contract) {
            this._contract = RuntimeContract.RuntimeContract.unknown();
            this._errors.recover(RUNTIME_CONTRACT_FAILURE);
            this._publish();
            return false;
        }
        this._contract = contract;
        if (contract.compatible) {
            this._errors.recover(RUNTIME_CONTRACT_FAILURE);
        } else {
            this._errors.report(
                RUNTIME_CONTRACT_FAILURE,
                _(CONTRACT_MISMATCH_TEXT),
                this._clock.now(),
            );
        }
        this._publish();
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
            this._describeContract();
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
        this._reportUnknownContent(snapshot);
        this._sweepOnce(this._inputRoots());
        this._relistPictures(false);
        if (recovered) {
            this._errors.recover(RUNTIME_READ_FAILURE);
        }
        this._scheduleExpiry();
        this._publish();
        return true;
    }

    // Logged once per change rather than once per poll: a runtime and an applet
    // whose catalogs disagree stay disagreeing for as long as the plug-in is
    // missing, and a line every refresh interval would bury everything else.
    _reportUnknownContent(snapshot) {
        const unknown = snapshot.unknownContent || Domain.NO_UNKNOWN_CONTENT;
        const key = `${unknown.profiles}:${unknown.alerts}`;
        if (key === this._unknownContentKey) {
            return false;
        }
        this._unknownContentKey = key;
        if (unknown.profiles + unknown.alerts === 0) {
            return false;
        }
        this._logger.warn(
            `Runtime snapshot describes ${unknown.profiles} profile(s) and ${unknown.alerts} `
            + "alert(s) for workloads this applet does not have installed",
        );
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

    // Production listing is asynchronous and cancellable. The synchronous port
    // remains only for minimal embedders and deterministic test doubles.
    _relistPictures(force) {
        const roots = this._inputRoots();
        const key = JSON.stringify(roots);
        if (this._inputCatalog === null || (!force && key === this._listedRoots)) {
            return false;
        }
        this._listedRoots = key;
        if (typeof this._inputCatalog.picturesAsync === "function") {
            return this._relistPicturesAsync(roots);
        }
        try {
            const listed = this._inputCatalog.pictures(roots);
            this._pictures = listed.pictures;
            this._omittedPictures = listed.omitted;
        } catch (error) {
            this._pictures = [];
            this._omittedPictures = 0;
            this._logger.warn(`Could not list runtime input files: ${error}`);
        }
        return true;
    }

    _relistPicturesAsync(roots) {
        this._cancelInputListing();
        this._inputListSequence += 1;
        const sequence = this._inputListSequence;
        let completed = false;
        try {
            const cancel = this._inputCatalog.picturesAsync(roots, (error, listed) => {
                completed = true;
                this._acceptPictures(sequence, error, listed);
            });
            this._cancelInputList = !completed && typeof cancel === "function" ? cancel : null;
        } catch (error) {
            this._acceptPictures(sequence, error, null);
        }
        return true;
    }

    _acceptPictures(sequence, error, listed) {
        if (this._disposed || sequence !== this._inputListSequence) {
            return false;
        }
        this._cancelInputList = null;
        if (error || !validPictureListing(listed)) {
            this._pictures = [];
            this._omittedPictures = 0;
            this._logger.warn(`Could not list runtime input files: ${error || "invalid result"}`);
        } else {
            this._pictures = listed.pictures;
            this._omittedPictures = listed.omitted;
        }
        this._publish();
        return !error;
    }

    _cancelInputListing() {
        this._inputListSequence += 1;
        if (this._cancelInputList === null) {
            return false;
        }
        const cancel = this._cancelInputList;
        this._cancelInputList = null;
        return cancel();
    }

    // The profiles a picture could actually be prepared for, decided from the
    // manifest alone. A profile that declares nothing is absent from this list
    // rather than offered and refused after the user has chosen a file.
    _runnableProfiles() {
        const runnable = [];
        for (const [id, spec] of this._inputContracts) {
            if (JobSubmission.encodingRefusalFor(spec) === null) {
                runnable.push(id);
            }
        }
        return runnable;
    }

    // Once per session, the first time the runtime tells us where its roots
    // are: before that there is no directory to sweep.
    _sweepOnce(roots) {
        if (this._swept || this._jobSubmitter === null || roots.length === 0) {
            return false;
        }
        this._swept = true;
        const removed = this._jobSubmitter.sweepStaged(roots);
        if (removed > 0) {
            this._logger.warn(
                `Removed ${removed} input buffer(s) left by a job that never reported an outcome`,
            );
        }
        return true;
    }

    _inputRoots() {
        return [...(this._snapshot.inputs || Domain.NO_INPUT_ROOTS).roots];
    }

    refreshInputs() {
        this._ensureActive();
        const changed = this._relistPictures(true);
        if (changed) {
            this._publish();
        }
        return changed;
    }

    // What this profile would need before it could run a picture, or the empty
    // string when it could run one now. Answered from the manifest alone, so
    // the surface can say why a profile is not offered instead of offering it
    // and refusing after the user has chosen a file.
    jobBlocker(profileId) {
        const refusal = JobSubmission.encodingRefusalFor(this._inputContracts.get(profileId));
        if (refusal !== null) {
            return _(JOB_REFUSAL_TEXTS[refusal] ?? JOB_REFUSAL_TEXTS["contract-absent"]);
        }
        return this._inputRoots().length === 0 ? _(NO_INPUT_ROOTS_TEXT) : "";
    }

    submitJob(profileId, picture) {
        this._ensureActive();
        if (this._jobPending !== null) {
            return false;
        }
        const refusal = this._jobPrecondition(profileId, picture);
        if (refusal !== "") {
            return this._reportJobFailure(refusal);
        }
        return this._dispatchJob(profileId, picture);
    }

    _jobPrecondition(profileId, picture) {
        if (this._jobSubmitter === null) {
            return _("Runtime job service is unavailable; start it and retry");
        }
        if (this._controlServiceAvailable === false) {
            return _(SERVICE_STOPPED_TEXT);
        }
        if (!picture || typeof picture.path !== "string" || typeof picture.root !== "string") {
            return _("No picture was chosen");
        }
        return this.jobBlocker(profileId);
    }

    _dispatchJob(profileId, picture) {
        this._jobSequence += 1;
        const sequence = this._jobSequence;
        const sourceName = typeof picture.name === "string" ? picture.name : "";
        this._jobPending = {sequence, profileId, sourceName};
        this._job = {
            ...NO_JOB,
            pending: true,
            profileId,
            sourceName,
            message: _(JOB_PREPARING_TEXT),
        };
        this._publish();
        try {
            this._jobSubmitter.submit({
                workloadId: profileId,
                spec: this._inputContracts.get(profileId),
                sourcePath: picture.path,
                stagingRoot: picture.root,
            }, (error, acknowledgement) => this._acceptJob(sequence, error, acknowledgement));
        } catch (error) {
            this._acceptJob(sequence, error, null);
        }
        return true;
    }

    _acceptJob(sequence, error, acknowledgement) {
        if (this._disposed || this._jobPending?.sequence !== sequence) {
            return false;
        }
        const pending = this._jobPending;
        this._jobPending = null;
        if (error) {
            this._job = {...NO_JOB, profileId: pending.profileId, sourceName: pending.sourceName};
            this._reportJobFailure(jobFailureText(error), `Runtime did not accept the job: ${error}`);
            return false;
        }
        this._job = {
            ...NO_JOB,
            profileId: pending.profileId,
            sourceName: pending.sourceName,
            jobId: acknowledgement.jobId || "",
            status: acknowledgement.status,
            code: acknowledgement.code,
            message: acknowledgement.message,
        };
        this._settleJobOutcome(acknowledgement);
        this._publish();
        return acknowledgement.status === "accepted";
    }

    _settleJobOutcome(acknowledgement) {
        if (acknowledgement.status === "accepted") {
            this._errors.recover(RUNTIME_JOB_FAILURE);
            this._startPolling(acknowledgement);
            return;
        }
        // A refused job never ran, so the buffer staged for it will never be
        // read; the accepted case keeps it until the job reaches a state it
        // cannot leave.
        this._discardStaged(acknowledgement);
        this._errors.report(RUNTIME_JOB_FAILURE, acknowledgement.message, this._clock.now());
    }

    _discardStaged(acknowledgement) {
        const staged = acknowledgement?.stagedPath;
        if (this._jobSubmitter !== null && typeof staged === "string") {
            this._jobSubmitter.discard(staged);
        }
    }

    // An acknowledgement says the runtime took the job, not that it worked. A
    // job that is accepted and then fails during inference used to read as
    // accepted forever, which is the failure this surface exists to remove.
    _startPolling(acknowledgement) {
        this._cancelPolling();
        if (!acknowledgement.jobId || this._jobSubmitter.pollable !== true) {
            this._job = {...this._job, message: acknowledgement.jobId
                ? _(JOB_UNPOLLABLE_TEXT)
                : this._job.message};
            return false;
        }
        this._polling = {
            jobId: acknowledgement.jobId,
            stagedPath: acknowledgement.stagedPath ?? null,
            attempts: 0,
            sequence: this._jobSequence,
        };
        this._schedulePoll();
        return true;
    }

    _schedulePoll() {
        this._pollHandle = this._scheduler.schedule(JOB_POLL_INTERVAL_MS, () => {
            this._pollHandle = null;
            this._pollJob();
        });
    }

    _pollJob() {
        const polling = this._polling;
        if (this._disposed || polling === null) {
            return false;
        }
        polling.attempts += 1;
        if (polling.attempts > MAX_JOB_POLLS) {
            return this._abandonPolling();
        }
        this._jobSubmitter.requestResult(polling.jobId, (error, result) => {
            this._acceptResult(polling.sequence, error, result);
        });
        return true;
    }

    // Giving up is reported rather than hidden: the job may still be running,
    // and saying nothing would leave the last message claiming it was accepted
    // while the applet quietly stopped caring.
    _abandonPolling() {
        this._job = {...this._job, message: _(JOB_ABANDONED_TEXT)};
        this._cancelPolling();
        this._publish();
        return false;
    }

    _acceptResult(sequence, error, result) {
        if (this._disposed || this._polling === null || this._polling.sequence !== sequence) {
            return false;
        }
        if (error) {
            // One unreadable poll is not an outcome; the next one may answer.
            this._schedulePoll();
            return false;
        }
        this._job = {
            ...this._job,
            state: result.state,
            code: result.code,
            message: result.message || this._job.message,
            progress: result.progress ?? null,
            reading: Job.readingOf(result.output),
        };
        this._settleResult(result);
        this._publish();
        return true;
    }

    _settleResult(result) {
        if (!Job.isTerminalState(result.state)) {
            this._schedulePoll();
            return false;
        }
        // The job will not read its input again, whatever it decided.
        this._discardStaged({stagedPath: this._polling.stagedPath});
        this._cancelPolling(false);
        if (result.state === "succeeded") {
            this._errors.recover(RUNTIME_JOB_FAILURE);
        } else {
            this._errors.report(
                RUNTIME_JOB_FAILURE,
                `Job ${result.jobId} ${result.state}: ${result.code}`,
                this._clock.now(),
            );
        }
        return true;
    }

    // `discardStaged` is deliberate rather than incidental: abandoning a poll
    // means this applet will never learn the outcome, so the buffer it staged
    // has no remaining reader here. Dispatch re-reads the file at execution,
    // so removing it can only race a job that is already failing — whereas
    // leaving it orphans ~600 KB in a directory the user owns, every time the
    // applet reloads mid-job.
    _cancelPolling(discardStaged = true) {
        const polling = this._polling;
        this._polling = null;
        if (this._pollHandle !== null) {
            this._scheduler.cancel(this._pollHandle);
            this._pollHandle = null;
        }
        if (this._jobSubmitter === null) {
            return false;
        }
        if (discardStaged && polling !== null && polling.stagedPath) {
            this._jobSubmitter.discard(polling.stagedPath);
        }
        return this._jobSubmitter.cancelResult();
    }

    _reportJobFailure(message, logged = null) {
        this._job = {...this._job, pending: false, message};
        this._errors.report(RUNTIME_JOB_FAILURE, logged ?? message, this._clock.now());
        this._publish();
        return false;
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

    clearActivity() {
        this._ensureActive();
        const jobRunning = this._job.pending === true || this._job.state === "running";
        const hadJob = Boolean(this._job.profileId);
        this._activityClearedAt = this._clock.now();
        if (!jobRunning) {
            this._job = NO_JOB;
        }
        this._persist();
        this._publish();
        return hadJob || this._snapshot.alerts.some(
            (alert) => alert.resolved && alert.timestamp <= this._activityClearedAt,
        );
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
        const visibleAlerts = snapshot.alerts.filter(
            (alert) => !alert.resolved || alert.timestamp > this._activityClearedAt,
        );
        return {
            selectedTab: this._selectedTab,
            paused: this._portfolio.paused,
            profiles: this._portfolio.list(snapshot.profiles),
            device: Domain.aggregateDevice(snapshot.devices, snapshot.health.detail),
            devices: snapshot.devices.map((device) => ({...device})),
            health: {...snapshot.health},
            metrics: {...snapshot.metrics},
            alerts: visibleAlerts.map((alert) => ({...alert})),
            attentionCount: activeAlerts.length,
            unknownContent: {...(snapshot.unknownContent || Domain.NO_UNKNOWN_CONTENT)},
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
            contract: this._contract.describe(),
            job: {...this._job},
            inputs: {
                roots: this._inputRoots(),
                pictures: this._pictures.map((picture) => ({...picture})),
                omitted: this._omittedPictures,
                runnable: this._runnableProfiles(),
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
        this._cancelContract();
        this._cancelJob();
        this._cancelInputListing();
        this._stopControlWatch();
        if (typeof this._repository.flush === "function") {
            try {
                this._repository.flush();
            } catch (error) {
                this._logger.warn(`Could not flush applet state: ${error}`);
            }
        }
        this._errors.recover(RUNTIME_READ_FAILURE);
        this._errors.recover(STATE_SAVE_FAILURE);
        this._errors.recover(RUNTIME_CONTROL_FAILURE);
        this._errors.recover(RUNTIME_CONTRACT_FAILURE);
        this._errors.recover(RUNTIME_JOB_FAILURE);
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
            id: `xpuwlm-${this._clock.now()}-${sequence}`,
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

    _cancelJob() {
        this._jobSequence += 1;
        this._jobPending = null;
        this._cancelPolling();
        return this._jobSubmitter === null ? false : this._jobSubmitter.cancel();
    }

    _cancelContract() {
        this._contractSequence += 1;
        return this._contractGateway === null ? false : this._contractGateway.cancel();
    }

    _persist() {
        const state = {
            portfolio: {
                ...this._portfolio.serialize(),
                pluginVersions: {...this._pluginVersions},
            },
            selectedTab: this._selectedTab,
            activityClearedAt: this._activityClearedAt,
        };
        let completed = false;
        const completion = (error) => {
            completed = true;
            if (error) {
                this._errors.report(
                    STATE_SAVE_FAILURE,
                    `Could not save applet state: ${error}`,
                    this._clock.now(),
                );
            } else {
                this._errors.recover(STATE_SAVE_FAILURE);
            }
        };
        try {
            const asynchronous = this._repository.save(state, completion);
            if (asynchronous !== true && !completed) {
                this._errors.recover(STATE_SAVE_FAILURE);
            }
        } catch (error) {
            completion(error);
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
    RUNTIME_JOB_FAILURE,
    SERVICE_STOPPED_TEXT,
    TRANSPORT_FAILURES,
    UNINTELLIGIBLE_REPLY_TEXT,
    JOB_ABANDONED_TEXT,
    JOB_SUBMITTER_METHODS,
    JOB_POLL_INTERVAL_MS,
    JOB_REFUSAL_TEXTS,
    MAX_JOB_POLLS,
    NO_JOB,
    controlFailureText,
    inputContracts,
    jobFailureText,
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
    requireInputCatalog,
    requireJobSubmitter,
    requireRuntimeGateway,
    requireScheduler,
    sanitizeTab,
    sanitizeActivityClearedAt,
    validPictureListing,
};
