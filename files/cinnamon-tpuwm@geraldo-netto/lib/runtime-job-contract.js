"use strict";

// What a job submission and its acknowledgement look like on the wire.
//
// Mirrors `runtime-job-submit.schema.json` and
// `runtime-job-acknowledgement.schema.json`, plus the reference shape
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

const JOB_CONTRACT_ALLOWLISTS = Object.freeze({
    submission: SUBMISSION_PROPERTIES,
    acknowledgement: ACKNOWLEDGEMENT_PROPERTIES,
    reference: REFERENCE_PROPERTIES,
});

module.exports = {
    ACKNOWLEDGEMENT_PROPERTIES,
    ACKNOWLEDGEMENT_STATUSES,
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
    isInputReference,
    isJobAcknowledgement,
    isJobSubmission,
    isPayload,
    isReferencePayload,
    isRequestId,
    isShape,
    isWorkloadId,
    jobSubmission,
    referenceBytes,
};
