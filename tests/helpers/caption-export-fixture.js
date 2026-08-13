"use strict";

const DIGEST = "c".repeat(64);

function transcription(modality = "video") {
    return {
        source: {
            fileName: modality === "video" ? "recording.webm" : "recording.flac",
            sourceSha256: DIGEST,
            modality,
            durationMs: 5000,
        },
        speech: {language: "en", segments: [
            {startMs: 0, endMs: 1200, text: "Hello"},
            {startMs: 1500, endMs: 3000, text: "World"},
        ]},
        visuals: modality === "video" ? [
            {timestampMs: 0, slideNumber: null, pageNumber: null, visibleText: "Title", description: "Opening frame"},
            {timestampMs: 2500, slideNumber: null, pageNumber: null, visibleText: "", description: "Chart frame"},
        ] : [],
    };
}

function measurements() {
    return {
        decodeMs: 10,
        preprocessingMs: 20,
        inferenceMs: 30,
        postprocessingMs: 10,
        renderMs: 5,
        exportMs: 5,
        totalMs: 85,
    };
}

function exportRequest(overrides = {}) {
    return {
        requestId: "caption-export-1",
        format: "vtt",
        track: "speech",
        destination: "/tmp/captions.vtt",
        measurements: measurements(),
        ...overrides,
    };
}

module.exports = {DIGEST, exportRequest, measurements, transcription};
