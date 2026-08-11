"use strict";

// What a job submission and its acknowledgement look like on the wire.
//
// Mirrors `runtime-job-submit.schema.json`,
// `runtime-job-acknowledgement.schema.json`,
// `runtime-job-result-request.schema.json` and `runtime-job-result.schema.json`,
// plus the reference shape
// `tensorref.py` parses out of the payload. The payload is an opaque object in
// the schema — the runtime validates references separately — so the reference
// rules are restated here rather than inherited, and a contract test pins them
// against the runtime's own limits.
//
// Checked on the way out as well as on the way in. A submission this applet
// builds wrongly is refused by the service with a code, several seconds and one
// bus round trip later; refusing it here costs nothing and says which field.

const Contract = require("./runtime-control-contract.js");

const JOB_VERSION = 1;
const REQUEST_ID = /^[A-Za-z0-9._-]+$/u;
const WORKLOAD_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const JOB_CODE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const DIGEST = /^[a-f0-9]{64}$/u;
const MAX_IDENTIFIER_LENGTH = 120;
const MAX_WORKLOAD_ID_LENGTH = 80;
const MAX_MESSAGE_LENGTH = 240;
const MAX_PAYLOAD_PROPERTIES = 64;

// The runtime's own reference limits (`tensorref.py`): rank, per-dimension
// ceiling, the dtypes whose element size is fixed and whose bytes need no
// decoding, and the byte ceiling one referenced buffer may reach.
const MAX_RANK = 6;
const MAX_DIMENSION = 65_536;
const MAX_TENSOR_BYTES = 64 * 1024 * 1024;
const MAX_INPUT_REFERENCES = 64;
const DTYPE_SIZES = Object.freeze({
    float32: 4,
    float64: 8,
    int32: 4,
    int64: 8,
    uint8: 1,
});

const SUBMISSION_PROPERTIES = new Set(["version", "requestId", "workloadId", "payload"]);
const ACKNOWLEDGEMENT_PROPERTIES = new Set([
    "version", "requestId", "jobId", "status", "code", "message", "timestamp",
]);
const ACKNOWLEDGEMENT_REQUIRED = Object.freeze([...ACKNOWLEDGEMENT_PROPERTIES]);
const ACKNOWLEDGEMENT_STATUSES = new Set(["accepted", "cancelled", "rejected", "not-found"]);
const REFERENCE_PROPERTIES = new Set(["path", "shape", "dtype", "sha256"]);
const REFERENCE_REQUIRED = Object.freeze([...REFERENCE_PROPERTIES]);

const RESULT_REQUEST_PROPERTIES = new Set(["version", "requestId", "jobId"]);
const CANCEL_REQUEST_PROPERTIES = new Set(["version", "requestId", "jobId"]);
const RESULT_PROPERTIES = new Set([
    "version", "requestId", "jobId", "state", "code", "message", "timestamp",
    "progress", "output",
]);
const RESULT_REQUIRED = Object.freeze([
    "version", "requestId", "jobId", "state", "code", "message", "timestamp",
]);
const PROGRESS_PROPERTIES = new Set(["fraction", "detail"]);
const PROGRESS_REQUIRED = Object.freeze([...PROGRESS_PROPERTIES]);
// `unknown` answers both a job that never existed and one belonging to another
// caller, so a reply never reveals which job ids are real.
const RESULT_STATES = new Set(["unknown", "running", "succeeded", "failed", "cancelled"]);
// The states a job cannot leave. Polling stops here, and the staged input
// buffer is removed here, because nothing will read it again.
const TERMINAL_STATES = new Set(["unknown", "succeeded", "failed", "cancelled"]);
const RESULT_CODE = /^[a-z0-9-]{1,64}$/u;
const MAX_RESULT_MESSAGE_LENGTH = 500;
const MAX_PROGRESS_DETAIL_LENGTH = 200;

const exactRecord = Contract.exactRecord;

function isRecord(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value);
}

function boundedProperties(value, required, allowed) {
    return isRecord(value)
        && required.every((name) => Object.hasOwn(value, name))
        && Object.keys(value).every((name) => allowed.has(name));
}

function boundedText(value, minimum, maximum) {
    if (typeof value !== "string") {
        return false;
    }
    const length = [...value].length;
    return length >= minimum && length <= maximum;
}

function isRequestId(value) {
    return boundedText(value, 1, MAX_IDENTIFIER_LENGTH) && REQUEST_ID.test(value);
}

function isWorkloadId(value) {
    return boundedText(value, 1, MAX_WORKLOAD_ID_LENGTH) && WORKLOAD_ID.test(value);
}

function isJobId(value) {
    return isRequestId(value);
}

function isPayload(value) {
    return isRecord(value) && Object.keys(value).length <= MAX_PAYLOAD_PROPERTIES;
}

