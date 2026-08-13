"use strict";

// Review consumes the already validated media representation. Every comment is
// bound to a slide/page and bounded source span; all proposed prose stays editable.

const Media = require("./media-transcription.js");
const Validation = require("./validation.js");

const VERSION = 1;
const MAX_ITEMS = Media.MAX_PRESENTATION_SLIDES;
const MAX_LIST = 16;
const MAX_TEXT = 16_384;
const SUPPORTED_SUFFIXES = Object.freeze([".odp", ".pdf", ".pptx"]);
const SOURCE_FIELDS = Object.freeze(["fileName", "sourceSha256", "modality", "durationMs"]);
const EVIDENCE_FIELDS = Object.freeze(["source", "start", "end"]);
const REVIEW_FIELDS = Object.freeze([
    "number", "observations", "speakerNotes", "accessibilityText", "questions", "evidence",
]);
const RESULT_FIELDS = Object.freeze(["version", "sourceSha256", "slides"]);
const {DIGEST} = Validation;

class PresentationReviewError extends Error {
    constructor(code, detail) {
        super(detail);
        this.name = "PresentationReviewError";
        this.code = code;
    }
}

const isRecord = Validation.isRecord;
const exactKeys = Validation.exactKeys;

function boundedText(value, minimum = 0) {
    return typeof value === "string"
        && !value.includes("\0")
        && Validation.boundedText(value, minimum, MAX_TEXT);
}

function suffixOf(name) {
    if (typeof name !== "string") {
        return "";
    }
    const dot = name.lastIndexOf(".");
    return dot <= 0 ? "" : name.slice(dot).toLowerCase();
}

function validSource(value) {
    return exactKeys(value, SOURCE_FIELDS)
        && boundedText(value.fileName, 1)
        && SUPPORTED_SUFFIXES.includes(suffixOf(value.fileName))
        && DIGEST.test(value.sourceSha256)
        && ["document", "presentation"].includes(value.modality)
        && value.durationMs === null;
}

function sourceSlides(transcription) {
    if (!isRecord(transcription) || !validSource(transcription.source)
        || !Array.isArray(transcription.visuals)
        || transcription.visuals.length < 1 || transcription.visuals.length > MAX_ITEMS) {
        throw new PresentationReviewError("source-invalid", "presentation review source is invalid");
    }
    const slides = transcription.visuals.map((visual, index) => ({
        number: visual.slideNumber ?? visual.pageNumber,
        visibleText: visual.visibleText,
        description: visual.description,
        expectedNumber: index + 1,
    }));
    if (!slides.every((slide) => (
        slide.number === slide.expectedNumber
        && boundedText(slide.visibleText)
        && boundedText(slide.description, 1)
    ))) {
        throw new PresentationReviewError("source-invalid", "slide evidence is invalid or unordered");
    }
    return Object.freeze(slides.map(({expectedNumber: _expectedNumber, ...slide}) => (
        Object.freeze(slide)
    )));
}

function validStringList(value, minimum = 0) {
    return Array.isArray(value)
        && value.length >= minimum
        && value.length <= MAX_LIST
        && value.every((item) => boundedText(item, 1));
}

function evidenceText(slide, source) {
    return source === "visible-text" ? slide.visibleText : slide.description;
}

function validEvidence(value, slide) {
    if (!exactKeys(value, EVIDENCE_FIELDS)
        || !["visible-text", "visual-description"].includes(value.source)) {
        return false;
    }
    const text = evidenceText(slide, value.source);
    return Number.isInteger(value.start)
        && Number.isInteger(value.end)
        && value.start >= 0
        && value.end > value.start
        && value.end <= [...text].length;
}

function validReviewProse(value) {
    return validStringList(value.observations)
        && boundedText(value.speakerNotes)
        && boundedText(value.accessibilityText, 1)
        && validStringList(value.questions);
}

function validReviewEvidence(value, slide) {
    return Array.isArray(value.evidence)
        && value.evidence.length >= 1
        && value.evidence.length <= MAX_LIST
        && value.evidence.every((item) => validEvidence(item, slide));
}

function validReview(value, slide) {
    return exactKeys(value, REVIEW_FIELDS)
        && value.number === slide.number
        && validReviewProse(value)
        && validReviewEvidence(value, slide);
}

function reviewResult(value, transcription) {
    const slides = sourceSlides(transcription);
    if (!exactKeys(value, RESULT_FIELDS)
        || value.version !== VERSION
        || value.sourceSha256 !== transcription.source.sourceSha256
        || !Array.isArray(value.slides)
        || value.slides.length !== slides.length
        || !value.slides.every((review, index) => validReview(review, slides[index]))) {
        throw new PresentationReviewError("result-invalid", "presentation review is invalid");
    }
    return Object.freeze({
        version: VERSION,
        sourceSha256: value.sourceSha256,
        editable: true,
        slides: Object.freeze(value.slides.map((review) => Object.freeze({
            ...review,
            observations: Object.freeze([...review.observations]),
            questions: Object.freeze([...review.questions]),
            evidence: Object.freeze(review.evidence.map((item) => Object.freeze({...item}))),
            editable: true,
        }))),
    });
}

module.exports = {
    MAX_ITEMS,
    MAX_LIST,
    MAX_TEXT,
    SUPPORTED_SUFFIXES,
    VERSION,
    PresentationReviewError,
    reviewResult,
    sourceSlides,
    suffixOf,
    validEvidence,
    validReview,
    validSource,
    validStringList,
};
