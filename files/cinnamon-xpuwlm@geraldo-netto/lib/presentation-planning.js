"use strict";

// The language stage may propose this editable intermediate. Export is only a
// request for the host-owned deterministic action/confirmation boundary.

const Review = require("./presentation-review.js");
const Actions = require("./deterministic-action-port.js");
const Validation = require("./validation.js");

const VERSION = 1;
const MAX_ASSETS = 64;
const MAX_CITATIONS = 16;
const MAX_TEXT = Review.MAX_TEXT;
const EXPORT_FORMATS = Object.freeze(["odp", "pptx"]);
const ASSET_FIELDS = Object.freeze(["id", "sourceSha256"]);
const CITATION_FIELDS = Object.freeze(["sourceSlide", "evidenceIndex"]);
const SLIDE_FIELDS = Object.freeze([
    "number", "title", "body", "speakerNotes", "accessibilityText", "citations", "assetRefs",
]);
const PLAN_FIELDS = Object.freeze(["version", "sourceSha256", "title", "slides"]);
const EXPORT_FIELDS = Object.freeze(["requestId", "format", "destination"]);
const IDENTIFIER = /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/u;
const {DIGEST, REQUEST_ID} = Validation;

class PresentationPlanningError extends Error {
    constructor(code, detail) {
        super(detail);
        this.name = "PresentationPlanningError";
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

function validAsset(value) {
    return exactKeys(value, ASSET_FIELDS)
        && typeof value.id === "string"
        && IDENTIFIER.test(value.id)
        && DIGEST.test(value.sourceSha256);
}

function selectedAssets(value) {
    if (!Array.isArray(value)
        || value.length > MAX_ASSETS
        || !value.every(validAsset)
        || new Set(value.map((item) => item.id)).size !== value.length) {
        throw new PresentationPlanningError("assets-invalid", "selected presentation assets are invalid");
    }
    return new Map(value.map((item) => [item.id, Object.freeze({...item})]));
}

function validCitation(value, review) {
    const source = review.slides[value?.sourceSlide - 1];
    return exactKeys(value, CITATION_FIELDS)
        && source?.number === value.sourceSlide
        && Number.isInteger(value.evidenceIndex)
        && value.evidenceIndex >= 0
        && value.evidenceIndex < source.evidence.length;
}

function validCitations(value, review) {
    return Array.isArray(value)
        && value.length >= 1
        && value.length <= MAX_CITATIONS
        && value.every((citation) => validCitation(citation, review));
}

function validAssetRefs(value, assets) {
    return Array.isArray(value)
        && value.length <= MAX_ASSETS
        && value.every((id) => assets.has(id))
        && new Set(value).size === value.length;
}

function validPlannedSlide(value, index, review, assets) {
    return exactKeys(value, SLIDE_FIELDS)
        && value.number === index + 1
        && boundedText(value.title, 1)
        && boundedText(value.body)
        && boundedText(value.speakerNotes)
        && boundedText(value.accessibilityText, 1)
        && validCitations(value.citations, review)
        && validAssetRefs(value.assetRefs, assets);
}

function validReviewSource(review) {
    return isRecord(review) && review.version === Review.VERSION && review.editable === true;
}

function validPlanIdentity(value, review) {
    return exactKeys(value, PLAN_FIELDS)
        && value.version === VERSION
        && value.sourceSha256 === review.sourceSha256
        && boundedText(value.title, 1);
}

function validPlanSlides(value, review, assets) {
    return Array.isArray(value.slides)
        && value.slides.length >= 1
        && value.slides.length <= Review.MAX_ITEMS
        && value.slides.every((slide, index) => validPlannedSlide(slide, index, review, assets));
}

function plannedDeck(value, review, assetValues = []) {
    const assets = selectedAssets(assetValues);
    if (!validReviewSource(review)
        || !validPlanIdentity(value, review)
        || !validPlanSlides(value, review, assets)) {
        throw new PresentationPlanningError("plan-invalid", "presentation plan is invalid");
    }
    return Object.freeze({
        version: VERSION,
        sourceSha256: value.sourceSha256,
        title: value.title,
        editable: true,
        slides: Object.freeze(value.slides.map((slide) => Object.freeze({
            ...slide,
            citations: Object.freeze(slide.citations.map((item) => Object.freeze({...item}))),
            assetRefs: Object.freeze([...slide.assetRefs]),
            editable: true,
        }))),
        assets: Object.freeze([...assets.values()]),
    });
}

function validDestination(value, format) {
    return Validation.validExportDestination(value, format, EXPORT_FORMATS, MAX_TEXT);
}

function validExport(value) {
    return exactKeys(value, EXPORT_FIELDS)
        && REQUEST_ID.test(value.requestId)
        && validDestination(value.destination, value.format);
}

function exportActionRequest(deck, value) {
    if (!isRecord(deck) || deck.version !== VERSION || deck.editable !== true || !validExport(value)) {
        throw new PresentationPlanningError("export-invalid", "presentation export request is invalid");
    }
    const parameters = Object.freeze({
        version: VERSION,
        format: value.format,
        overwrite: false,
        deck,
    });
    if (!Actions.validParameters(parameters)) {
        throw new PresentationPlanningError("export-invalid", "presentation export exceeds action bounds");
    }
    return Object.freeze({
        requestId: value.requestId,
        actionId: "export-presentation",
        sourceResultSha256: deck.sourceSha256,
        targets: Object.freeze([value.destination]),
        parameters,
    });
}

module.exports = {
    MAX_ASSETS,
    MAX_CITATIONS,
    VERSION,
    PresentationPlanningError,
    exportActionRequest,
    plannedDeck,
    selectedAssets,
    validAsset,
    validAssetRefs,
    validCitation,
    validCitations,
    validDestination,
    validPlannedSlide,
};
