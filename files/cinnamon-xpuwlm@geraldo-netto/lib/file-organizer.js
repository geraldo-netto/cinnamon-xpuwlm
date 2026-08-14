"use strict";

// One explicitly selected batch in, one immutable review plan out. This module
// deliberately has no filesystem mutation port or apply method.

const DocumentQuestion = require("./document-question.js");
const I18n = require("./i18n.js");
const Job = require("./runtime-job-contract.js");
const Paths = require("./path-port.js");
const Validation = require("./validation.js");
const Workflow = require("./workflow-controller.js");

const {_, format} = I18n;

const PROFILE_ID = "file-organizer";
const MAX_PLAN_ITEMS = 16;
const MAX_TAGS = 16;
const MAX_EVIDENCE = 8;
const MAX_POLLS = 600;
const POLL_INTERVAL_MS = 500;
const {DIGEST, REQUEST_ID} = Validation;
const IDENTIFIER = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const FILE_ID = /^selected-file-[1-9]\d*$/u;
const DUPLICATE_GROUP = /^duplicate-group-[1-9]\d*$/u;
const TAG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const RESULT_FIELDS = new Set(["version", "requestId", "providerId", "accelerator", "plan"]);
const ITEM_FIELDS = new Set([
    "fileId", "fileName", "sourceSha256", "tags", "proposedName",
    "proposedFolder", "duplicateGroup", "reason", "evidence",
]);
const EVIDENCE_FIELDS = new Set([
    "fileId", "fileName", "sourceSha256", "page", "span", "textSha256",
]);

class FileOrganizerError extends Error {
    constructor(code, detail) {
        super(`${code}: ${detail}`);
        this.name = "FileOrganizerError";
        this.code = code;
        this.detail = detail;
    }
}

const isRecord = Validation.isRecord;
const exactRecord = Validation.exactKeys;
const boundedText = Validation.boundedText;

function hasControl(value) {
    return [...value].some((character) => {
        const code = character.codePointAt(0);
        return code < 32 || code === 127;
    });
}

function validSpan(value) {
    return exactRecord(value, new Set(["start", "end"]))
        && Number.isInteger(value.start)
        && Number.isInteger(value.end)
        && value.start >= 0
        && value.end > value.start
        && value.end <= 5_000_000;
}

function safeName(value) {
    return value === null || (
        boundedText(value, 1, 255)
        && !value.startsWith(".")
        && !value.includes("/")
        && !value.includes("\\")
        && !hasControl(value)
    );
}

function suffixOf(value) {
    const index = value.lastIndexOf(".");
    return index <= 0 ? "" : value.slice(index).toLowerCase();
}

function safeFolder(value) {
    if (value === null) {
        return true;
    }
    if (!boundedText(value, 1, 240)
        || value.startsWith("/")
        || value.startsWith("\\")
        || value.startsWith("~")
        || value.includes("\\")
        || hasControl(value)) {
        return false;
    }
    const parts = value.split("/");
    return parts.every((part) => boundedText(part, 1, 120) && part !== "." && part !== "..");
}

function validEvidenceIdentity(value, item) {
    return exactRecord(value, EVIDENCE_FIELDS)
        && value.fileId === item.fileId
        && value.fileName === item.fileName
        && value.sourceSha256 === item.sourceSha256
        && DIGEST.test(value.textSha256);
}

function validEvidenceLocation(value) {
    return isRecord(value)
        && Number.isInteger(value.page)
        && value.page >= 1
        && value.page <= 2000
        && validSpan(value.span);
}

function validEvidence(value, item) {
    return validEvidenceIdentity(value, item) && validEvidenceLocation(value);
}

function validPlanItemIdentity(value, index) {
    return exactRecord(value, ITEM_FIELDS)
        && FILE_ID.test(value.fileId)
        && value.fileId === `selected-file-${index + 1}`
        && boundedText(value.fileName, 1, 255)
        && !value.fileName.includes("/")
        && !value.fileName.includes("\\")
        && DIGEST.test(value.sourceSha256);
}

function validTags(value) {
    return isRecord(value)
        && Array.isArray(value.tags)
        && value.tags.length <= MAX_TAGS
        && new Set(value.tags).size === value.tags.length
        && value.tags.every((tag) => boundedText(tag, 1, 48) && TAG.test(tag));
}

function validPlanItemSuggestions(value) {
    return validTags(value)
        && safeName(value.proposedName)
        && safeFolder(value.proposedFolder)
        && (value.duplicateGroup === null || DUPLICATE_GROUP.test(value.duplicateGroup))
        && boundedText(value.reason, 1, 2048);
}

function validPlanItemEvidence(value) {
    return isRecord(value)
        && Array.isArray(value.evidence)
        && value.evidence.length >= 1
        && value.evidence.length <= MAX_EVIDENCE
        && value.evidence.every((evidence) => validEvidence(evidence, value));
}

