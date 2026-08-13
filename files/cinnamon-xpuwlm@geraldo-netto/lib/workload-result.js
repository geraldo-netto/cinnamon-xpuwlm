"use strict";

const Validation = require("./validation.js");

const VERSION = 1;
const MAX_ITEMS = 512;
const MAX_VECTOR = 4096;
const MAX_TEXT = 1000;
const MAX_IDENTIFIER_LENGTH = 120;
const IDENTIFIER = /^[A-Za-z0-9]+(?:[._-][A-Za-z0-9]+)*$/u;
const {DIGEST} = Validation;
const RESULT_KINDS = Object.freeze([
    "risk-score", "forecast", "ranking", "detection",
    "mask", "embedding", "labels", "media-evidence",
]);
const ROOT_KEYS = Object.freeze([
    "version", "kind", "workloadId", "operationId", "createdAt", "payload",
]);

class ResultError extends Error {
    constructor(code, detail) {
        super(detail);
        this.name = "ResultError";
        this.code = code;
    }
}

const isRecord = Validation.isRecord;
const exactKeys = Validation.exactKeys;

function identifier(value) {
    return typeof value === "string"
        && value.length >= 1
        && value.length <= MAX_IDENTIFIER_LENGTH
        && IDENTIFIER.test(value);
}

function boundedText(value, maximum = MAX_TEXT) {
    return Validation.boundedText(value, 1, maximum);
}

function finite(value) {
    return typeof value === "number" && Number.isFinite(value);
}

function probability(value) {
    return finite(value) && value >= 0 && value <= 1;
}

function boundedList(value, minimum = 0, maximum = MAX_ITEMS) {
    return Array.isArray(value) && value.length >= minimum && value.length <= maximum;
}

function unique(values) {
    return new Set(values).size === values.length;
}

function riskScore(value) {
    return exactKeys(value, ["score", "threshold", "label", "evidenceIds"])
        && probability(value.score)
        && probability(value.threshold)
        && boundedText(value.label, 160)
        && boundedList(value.evidenceIds, 0, 64)
        && value.evidenceIds.every(identifier)
        && unique(value.evidenceIds);
}

function forecastPoint(value) {
    return exactKeys(value, ["offset", "value", "lower", "upper"])
        && Number.isSafeInteger(value.offset)
        && value.offset >= 0
        && finite(value.value)
        && finite(value.lower)
        && finite(value.upper)
        && value.lower <= value.value
        && value.value <= value.upper;
}

function forecast(value) {
    return exactKeys(value, ["horizon", "unit", "points"])
        && Number.isSafeInteger(value.horizon)
        && value.horizon >= 1
        && boundedText(value.unit, 40)
        && boundedList(value.points, 1)
        && value.points.every(forecastPoint)
        && unique(value.points.map((point) => point.offset))
        && value.points.every((point) => point.offset <= value.horizon);
}

function rankedItem(value) {
    return exactKeys(value, ["id", "rank", "score"])
        && identifier(value.id)
        && Number.isSafeInteger(value.rank)
        && value.rank >= 1
        && finite(value.score);
}

function ranking(value) {
    return exactKeys(value, ["items"])
        && boundedList(value.items, 1)
        && value.items.every(rankedItem)
        && unique(value.items.map((item) => item.id))
        && unique(value.items.map((item) => item.rank));
}

function normalizedBox(value) {
    return exactKeys(value, ["x", "y", "width", "height"])
        && [value.x, value.y, value.width, value.height].every(probability)
        && value.width > 0
        && value.height > 0
        && value.x + value.width <= 1
        && value.y + value.height <= 1;
}

function detectionItem(value) {
    return exactKeys(value, ["label", "score", "box"])
        && boundedText(value.label, 160)
        && probability(value.score)
        && normalizedBox(value.box);
}

function detection(value) {
    return exactKeys(value, ["items"])
        && boundedList(value.items)
        && value.items.every(detectionItem);
}

function positiveDimension(value) {
    return Number.isSafeInteger(value) && value >= 1 && value <= 65536;
}

function mask(value) {
    return exactKeys(value, ["width", "height", "sourceWidth", "sourceHeight", "encoding", "dataSha256"])
        && positiveDimension(value.width)
        && positiveDimension(value.height)
        && positiveDimension(value.sourceWidth)
        && positiveDimension(value.sourceHeight)
        && ["rle", "png"].includes(value.encoding)
        && typeof value.dataSha256 === "string"
        && DIGEST.test(value.dataSha256);
}

function embedding(value) {
    return exactKeys(value, ["dimensions", "dtype", "vector"])
        && Number.isSafeInteger(value.dimensions)
        && value.dimensions >= 1
        && value.dimensions <= MAX_VECTOR
        && value.dtype === "float32"
        && boundedList(value.vector, 1, MAX_VECTOR)
        && value.vector.length === value.dimensions
        && value.vector.every(finite);
}

function labelItem(value) {
    return exactKeys(value, ["label", "score"])
        && boundedText(value.label, 160)
        && probability(value.score);
}

function labels(value) {
    return exactKeys(value, ["items"])
        && boundedList(value.items, 1)
        && value.items.every(labelItem)
        && unique(value.items.map((item) => item.label));
}

function validMediaRange(value) {
    return Number.isSafeInteger(value.startMs)
        && value.startMs >= 0
        && Number.isSafeInteger(value.endMs)
        && value.endMs > value.startMs;
}

function mediaSegment(value) {
    return exactKeys(value, ["startMs", "endMs", "kind", "text", "confidence", "sourceRef"])
        && validMediaRange(value)
        && ["speech", "visible-text", "scene"].includes(value.kind)
        && boundedText(value.text)
        && probability(value.confidence)
        && identifier(value.sourceRef);
}

function mediaEvidence(value) {
    return exactKeys(value, ["durationMs", "segments"])
        && Number.isSafeInteger(value.durationMs)
        && value.durationMs >= 1
        && boundedList(value.segments, 1)
        && value.segments.every(mediaSegment)
        && value.segments.every((segment) => segment.endMs <= value.durationMs);
}

const PAYLOAD_VALIDATORS = Object.freeze({
    "risk-score": riskScore,
    forecast,
    ranking,
    detection,
    mask,
    embedding,
    labels,
    "media-evidence": mediaEvidence,
});

function validEnvelope(value) {
    return exactKeys(value, ROOT_KEYS)
        && value.version === VERSION
        && RESULT_KINDS.includes(value.kind)
        && identifier(value.workloadId)
        && identifier(value.operationId)
        && Number.isSafeInteger(value.createdAt)
        && value.createdAt >= 0;
}

function isWorkloadResult(value) {
    return validEnvelope(value) && PAYLOAD_VALIDATORS[value.kind](value.payload);
}

function deepFreeze(value) {
    if (!isRecord(value) && !Array.isArray(value)) {
        return value;
    }
    for (const child of Object.values(value)) {
        deepFreeze(child);
    }
    return Object.freeze(value);
}

function createWorkloadResult(value) {
    if (!isWorkloadResult(value)) {
        throw new ResultError("result-invalid", "workload result is invalid");
    }
    return deepFreeze(JSON.parse(JSON.stringify(value)));
}

module.exports = {
    VERSION,
    MAX_ITEMS,
    MAX_VECTOR,
    MAX_TEXT,
    MAX_IDENTIFIER_LENGTH,
    RESULT_KINDS,
    ResultError,
    isWorkloadResult,
    createWorkloadResult,
    riskScore,
    forecast,
    ranking,
    detection,
    mask,
    embedding,
    labels,
    mediaEvidence,
};
