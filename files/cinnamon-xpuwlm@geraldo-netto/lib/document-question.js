"use strict";

// One explicitly invoked selected-document question. The controller retains
// no question history or source bytes and accepts only the worker's redacted,
// citation-bound public result.

const Job = require("./runtime-job-contract.js");

const PROFILE_ID = "ask-selected-files";
const MAX_SOURCES = 16;
const MAX_SOURCE_BYTES = 128 * 1024 * 1024;
const MAX_QUESTION_CHARACTERS = 4096;
const MAX_ANSWER_CHARACTERS = 16384;
const MAX_CITATIONS = 16;
const MAX_POLLS = 600;
const POLL_INTERVAL_MS = 500;
const SOURCE_SUFFIXES = Object.freeze([".jpeg", ".jpg", ".md", ".pdf", ".png", ".txt", ".webp"]);
const REQUEST_ID = /^[A-Za-z0-9._-]{1,120}$/u;
const IDENTIFIER = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const DIGEST = /^[a-f0-9]{64}$/u;
const FILE_ID = /^selected-file-[1-9][0-9]*$/u;
const CITATION_FIELDS = new Set([
    "fileId", "fileName", "sourceSha256", "page", "span", "textSha256",
]);
const RESULT_FIELDS = new Set([
    "version", "requestId", "answer", "providerId", "accelerator", "citations",
]);

class DocumentQuestionError extends Error {
    constructor(code, detail) {
        super(`${code}: ${detail}`);
        this.name = "DocumentQuestionError";
        this.code = code;
        this.detail = detail;
    }
}

function isRecord(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value);
}

function exactRecord(value, fields) {
    return isRecord(value)
        && Object.keys(value).length === fields.size
        && Object.keys(value).every((name) => fields.has(name));
}

function boundedText(value, minimum, maximum) {
    return typeof value === "string" && [...value].length >= minimum && [...value].length <= maximum;
}

function suffixOf(path) {
    const lowered = String(path).toLowerCase();
    return SOURCE_SUFFIXES.find((suffix) => lowered.endsWith(suffix)) || "";
}

function sourceIdentity(candidate) {
    return isRecord(candidate)
        && boundedText(candidate.path, 1, 4096)
        && candidate.path.startsWith("/")
        && !candidate.path.includes("\0")
        && boundedText(candidate.name, 1, 255)
        && !candidate.name.includes("/")
        && !candidate.name.includes("\\")
        && !candidate.name.startsWith(".");
}

function sourceKind(candidate) {
    return candidate.regular === true
        && candidate.symlink !== true
        && Number.isInteger(candidate.size)
        && candidate.size >= 1
        && candidate.size <= MAX_SOURCE_BYTES
        && suffixOf(candidate.path) !== "";
}

function supportedSource(candidate) {
    return sourceIdentity(candidate) && sourceKind(candidate);
}

function selectedSources(candidates) {
    if (!Array.isArray(candidates) || candidates.length < 1 || candidates.length > MAX_SOURCES) {
        throw new DocumentQuestionError("sources-invalid", `choose 1-${MAX_SOURCES} document files`);
    }
    if (!candidates.every(supportedSource)) {
        throw new DocumentQuestionError("source-invalid", "choose supported non-empty regular files");
    }
    if (new Set(candidates.map((source) => source.path)).size !== candidates.length) {
        throw new DocumentQuestionError("source-duplicate", "the same document was selected twice");
    }
    return Object.freeze(candidates.map((source) => Object.freeze({
        path: source.path,
        name: source.name,
        size: source.size,
        regular: true,
        symlink: false,
    })));
}

function normalizedQuestion(value) {
    if (!boundedText(value, 1, MAX_QUESTION_CHARACTERS) || value.trim() === "") {
        throw new DocumentQuestionError(
            "question-invalid", `question must contain 1-${MAX_QUESTION_CHARACTERS} characters`,
        );
    }
    return value.trim();
}

function validSpan(value) {
    return exactRecord(value, new Set(["start", "end"]))
        && Number.isInteger(value.start)
        && Number.isInteger(value.end)
        && value.start >= 0
        && value.end > value.start
        && value.end <= 5_000_000;
}