function isShape(value) {
    return Array.isArray(value)
        && value.length >= 1
        && value.length <= MAX_RANK
        && value.every((item) => Number.isInteger(item) && item >= 1 && item <= MAX_DIMENSION);
}

function elementCount(shape) {
    return shape.reduce((total, dimension) => total * dimension, 1);
}

// The bytes a reference claims its file holds. The service refuses a file whose
// size disagrees, because truncating or padding both produce a tensor that
// infers successfully and means nothing.
function referenceBytes(reference) {
    return elementCount(reference.shape) * DTYPE_SIZES[reference.dtype];
}

function isInputReference(value) {
    return boundedProperties(value, REFERENCE_REQUIRED, REFERENCE_PROPERTIES)
        && boundedText(value.path, 1, 4096)
        && isShape(value.shape)
        && Object.hasOwn(DTYPE_SIZES, value.dtype)
        && typeof value.sha256 === "string"
        && DIGEST.test(value.sha256)
        && referenceBytes(value) <= MAX_TENSOR_BYTES;
}

// A payload carries either inline tensors or references, never both: two
// sources of truth for the same argument, and no rule for which wins that
// would not surprise somebody.
function isReferencePayload(value) {
    return isPayload(value)
        && !Object.hasOwn(value, "inputs")
        && Array.isArray(value.inputRefs)
        && value.inputRefs.length >= 1
        && value.inputRefs.length <= MAX_INPUT_REFERENCES
        && value.inputRefs.every(isInputReference);
}

function isJobSubmission(value) {
    return exactRecord(value, SUBMISSION_PROPERTIES)
        && value.version === JOB_VERSION
        && isRequestId(value.requestId)
        && isWorkloadId(value.workloadId)
        && isPayload(value.payload);
}

function hasAcknowledgementIdentity(value) {
    return value.version === JOB_VERSION
        && isRequestId(value.requestId)
        && (value.jobId === null || isJobId(value.jobId))
        && ACKNOWLEDGEMENT_STATUSES.has(value.status);
}

function isJobAcknowledgement(value) {
    return boundedProperties(value, ACKNOWLEDGEMENT_REQUIRED, ACKNOWLEDGEMENT_PROPERTIES)
        && hasAcknowledgementIdentity(value)
        && boundedText(value.code, 1, MAX_WORKLOAD_ID_LENGTH)
        && JOB_CODE.test(value.code)
        && boundedText(value.message, 1, MAX_MESSAGE_LENGTH)
        && Number.isInteger(value.timestamp)
        && value.timestamp >= 1;
}

function isProgress(value) {
    return value === null || (
        boundedProperties(value, PROGRESS_REQUIRED, PROGRESS_PROPERTIES)
        && Number.isFinite(value.fraction)
        && value.fraction >= 0
        && value.fraction <= 1
        && boundedText(value.detail, 0, MAX_PROGRESS_DETAIL_LENGTH)
    );
}

function hasResultIdentity(value) {
    return value.version === JOB_VERSION
        && isRequestId(value.requestId)
        && isJobId(value.jobId)
        && RESULT_STATES.has(value.state);
}

function hasResultReport(value) {
    return boundedText(value.code, 1, 64)
        && RESULT_CODE.test(value.code)
        && boundedText(value.message, 0, MAX_RESULT_MESSAGE_LENGTH)
        && Number.isInteger(value.timestamp)
        && value.timestamp >= 1;
}

// `output` is deliberately open in the schema — the runtime puts whatever a
// profile produced there — so it is checked as an object and read defensively,
// never trusted field by field.
function hasResultEvidence(value) {
    return optional(value, "progress", isProgress)
        && optional(value, "output", (output) => output === null || isRecord(output));
}

function optional(value, name, predicate) {
    return !Object.hasOwn(value, name) || predicate(value[name]);
}

function isJobResult(value) {
    return boundedProperties(value, RESULT_REQUIRED, RESULT_PROPERTIES)
        && hasResultIdentity(value)
        && hasResultReport(value)
        && hasResultEvidence(value);
}

function isTerminalState(state) {
    return TERMINAL_STATES.has(state);
}

function jobResultRequest({requestId, jobId}) {
    const request = {version: JOB_VERSION, requestId, jobId};
    if (!exactRecord(request, RESULT_REQUEST_PROPERTIES)
        || !isRequestId(requestId)
        || !isJobId(jobId)) {
        throw new TypeError("Job result request does not match the version 1 contract");
    }
    return request;
}

function jobCancelRequest({requestId, jobId}) {
    const request = {version: JOB_VERSION, requestId, jobId};
    if (!exactRecord(request, CANCEL_REQUEST_PROPERTIES)
        || !isRequestId(requestId)
        || !isJobId(jobId)) {
        throw new TypeError("Job cancellation request does not match the version 1 contract");
    }
    return request;
}

