"use strict";

// The host must explicitly capture or select one image before the ready vision
// workload is addressed. Output is review-only and cannot activate desktop UI.

const Media = require("./media-transcription.js");
const Preprocessing = require("./media-preprocessing.js");

const VERSION = 1;
const MAX_TEXT = Media.MAX_TEXT_CHARACTERS;
const MAX_TRANSFORMATIONS = 16;
const SOURCE_FIELDS = Object.freeze([
    "kind", "explicit", "path", "name", "size", "regular", "symlink", "captureStartedMs",
]);
const EVIDENCE_FIELDS = Object.freeze(["source", "start", "end"]);
const EXPLANATION_FIELDS = Object.freeze(["kind", "text", "evidence"]);
const TRANSFORMATION_FIELDS = Object.freeze(["kind", "start", "end", "result"]);
const MEASUREMENT_FIELDS = Object.freeze([
    "captureMs", "preprocessingMs", "inferenceMs", "postprocessingMs", "totalMs",
]);
const CANDIDATE_FIELDS = Object.freeze([
    "version", "sourceSha256", "visibleText", "sceneDescription", "explanation",
    "transformations", "measurements",
]);
const DIGEST = /^[a-f0-9]{64}$/u;

class ScreenshotAssistantError extends Error {
    constructor(code, detail) {
        super(detail);
        this.name = "ScreenshotAssistantError";
        this.code = code;
    }
}

function isRecord(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value);
}

function exactKeys(value, fields) {
    return isRecord(value) && Object.keys(value).length === fields.length
        && fields.every((name) => Object.hasOwn(value, name));
}

function boundedText(value, minimum = 0) {
    return typeof value === "string" && !value.includes("\0")
        && [...value].length >= minimum && [...value].length <= MAX_TEXT;
}

function imageFile(value) {
    return validImageIdentity(value) && Number.isSafeInteger(value.size)
        && value.size >= 1 && value.size <= Preprocessing.MAX_SOURCE_BYTES
        && value.regular === true && value.symlink === false;
}

function validImageIdentity(value) {
    return typeof value.path === "string" && Preprocessing.mediaFamily(value.path) === "image"
        && typeof value.name === "string" && !value.name.includes("/")
        && !value.name.includes("\\");
}

function validCaptureTime(value) {
    return value.kind === "screenshot"
        ? Number.isSafeInteger(value.captureStartedMs) && value.captureStartedMs >= 0
        : value.captureStartedMs === null;
}

function validExplicitSource(value) {
    return exactKeys(value, SOURCE_FIELDS) && ["screenshot", "file"].includes(value.kind)
        && value.explicit === true && imageFile(value) && validCaptureTime(value);
}

function selectedSource(value) {
    if (!validExplicitSource(value)) {
        throw new ScreenshotAssistantError("source-invalid", "explicit screenshot or image file is invalid");
    }
    return Object.freeze({...value});
}

function visionRequest(requestId, value) {
    const source = selectedSource(value);
    return Object.freeze(Media.submission(requestId, source));
}

function validVisionEvidence(value) {
    return isRecord(value) && isRecord(value.source) && value.source.modality === "image"
        && DIGEST.test(value.source.sourceSha256) && Array.isArray(value.visuals)
        && value.visuals.length === 1 && boundedText(value.visuals[0].visibleText)
        && boundedText(value.visuals[0].description, 1);
}

function evidenceText(source, visibleText, sceneDescription) {
    return source === "visible-text" ? visibleText : sceneDescription;
}

function validEvidence(value, visibleText, sceneDescription) {
    if (!exactKeys(value, EVIDENCE_FIELDS)
        || !["visible-text", "scene-description"].includes(value.source)) {
        return false;
    }
    const source = evidenceText(value.source, visibleText, sceneDescription);
    return Number.isInteger(value.start) && Number.isInteger(value.end)
        && value.start >= 0 && value.start < value.end && value.end <= [...source].length;
}

function validExplanation(value, visibleText, sceneDescription) {
    return exactKeys(value, EXPLANATION_FIELDS)
        && ["scene", "error", "chart"].includes(value.kind)
        && boundedText(value.text, 1)
        && validEvidence(value.evidence, visibleText, sceneDescription);
}

function validTransformation(value, visibleText) {
    return exactKeys(value, TRANSFORMATION_FIELDS)
        && ["translate", "rewrite", "explain"].includes(value.kind)
        && Number.isInteger(value.start) && Number.isInteger(value.end)
        && value.start >= 0 && value.start < value.end
        && value.end <= [...visibleText].length && boundedText(value.result, 1);
}

function validTransformations(value, visibleText) {
    return Array.isArray(value) && value.length <= MAX_TRANSFORMATIONS
        && value.every((item) => validTransformation(item, visibleText));
}

function validMeasurements(value, sourceKind) {
    if (!exactKeys(value, MEASUREMENT_FIELDS)
        || !MEASUREMENT_FIELDS.every((name) => Number.isFinite(value[name]) && value[name] >= 0)) {
        return false;
    }
    const stages = MEASUREMENT_FIELDS.slice(0, -1).reduce((sum, name) => sum + value[name], 0);
    const validCapture = sourceKind === "screenshot" ? value.captureMs > 0 : value.captureMs === 0;
    return validCapture && value.totalMs >= stages;
}

function validCandidate(value, vision, source) {
    const visual = vision.visuals[0];
    return exactKeys(value, CANDIDATE_FIELDS) && value.version === VERSION
        && value.sourceSha256 === vision.source.sourceSha256
        && value.visibleText === visual.visibleText
        && value.sceneDescription === visual.description
        && validExplanation(value.explanation, value.visibleText, value.sceneDescription)
        && validTransformations(value.transformations, value.visibleText)
        && validMeasurements(value.measurements, source.kind);
}

function freezeEvidence(value) {
    return Object.freeze({...value});
}

function screenshotResult(value, vision, sourceValue) {
    const source = selectedSource(sourceValue);
    if (!validVisionEvidence(vision)) {
        throw new ScreenshotAssistantError("vision-invalid", "vision result is invalid");
    }
    if (!validCandidate(value, vision, source)) {
        throw new ScreenshotAssistantError("result-invalid", "assistant result is not grounded");
    }
    return Object.freeze({
        version: VERSION,
        sourceSha256: value.sourceSha256,
        sourceKind: source.kind,
        visibleText: value.visibleText,
        sceneDescription: value.sceneDescription,
        explanation: Object.freeze({...value.explanation, evidence: freezeEvidence(value.explanation.evidence)}),
        transformations: Object.freeze(value.transformations.map((item) => Object.freeze({
            ...item,
            selectedText: [...value.visibleText].slice(item.start, item.end).join(""),
            reviewOnly: true,
        }))),
        measurements: Object.freeze({...value.measurements}),
        reviewOnly: true,
    });
}

module.exports = {
    MAX_TEXT,
    MAX_TRANSFORMATIONS,
    VERSION,
    ScreenshotAssistantError,
    boundedText,
    evidenceText,
    exactKeys,
    freezeEvidence,
    imageFile,
    screenshotResult,
    selectedSource,
    validCandidate,
    validCaptureTime,
    validEvidence,
    validExplicitSource,
    validExplanation,
    validMeasurements,
    validImageIdentity,
    validTransformation,
    validTransformations,
    validVisionEvidence,
    visionRequest,
};