function validCitationIdentity(value) {
    return exactRecord(value, CITATION_FIELDS)
        && FILE_ID.test(value.fileId)
        && boundedText(value.fileName, 1, 255)
        && !value.fileName.includes("/")
        && !value.fileName.includes("\\")
        && DIGEST.test(value.sourceSha256)
        && DIGEST.test(value.textSha256);
}

function validCitationLocation(value) {
    return isRecord(value)
        && Number.isInteger(value.page)
        && value.page >= 1
        && value.page <= 2000
        && validSpan(value.span);
}

function validCitation(value) {
    return validCitationIdentity(value) && validCitationLocation(value);
}

function validAnswerIdentity(value, jobId) {
    return exactRecord(value, RESULT_FIELDS)
        && value.version === 1
        && value.requestId === jobId
        && REQUEST_ID.test(value.requestId)
        && boundedText(value.answer, 1, MAX_ANSWER_CHARACTERS)
        && IDENTIFIER.test(value.providerId)
        && ["gpu", "npu"].includes(value.accelerator);
}

function validAnswerCitations(value) {
    return Array.isArray(value.citations)
        && value.citations.length >= 1
        && value.citations.length <= MAX_CITATIONS
        && value.citations.every(validCitation);
}

function groundedAnswer(value, jobId) {
    if (!validAnswerIdentity(value, jobId) || !validAnswerCitations(value)) {
        throw new DocumentQuestionError("result-invalid", "document answer does not match version 1");
    }
    const keys = value.citations.map((citation) => [
        citation.fileId,
        citation.page,
        citation.span.start,
        citation.span.end,
        citation.textSha256,
    ].join(":"));
    if (new Set(keys).size !== keys.length) {
        throw new DocumentQuestionError("result-invalid", "document citations must be unique");
    }
    return Object.freeze({
        version: 1,
        requestId: value.requestId,
        answer: value.answer,
        providerId: value.providerId,
        accelerator: value.accelerator,
        citations: Object.freeze(value.citations.map((citation) => Object.freeze({
            ...citation,
            span: Object.freeze({...citation.span}),
        }))),
    });
}

function submission(requestId, sources, question) {
    const document = {
        version: Job.JOB_VERSION,
        requestId,
        workloadId: PROFILE_ID,
        payload: {
            sources: selectedSources(sources).map((source) => source.path),
            question: normalizedQuestion(question),
        },
    };
    if (!Job.isJobSubmission(document)) {
        throw new DocumentQuestionError("request-invalid", "document question submission is invalid");
    }
    return document;
}

function initialState() {
    return {
        available: false,
        availabilityDetail: "Document provider is not ready",
        phase: "idle",
        sources: [],
        jobId: "",
        message: "",
        progress: null,
        answer: "",
        providerId: "",
        accelerator: "",
        citations: [],
    };
}

function cloneState(state) {
    return {
        ...state,
        sources: state.sources.map((source) => ({...source})),
        progress: state.progress === null ? null : {...state.progress},
        citations: state.citations.map((citation) => ({
            ...citation,
            span: {...citation.span},
        })),
    };
}

function requirePort(candidate, methods, label) {
    if (!candidate || methods.some((name) => typeof candidate[name] !== "function")) {
        throw new TypeError(`${label} is required`);
    }
    return candidate;
}

class DocumentQuestionController {
    constructor({picker, gateway, scheduler, clock = Date}) {
        this._picker = requirePort(picker, ["chooseFiles"], "Document picker");
        this._gateway = requirePort(
            gateway, ["submit", "requestResult", "cancelJob", "cancel"], "Document job gateway",
        );
        this._scheduler = requirePort(scheduler, ["schedule", "cancel"], "Document scheduler");
        if (!clock || typeof clock.now !== "function") {
            throw new TypeError("Document question clock is required");
        }
        this._clock = clock;
        this._state = initialState();
        this._listeners = new Set();
        this._sequence = 0;
        this._polls = 0;
        this._pollHandle = null;
        this._disposed = false;
    }

    state() {
        return cloneState(this._state);
    }