// A submission the applet builds, ready to be stringified. Built here rather
// than at the call site so the one place that knows the envelope is the one
// place that validates it.
function jobSubmission({requestId, workloadId, references}) {
    const submission = {
        version: JOB_VERSION,
        requestId,
        workloadId,
        payload: {inputRefs: references},
    };
    if (!isJobSubmission(submission) || !isReferencePayload(submission.payload)) {
        throw new TypeError("Job submission does not match the version 1 contract");
    }
    return submission;
}

// What a succeeded job actually said, when its profile declared an output
// contract. `output` is open in the schema, so every field is checked here
// rather than assumed: a reading is worth rendering only if it is entirely
// well-formed, and a partly-parsed one would put a confident wrong number on a
// user's screen.
const MAX_READING_ENTRIES = 100;
const MAX_LABEL_LENGTH = 160;
const READING_KINDS = new Set(["classification", "embedding", "raw"]);
const FORECAST_READING_PROPERTIES = new Set(["kind", "targetFeature", "horizon", "value"]);
const MAX_FORECAST_TARGET_LENGTH = 64;
const MAX_FORECAST_HORIZON = 128;

function isReadingEntry(value) {
    return isRecord(value)
        && Number.isInteger(value.index)
        && value.index >= 0
        && Number.isFinite(value.score)
        && (!Object.hasOwn(value, "label") || boundedText(value.label, 0, MAX_LABEL_LENGTH));
}

function forecastReadingOf(reading) {
    if (!exactRecord(reading, FORECAST_READING_PROPERTIES)
        || reading.kind !== "forecast"
        || !boundedText(reading.targetFeature, 1, MAX_FORECAST_TARGET_LENGTH)
        || !Number.isInteger(reading.horizon)
        || reading.horizon < 1
        || reading.horizon > MAX_FORECAST_HORIZON
        || !Number.isFinite(reading.value)) {
        return null;
    }
    return {
        kind: "forecast",
        targetFeature: reading.targetFeature,
        horizon: reading.horizon,
        value: reading.value,
    };
}

function readingOf(output) {
    if (!isRecord(output) || !isRecord(output.reading)) {
        return null;
    }
    const reading = output.reading;
    if (reading.kind === "forecast") {
        return forecastReadingOf(reading);
    }
    if (!READING_KINDS.has(reading.kind) || !Array.isArray(reading.top)) {
        return null;
    }
    const top = reading.top.slice(0, MAX_READING_ENTRIES);
    if (!top.every(isReadingEntry)) {
        return null;
    }
    return {
        kind: reading.kind,
        top: top.map((entry) => (Object.hasOwn(entry, "label")
            ? {index: entry.index, score: entry.score, label: entry.label}
            : {index: entry.index, score: entry.score})),
    };
}

const JOB_CONTRACT_ALLOWLISTS = Object.freeze({
    submission: SUBMISSION_PROPERTIES,
    acknowledgement: ACKNOWLEDGEMENT_PROPERTIES,
    reference: REFERENCE_PROPERTIES,
    resultRequest: RESULT_REQUEST_PROPERTIES,
    cancelRequest: CANCEL_REQUEST_PROPERTIES,
    result: RESULT_PROPERTIES,
    progress: PROGRESS_PROPERTIES,
});

module.exports = {
    ACKNOWLEDGEMENT_PROPERTIES,
    ACKNOWLEDGEMENT_STATUSES,
    CANCEL_REQUEST_PROPERTIES,
    FORECAST_READING_PROPERTIES,
    MAX_FORECAST_HORIZON,
    MAX_FORECAST_TARGET_LENGTH,
    MAX_READING_ENTRIES,
    MAX_PROGRESS_DETAIL_LENGTH,
    MAX_RESULT_MESSAGE_LENGTH,
    PROGRESS_PROPERTIES,
    RESULT_PROPERTIES,
    RESULT_REQUEST_PROPERTIES,
    RESULT_STATES,
    TERMINAL_STATES,
    DTYPE_SIZES,
    JOB_CONTRACT_ALLOWLISTS,
    JOB_VERSION,
    MAX_DIMENSION,
    MAX_INPUT_REFERENCES,
    MAX_PAYLOAD_PROPERTIES,
    MAX_RANK,
    MAX_TENSOR_BYTES,
    SUBMISSION_PROPERTIES,
    boundedProperties,
    boundedText,
    elementCount,
    forecastReadingOf,
    isInputReference,
    isJobAcknowledgement,
    isJobResult,
    isJobSubmission,
    isProgress,
    isTerminalState,
    isPayload,
    isReferencePayload,
    isRequestId,
    isShape,
    isWorkloadId,
    jobCancelRequest,
    jobResultRequest,
    jobSubmission,
    readingOf,
    referenceBytes,
};
