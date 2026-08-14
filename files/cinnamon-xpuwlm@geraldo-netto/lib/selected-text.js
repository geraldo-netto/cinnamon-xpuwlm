"use strict";

const Job = require("./runtime-job-contract.js");
const I18n = require("./i18n.js");
const Validation = require("./validation.js");
const Workflow = require("./workflow-controller.js");

const {_, format} = I18n;

const PROFILE_ID = "selected-text-tools";
const OPERATIONS = Object.freeze(["explain", "summarize", "rewrite", "translate", "extract-tasks"]);
const MAX_SELECTION_CHARACTERS = 32768;
const MAX_LANGUAGE_CHARACTERS = 64;
const MAX_RESULT_CHARACTERS = 16384;
const MAX_TASKS = 64;
const MAX_POLLS = 600;
const POLL_INTERVAL_MS = 500;
const LANGUAGE = /^[A-Za-z][A-Za-z -]*$/u;
const {DIGEST, REQUEST_ID} = Validation;
const IDENTIFIER = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const RESULT_FIELDS = new Set([
    "version", "requestId", "operation", "result", "tasks", "providerId", "accelerator", "evidence",
]);
const EVIDENCE_FIELDS = new Set(["selectionSha256", "span", "textSha256"]);

class SelectedTextError extends Error {
    constructor(code, detail) {
        super(`${code}: ${detail}`);
        this.name = "SelectedTextError";
        this.code = code;
        this.detail = detail;
    }
}

const exactRecord = Validation.exactKeys;
const boundedText = Validation.boundedText;

function normalizedOperation(value) {
    if (!OPERATIONS.includes(value)) {
        throw new SelectedTextError("operation-invalid", "selected-text operation is unsupported");
    }
    return value;
}

function normalizedLanguage(operation, value) {
    if (operation !== "translate") {
        if (value !== null && value !== undefined && value !== "") {
            throw new SelectedTextError("language-invalid", "language is accepted only for translation");
        }
        return null;
    }
    if (!boundedText(value, 1, MAX_LANGUAGE_CHARACTERS) || LANGUAGE.test(value.trim()) === false) {
        throw new SelectedTextError(
            "language-invalid",
            `translation language must contain 1-${MAX_LANGUAGE_CHARACTERS} letters`,
        );
    }
    return value.trim();
}

function normalizedSelection(value) {
    if (!boundedText(value, 1, MAX_SELECTION_CHARACTERS) || value.trim() === "") {
        throw new SelectedTextError(
            "selection-invalid",
            `selection must contain 1-${MAX_SELECTION_CHARACTERS} characters`,
        );
    }
    return value;
}

function validEvidenceSpan(value) {
    return exactRecord(value, new Set(["start", "end"]))
        && value.start === 0
        && Number.isInteger(value.end)
        && value.end >= 1
        && value.end <= MAX_SELECTION_CHARACTERS;
}

function validEvidence(value) {
    return exactRecord(value, EVIDENCE_FIELDS)
        && DIGEST.test(value.selectionSha256)
        && DIGEST.test(value.textSha256)
        && value.selectionSha256 === value.textSha256
        && validEvidenceSpan(value.span);
}

function validTasks(value, operation) {
    return Array.isArray(value)
        && value.length <= MAX_TASKS
        && new Set(value).size === value.length
        && value.every((task) => boundedText(task, 1, 512))
        && (operation === "extract-tasks" || value.length === 0);
}

function validResultIdentity(value, jobId, operation) {
    return exactRecord(value, RESULT_FIELDS)
        && value.version === 1
        && value.requestId === jobId
        && REQUEST_ID.test(value.requestId)
        && value.operation === operation
        && OPERATIONS.includes(operation);
}

function validResultContent(value) {
    return boundedText(value.result, 1, MAX_RESULT_CHARACTERS)
        && validTasks(value.tasks, value.operation)
        && IDENTIFIER.test(value.providerId)
        && ["gpu", "npu"].includes(value.accelerator)
        && validEvidence(value.evidence);
}

function selectedTextResult(value, jobId, operation) {
    if (!validResultIdentity(value, jobId, operation) || !validResultContent(value)) {
        throw new SelectedTextError("result-invalid", "selected-text result does not match version 1");
    }
    return Object.freeze({
        ...value,
        tasks: Object.freeze([...value.tasks]),
        evidence: Object.freeze({
            ...value.evidence,
            span: Object.freeze({...value.evidence.span}),
        }),
    });
}

function submission(requestId, selection, operation, language = null) {
    const normalized = normalizedOperation(operation);
    const payload = {
        selection: normalizedSelection(selection),
        operation: normalized,
    };
    const target = normalizedLanguage(normalized, language);
    if (target !== null) {
        payload.language = target;
    }
    const document = {
        version: Job.JOB_VERSION,
        requestId,
        workloadId: PROFILE_ID,
        payload,
    };
    if (!Job.isJobSubmission(document)) {
        throw new SelectedTextError("request-invalid", "selected-text submission is invalid");
    }
    return document;
}

function initialState() {
    return {
        available: false,
        availabilityDetail: _("Selected-text provider is not ready"),
        phase: "idle",
        operation: "",
        jobId: "",
        message: "",
        progress: null,
        result: "",
        tasks: [],
        providerId: "",
        accelerator: "",
        evidence: null,
    };
}

