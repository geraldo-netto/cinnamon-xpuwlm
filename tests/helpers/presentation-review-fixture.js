"use strict";

const DIGEST = "a".repeat(64);

function transcription({fileName = "deck.pptx", modality = "presentation", count = 2} = {}) {
    return {
        source: {fileName, sourceSha256: DIGEST, modality, durationMs: null},
        visuals: Array.from({length: count}, (_value, index) => ({
            timestampMs: null,
            slideNumber: modality === "presentation" ? index + 1 : null,
            pageNumber: modality === "document" ? index + 1 : null,
            visibleText: `Title ${index + 1}`,
            description: `Chart for item ${index + 1}`,
        })),
    };
}

function slide(number, overrides = {}) {
    return {
        number,
        observations: [`Observation ${number}`],
        speakerNotes: `Notes ${number}`,
        accessibilityText: `Accessible slide ${number}`,
        questions: [`Question ${number}?`],
        evidence: [{source: "visible-text", start: 0, end: 5}],
        ...overrides,
    };
}

function result(source = transcription(), overrides = {}) {
    return {
        version: 1,
        sourceSha256: source.source.sourceSha256,
        slides: source.visuals.map((_visual, index) => slide(index + 1)),
        ...overrides,
    };
}

module.exports = {DIGEST, result, slide, transcription};
