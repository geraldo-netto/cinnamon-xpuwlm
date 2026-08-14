"use strict";

const I18n = require("./i18n.js");
const Job = require("./runtime-job-contract.js");
const JobSubmission = require("./job-submission.js");

const {_, N_} = I18n;

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

// Every method the controller calls, checked at construction. A port that is
// missing one fails here rather than when a user is waiting for an outcome.
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

function optionalPort(candidate, requirePort) {
    return candidate === null ? null : requirePort(candidate);
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

function jobFailureText(error, fallback) {
    const code = JobSubmission.refusalCode(error);
    return code !== null && Object.hasOwn(JOB_REFUSAL_TEXTS, code)
        ? _(JOB_REFUSAL_TEXTS[code])
        : fallback(error);
}

class WorkloadRuntimeController {
    constructor({
        jobSubmitter,
        inputCatalog,
        workloadRegistry,
        errorReporter,
        clock,
        logger,
        scheduler,
        publish,
        inputRoots,
        controlAvailable,
        managerDisposed,
        fallbackFailureText,
        serviceStoppedText,
    }) {
        this._jobSubmitter = optionalPort(jobSubmitter ?? null, requireJobSubmitter);
        this._inputCatalog = optionalPort(inputCatalog ?? null, requireInputCatalog);
        this._inputContracts = inputContracts(workloadRegistry);
        this._errors = errorReporter;
        this._clock = clock;
        this._logger = logger;
        this._scheduler = scheduler;
        this._publish = publish;
        this._inputRoots = inputRoots;
        this._controlAvailable = controlAvailable;
        this._managerDisposed = managerDisposed;
        this._fallbackFailureText = fallbackFailureText;
        this._serviceStoppedText = serviceStoppedText;
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
        this._disposed = false;
    }

    acceptSnapshot() {
        this._sweepOnce(this._inputRoots());
        return this._relistPictures(false);
    }

    refreshInputs() {
        const changed = this._relistPictures(true);
        if (changed) {
            this._publish();
        }
        return changed;
    }

    jobBlocker(profileId) {
        const refusal = JobSubmission.encodingRefusalFor(this._inputContracts.get(profileId));
        if (refusal !== null) {
            return _(JOB_REFUSAL_TEXTS[refusal] ?? JOB_REFUSAL_TEXTS["contract-absent"]);
        }
        return this._inputRoots().length === 0 ? _(NO_INPUT_ROOTS_TEXT) : "";
    }

    submitJob(profileId, picture) {
        if (this._jobPending !== null) {
            return false;
        }
        const refusal = this._jobPrecondition(profileId, picture);
        if (refusal !== "") {
            return this._reportJobFailure(refusal);
        }
        return this._dispatchJob(profileId, picture);
    }

    clearActivity() {
        const jobRunning = this._job.pending === true || this._job.state === "running";
        const hadJob = Boolean(this._job.profileId);
        if (!jobRunning) {
            this._job = NO_JOB;
        }
        return hadJob;
    }

    state() {
        return {
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
        this._cancelJob();
        this._cancelInputListing();
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
        if (this._isDisposed() || sequence !== this._inputListSequence) {
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

    _jobPrecondition(profileId, picture) {
        if (this._jobSubmitter === null) {
            return _("Runtime job service is unavailable; start it and retry");
        }
        if (this._controlAvailable() === false) {
            return this._serviceStoppedText;
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
        if (this._isDisposed() || this._jobPending?.sequence !== sequence) {
            return false;
        }
        const pending = this._jobPending;
        this._jobPending = null;
        if (error) {
            this._job = {...NO_JOB, profileId: pending.profileId, sourceName: pending.sourceName};
            this._reportJobFailure(
                jobFailureText(error, this._fallbackFailureText),
                `Runtime did not accept the job: ${error}`,
            );
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
        if (this._isDisposed() || polling === null) {
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
        if (this._isDisposed() || this._polling === null || this._polling.sequence !== sequence) {
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
        if (discardStaged && polling?.stagedPath) {
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

    _cancelJob() {
        this._jobSequence += 1;
        this._jobPending = null;
        this._cancelPolling();
        return this._jobSubmitter === null ? false : this._jobSubmitter.cancel();
    }

    _isDisposed() {
        return this._disposed || this._managerDisposed();
    }
}

module.exports = {
    JOB_ABANDONED_TEXT,
    JOB_POLL_INTERVAL_MS,
    JOB_REFUSAL_TEXTS,
    JOB_SUBMITTER_METHODS,
    MAX_JOB_POLLS,
    NO_JOB,
    RUNTIME_JOB_FAILURE,
    WorkloadRuntimeController,
    inputContracts,
    jobFailureText,
    requireInputCatalog,
    requireJobSubmitter,
    validPictureListing,
};
