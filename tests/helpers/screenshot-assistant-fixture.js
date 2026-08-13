"use strict";

const DIGEST = "d".repeat(64);

function source(kind = "screenshot") {
    return {
        kind,
        explicit: true,
        path: kind === "screenshot" ? "/tmp/capture.png" : "/data/chart.jpg",
        name: kind === "screenshot" ? "capture.png" : "chart.jpg",
        size: 4096,
        regular: true,
        symlink: false,
        captureStartedMs: kind === "screenshot" ? 1000 : null,
    };
}

function vision() {
    return {
        source: {fileName: "capture.png", sourceSha256: DIGEST, modality: "image", durationMs: null},
        visuals: [{
            timestampMs: null,
            slideNumber: null,
            pageNumber: null,
            visibleText: "Error 42 — שלום",
            description: "A dialog shows an error beside a chart.",
        }],
    };
}

function measurements(kind = "screenshot") {
    return {
        captureMs: kind === "screenshot" ? 12 : 0,
        preprocessingMs: 5,
        inferenceMs: 30,
        postprocessingMs: 3,
        totalMs: kind === "screenshot" ? 52 : 40,
    };
}

function candidate(kind = "screenshot") {
    return {
        version: 1,
        sourceSha256: DIGEST,
        visibleText: "Error 42 — שלום",
        sceneDescription: "A dialog shows an error beside a chart.",
        explanation: {
            kind: "error",
            text: "The dialog reports error 42.",
            evidence: {source: "visible-text", start: 0, end: 8},
        },
        transformations: [{kind: "translate", start: 11, end: 15, result: "hello"}],
        measurements: measurements(kind),
    };
}

module.exports = {DIGEST, candidate, measurements, source, vision};