    subscribe(listener) {
        if (typeof listener !== "function") {
            throw new TypeError("Document question listener is required");
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

    chooseFiles() {
        this._ensureActive();
        if (!this._state.available || ["selecting", "submitting", "running", "cancelling"].includes(this._state.phase)) {
            return false;
        }
        const sequence = this._nextSequence();
        this._replace({phase: "selecting", message: "", answer: "", citations: []});
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
            this._replace({phase: "idle", message: "Selection cancelled"});
            return true;
        }
        try {
            this._replace({phase: "selected", sources: [...selectedSources(candidates)], message: "Documents selected"});
            return true;
        } catch (selectionError) {
            return this._fail(selectionError.detail || String(selectionError));
        }
    }

    start(question) {
        this._ensureActive();
        if (!this._state.available || this._state.phase !== "selected") {
            return false;
        }
        let request;
        const sequence = this._nextSequence();
        try {
            request = submission(
                `xpuwlm-question-${this._clock.now()}-${sequence}`,
                this._state.sources,
                question,
            );
        } catch (error) {
            return this._fail(error.detail || String(error), "selected");
        }
        this._replace({phase: "submitting", message: "Submitting selected documents…", progress: null});
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
            return this._fail(acknowledgement?.message || "Runtime rejected document question");
        }
        this._polls = 0;
        this._replace({
            phase: "running",
            jobId: acknowledgement.jobId,
            message: acknowledgement.message,
            progress: {fraction: 0, detail: "Queued"},
        });
        this._schedulePoll(sequence);
        return true;
    }

    _schedulePoll(sequence) {
        this._pollHandle = this._scheduler.schedule(POLL_INTERVAL_MS, () => {
            this._pollHandle = null;
            this._poll(sequence);
        });
    }

    _poll(sequence) {
        if (!this._current(sequence) || this._state.phase !== "running") {
            return false;
        }
        this._polls += 1;
        if (this._polls > MAX_POLLS) {
            return this._fail("Runtime did not report a document answer");
        }
        const requestId = `xpuwlm-question-poll-${this._clock.now()}-${this._polls}`;
        try {
            this._gateway.requestResult(
                {requestId, jobId: this._state.jobId},
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
            return this._fail(result.message || `Document question ${result.state}`);
        }
        try {
            const answer = groundedAnswer(result.output, result.jobId);
            this._replace({
                phase: "complete",
                progress: {fraction: 1, detail: "Answer ready"},
                message: "Answer grounded in selected documents",
                answer: answer.answer,
                providerId: answer.providerId,
                accelerator: answer.accelerator,
                citations: [...answer.citations],
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
        this._replace({phase: "cancelling", message: "Cancelling document question…"});
        if (jobId === "") {
            this._gateway.cancel();
            return this._cancelled(sequence, null);
        }
        try {
            this._gateway.cancelJob(
                {requestId: `xpuwlm-question-cancel-${this._clock.now()}-${sequence}`, jobId},
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
        this._replace({phase: "selected", jobId: "", progress: null, message: "Document question cancelled"});
        return true;
    }

    reset() {
        this._ensureActive();
        if (["submitting", "running", "cancelling"].includes(this._state.phase)) {
            return false;
        }
        const availability = {
            available: this._state.available,
            availabilityDetail: this._state.availabilityDetail,
        };
        this._state = {...initialState(), ...availability};
        this._publish();
        return true;
    }

    dispose() {
        if (this._disposed) {
            return false;
        }
        this._disposed = true;
        this._nextSequence();
        this._clearPoll();
        this._gateway.cancel();
        this._listeners.clear();
        this._state = initialState();
        return true;
    }

    _replace(patch) {
        this._state = {...this._state, ...patch};
        this._publish();
    }

    _fail(message, phase = "error") {
        this._clearPoll();
        this._replace({phase, message: boundedText(message, 1, 500) ? message : "Document question failed"});
        return false;
    }

    _publish() {
        const state = this.state();
        for (const listener of this._listeners) {
            listener(state);
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
            throw new Error("Document question controller is disposed");
        }
    }
}

module.exports = {
    DocumentQuestionController,
    DocumentQuestionError,
    MAX_ANSWER_CHARACTERS,
    MAX_CITATIONS,
    MAX_POLLS,
    MAX_QUESTION_CHARACTERS,
    MAX_SOURCES,
    MAX_SOURCE_BYTES,
    POLL_INTERVAL_MS,
    PROFILE_ID,
    SOURCE_SUFFIXES,
    exactRecord,
    groundedAnswer,
    initialState,
    normalizedQuestion,
    selectedSources,
    submission,
    sourceIdentity,
    sourceKind,
    supportedSource,
    validAnswerCitations,
    validAnswerIdentity,
    validCitation,
    validCitationIdentity,
    validCitationLocation,
    validSpan,
};