function validPlanItem(value, index) {
    if (!validPlanItemIdentity(value, index)
        || !validPlanItemSuggestions(value)
        || !validPlanItemEvidence(value)) {
        return false;
    }
    const evidenceKeys = value.evidence.map((evidence) => [
        evidence.page, evidence.span.start, evidence.span.end, evidence.textSha256,
    ].join(":"));
    return new Set(evidenceKeys).size === evidenceKeys.length;
}

function validResultIdentity(value, jobId) {
    return exactRecord(value, RESULT_FIELDS)
        && value.version === 1
        && value.requestId === jobId
        && REQUEST_ID.test(value.requestId)
        && IDENTIFIER.test(value.providerId)
        && ["gpu", "npu"].includes(value.accelerator);
}

function validPlan(value) {
    return Array.isArray(value.plan)
        && value.plan.length >= 1
        && value.plan.length <= MAX_PLAN_ITEMS
        && value.plan.every(validPlanItem)
        && validDuplicateGroups(value.plan);
}

function validDuplicateGroups(plan) {
    const counts = new Map();
    for (const item of plan) {
        counts.set(item.sourceSha256, (counts.get(item.sourceSha256) || 0) + 1);
    }
    const expected = new Map();
    let group = 0;
    for (const item of plan) {
        if (counts.get(item.sourceSha256) > 1 && !expected.has(item.sourceSha256)) {
            group += 1;
            expected.set(item.sourceSha256, `duplicate-group-${group}`);
        }
    }
    return plan.every((item) => item.duplicateGroup === (expected.get(item.sourceSha256) || null));
}

function organizationPlan(value, jobId, sources = null) {
    if (!validResultIdentity(value, jobId) || !validPlan(value)) {
        throw new FileOrganizerError("result-invalid", "file organization plan does not match version 1");
    }
    if (sources !== null && (
        !Array.isArray(sources)
        || value.plan.length !== sources.length
        || value.plan.some((item, index) => item.fileName !== sources[index].name
            || (item.proposedName !== null
                && suffixOf(item.proposedName) !== suffixOf(sources[index].name)))
    )) {
        throw new FileOrganizerError("result-invalid", "file organization plan does not match the selection");
    }
    return Object.freeze({
        version: 1,
        requestId: value.requestId,
        providerId: value.providerId,
        accelerator: value.accelerator,
        plan: Object.freeze(value.plan.map((item) => Object.freeze({
            ...item,
            tags: Object.freeze([...item.tags]),
            evidence: Object.freeze(item.evidence.map((evidence) => Object.freeze({
                ...evidence,
                span: Object.freeze({...evidence.span}),
            }))),
        }))),
    });
}

function submission(requestId, sources, pathPort = Paths.POSIX_PATHS) {
    const document = {
        version: Job.JOB_VERSION,
        requestId,
        workloadId: PROFILE_ID,
        payload: {
            sources: DocumentQuestion.selectedSources(sources, pathPort)
                .map((source) => source.path),
        },
    };
    if (!Job.isJobSubmission(document)) {
        throw new FileOrganizerError("request-invalid", "file organizer submission is invalid");
    }
    return document;
}

function initialState() {
    return {
        available: false,
        availabilityDetail: _("File organizer provider is not ready"),
        phase: "idle",
        sources: [],
        jobId: "",
        message: "",
        progress: null,
        providerId: "",
        accelerator: "",
        plan: [],
    };
}

function cloneState(state) {
    return {
        ...state,
        sources: state.sources.map((source) => ({...source})),
        progress: state.progress === null ? null : {...state.progress},
        plan: state.plan.map((item) => ({
            ...item,
            tags: [...item.tags],
            evidence: item.evidence.map((evidence) => ({
                ...evidence,
                span: {...evidence.span},
            })),
        })),
    };
}

class FileOrganizerController extends Workflow.RuntimeWorkflowController {
    constructor({picker, gateway, scheduler, clock = Date, paths = Paths.POSIX_PATHS}) {
        const pickerPort = Workflow.requirePort(picker, ["chooseFiles"], "File organizer picker");
        super({
            clock,
            cloneState,
            gateway,
            initialState,
            labels: {
                clock: "File organizer clock",
                disposed: "File organizer controller",
                failure: _("File organization failed"),
                gateway: "File organizer gateway",
                listener: "File organizer listener",
                scheduler: "File organizer scheduler",
            },
            pollIntervalMs: POLL_INTERVAL_MS,
            scheduler,
        });
        this._picker = pickerPort;
        this._paths = Paths.requirePathPort(paths);
    }

    chooseFiles() {
        this._ensureActive();
        if (!this._state.available
            || ["selecting", "submitting", "running", "cancelling"].includes(this._state.phase)) {
            return false;
        }
        const sequence = this._nextSequence();
        this._replace({phase: "selecting", message: "", plan: []});
        try {
            this._picker.chooseFiles((error, sources) => this._selected(sequence, error, sources));
        } catch (error) {
            this._selected(sequence, error, null);
        }
        return true;
    }