function cloneState(state) {
    return {
        ...state,
        progress: state.progress === null ? null : {...state.progress},
        tasks: [...state.tasks],
        evidence: state.evidence === null ? null : {
            ...state.evidence,
            span: {...state.evidence.span},
        },
    };
}

class SelectedTextController extends Workflow.RuntimeWorkflowController {
    constructor({clipboard, gateway, scheduler, clock = Date}) {
        const clipboardPort = Workflow.requirePort(
            clipboard, ["readText", "cancel"], "Clipboard reader",
        );
        super({
            clock,
            cloneState,
            gateway,
            initialState,
            labels: {
                clock: "Selected-text clock",
                disposed: "Selected-text controller",
                failure: _("Selected-text request failed"),
                gateway: "Selected-text gateway",
                listener: "Selected-text listener",
                scheduler: "Selected-text scheduler",
            },
            pollIntervalMs: POLL_INTERVAL_MS,
            scheduler,
        });
        this._clipboard = clipboardPort;
    }

    start(operation, language = null) {
        this._ensureActive();
        if (!this._state.available || ["selecting", "submitting", "running", "cancelling"].includes(this._state.phase)) {
            return false;
        }
        let normalized;
        let target;
        try {
            normalized = normalizedOperation(operation);
            target = normalizedLanguage(normalized, language);
        } catch (error) {
            return this._fail(error.detail || String(error));
        }
        const sequence = this._nextSequence();
        this._replace({
            phase: "selecting", operation: normalized, message: _("Reading explicit selection…"),
            result: "", tasks: [], evidence: null, progress: null,
        });
        try {
            this._clipboard.readText(
                (error, text) => this._captured(sequence, error, text, normalized, target),
            );
        } catch (error) {
            this._captured(sequence, error, null, normalized, target);
        }
        return true;
    }

    _captured(sequence, error, text, operation, language) {
        if (!this._current(sequence) || this._state.phase !== "selecting") {
            return false;
        }
        if (error) {
            return this._fail(String(error));
        }
        let request;
        try {
            request = submission(
                `xpuwlm-selected-text-${this._clock.now()}-${sequence}`,
                text,
                operation,
                language,
            );
        } catch (selectionError) {
            return this._fail(selectionError.detail || String(selectionError));
        }
        this._replace({phase: "submitting", message: _("Submitting one-shot selection…")});
        try {
            this._gateway.submit(request, (submitError, reply) => (
                this._accepted(sequence, submitError, reply)
            ));
        } catch (submitError) {
            this._accepted(sequence, submitError, null);
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
            return this._fail(acknowledgement?.message || _("Runtime rejected selected-text request"));
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
            return this._fail(_("Runtime did not report a selected-text result"));
        }
        try {
            this._gateway.requestResult(
                {
                    requestId: `xpuwlm-selected-text-poll-${this._clock.now()}-${this._polls}`,
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
            return this._fail(result.message || format(_("Selected-text request %s"), result.state));
        }
        try {
            const output = selectedTextResult(result.output, result.jobId, this._state.operation);
            this._replace({
                phase: "complete",
                progress: {fraction: 1, detail: _("Result ready")},
                message: _("Selection processed for review"),
                result: output.result,
                tasks: [...output.tasks],
                providerId: output.providerId,
                accelerator: output.accelerator,
                evidence: {...output.evidence, span: {...output.evidence.span}},
            });
            return true;
        } catch (parseError) {
            return this._fail(parseError.detail || String(parseError));
        }
    }

    cancel() {
        this._ensureActive();
        if (!["selecting", "submitting", "running"].includes(this._state.phase)) {
            return false;
        }
        this._clearPoll();
        const jobId = this._state.jobId;
        const sequence = this._nextSequence();
        this._replace({phase: "cancelling", message: _("Cancelling selected-text request…")});
        if (jobId === "") {
            this._clipboard.cancel();
            this._gateway.cancel();
            return this._cancelled(sequence, null);
        }
        try {
            this._gateway.cancelJob(
                {
                    requestId: `xpuwlm-selected-text-cancel-${this._clock.now()}-${sequence}`,
                    jobId,
                },
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
            phase: "idle", operation: "", jobId: "", progress: null,
            message: _("Selected-text request cancelled"),
        });
        return true;
    }

    reset() {
        return this._reset(["selecting", "submitting", "running", "cancelling"]);
    }

    dispose() {
        return this._dispose(this._clipboard);
    }
}

module.exports = {
    MAX_LANGUAGE_CHARACTERS,
    MAX_POLLS,
    MAX_RESULT_CHARACTERS,
    MAX_SELECTION_CHARACTERS,
    MAX_TASKS,
    OPERATIONS,
    POLL_INTERVAL_MS,
    PROFILE_ID,
    SelectedTextController,
    SelectedTextError,
    initialState,
    normalizedLanguage,
    normalizedOperation,
    normalizedSelection,
    selectedTextResult,
    submission,
    validEvidence,
    validEvidenceSpan,
    validResultContent,
    validResultIdentity,
    validTasks,
};