    _selected(sequence, error, candidates) {
        if (!this._current(sequence)) {
            return false;
        }
        if (error) {
            return this._fail(String(error));
        }
        if (Array.isArray(candidates) && candidates.length === 0) {
            this._replace({phase: "idle", message: _("Selection cancelled")});
            return true;
        }
        try {
            this._replace({
                phase: "selected",
                sources: [...DocumentQuestion.selectedSources(candidates, this._paths)],
                message: _("Files selected for review-only planning"),
            });
            return true;
        } catch (selectionError) {
            return this._fail(selectionError.detail || String(selectionError));
        }
    }

    start() {
        this._ensureActive();
        if (!this._state.available || this._state.phase !== "selected") {
            return false;
        }
        const sequence = this._nextSequence();
        let request;
        try {
            request = submission(
                `xpuwlm-file-organizer-${this._clock.now()}-${sequence}`,
                this._state.sources,
                this._paths,
            );
        } catch (error) {
            return this._fail(error.detail || String(error), "selected");
        }
        this._replace({phase: "submitting", message: _("Submitting selected files…"), progress: null});
        try {
            this._gateway.submit(request, (error, reply) => this._accepted(sequence, error, reply));
        } catch (error) {
            this._accepted(sequence, error, null);
        }
        return true;
    }

    _accepted(sequence, error, acknowledgement) {
        if (!this._current(sequence)) {
            return false;
        }
        if (error) {
            return this._fail(String(error));
        }
        if (!acknowledgement || acknowledgement.status !== "accepted" || !acknowledgement.jobId) {
            return this._fail(acknowledgement?.message || _("Runtime rejected file organization"));
        }
        this._polls = 0;
        this._replace({
            phase: "running",
            jobId: acknowledgement.jobId,
            message: acknowledgement.message,
            progress: {fraction: 0, detail: _("Queued")},
        });
        this._schedulePoll(sequence);
        return true;
    }

    _poll(sequence) {
        if (!this._current(sequence) || this._state.phase !== "running") {
            return false;
        }
        this._polls += 1;
        if (this._polls > MAX_POLLS) {
            return this._fail(_("Runtime did not report a file organization plan"));
        }
        try {
            this._gateway.requestResult(
                {
                    requestId: `xpuwlm-file-organizer-poll-${this._clock.now()}-${this._polls}`,
                    jobId: this._state.jobId,
                },
                (error, result) => this._result(sequence, error, result),
            );
        } catch (error) {
            this._result(sequence, error, null);
        }
        return true;
    }

    _result(sequence, error, result) {
        if (!this._current(sequence) || this._state.phase !== "running") {
            return false;
        }
        if (error) {
            this._schedulePoll(sequence);
            return false;
        }
        if (result.state === "running") {
            this._replace({progress: result.progress || this._state.progress, message: result.message});
            this._schedulePoll(sequence);
            return true;
        }
        return this._terminalResult(result);
    }

    _terminalResult(result) {
        if (result.state !== "succeeded") {
            return this._fail(result.message || format(_("File organization %s"), result.state));
        }
        try {
            const output = organizationPlan(result.output, result.jobId, this._state.sources);
            this._replace({
                phase: "complete",
                progress: {fraction: 1, detail: _("Plan ready")},
                message: _("Review-only plan ready; no files changed"),
                providerId: output.providerId,
                accelerator: output.accelerator,
                plan: [...output.plan],
            });
            return true;
        } catch (parseError) {
            return this._fail(parseError.detail || String(parseError));
        }
    }

    cancel() {
        this._ensureActive();
        if (!["submitting", "running"].includes(this._state.phase)) {
            return false;
        }
        this._clearPoll();
        const sequence = this._nextSequence();
        const jobId = this._state.jobId;
        this._replace({phase: "cancelling", message: _("Cancelling file organization…")});
        if (jobId === "") {
            this._gateway.cancel();
            return this._cancelled(sequence, null);
        }
        try {
            this._gateway.cancelJob(
                {requestId: `xpuwlm-file-organizer-cancel-${this._clock.now()}-${sequence}`, jobId},
                (error) => this._cancelled(sequence, error),
            );
        } catch (error) {
            this._cancelled(sequence, error);
        }
        return true;
    }

    _cancelled(sequence, error) {
        if (!this._current(sequence)) {
            return false;
        }
        if (error) {
            return this._fail(String(error));
        }
        this._replace({
            phase: "selected", jobId: "", progress: null,
            message: _("File organization cancelled; no files changed"),
        });
        return true;
    }

    reset() {
        return this._reset(["submitting", "running", "cancelling"]);
    }

    dispose() {
        return this._dispose();
    }
}

module.exports = {
    FileOrganizerController,
    FileOrganizerError,
    MAX_EVIDENCE,
    MAX_PLAN_ITEMS,
    MAX_POLLS,
    MAX_TAGS,
    POLL_INTERVAL_MS,
    PROFILE_ID,
    cloneState,
    exactRecord,
    initialState,
    organizationPlan,
    safeFolder,
    safeName,
    submission,
    validEvidence,
    validEvidenceIdentity,
    validEvidenceLocation,
    validDuplicateGroups,
    validPlan,
    validPlanItem,
    validPlanItemEvidence,
    validPlanItemIdentity,
    validPlanItemSuggestions,
    validResultIdentity,
    validSpan,
    validTags,
};
