"use strict";

function file(id, name, sizeBytes, expectedTags, overrides = {}) {
    return {
        id,
        name,
        sizeBytes,
        mimeType: name.endsWith(".pdf") ? "application/pdf" : "image/png",
        expectedTags,
        ...overrides,
    };
}

function input(id, files) {
    return {id, files};
}

function prediction(fileId, tags) {
    return {fileId, tags};
}

function output(currentInput, options = {}) {
    return {
        predictions: currentInput.files.map((item) => prediction(
            item.id,
            options.tags?.[item.id] ?? item.expectedTags,
        )),
        stages: {
            preprocessingMs: 1,
            transferMs: options.transferMs ?? 0,
            inferenceMs: options.inferenceMs ?? 1,
            postprocessingMs: 1,
        },
        memoryBytes: options.memoryBytes ?? 1024,
        vramBytes: options.vramBytes ?? 0,
        energyMilliJoules: options.energyMilliJoules ?? null,
        contentionMs: options.contentionMs ?? 0,
    };
}

function candidate(id, kind, options = {}) {
    return {
        id,
        kind,
        async tag(currentInput, context) {
            const override = options.outputs?.[context.inputId] ?? {};
            return output(currentInput, override);
        },
    };
}

function plan(overrides = {}) {
    const small = input("one-image", [file("image-1", "capture.png", 100, ["screenshot"])]);
    const large = input("document-batch", [
        file("document-1", "report.pdf", 1000, ["report"]),
        file("image-2", "scan.png", 500, ["scan"]),
    ]);
    return {
        measuredAt: 1_700_000_000_000,
        warmupRuns: 1,
        measuredRuns: 1,
        inputs: [small, large],
        candidates: [
            candidate("metadata", "host"),
            candidate("vulkan", "gpu"),
            candidate("metadata-vulkan", "hybrid"),
        ],
        ...overrides,
    };
}

function clock(durations) {
    const values = [];
    let now = 0;
    for (const duration of durations) {
        values.push(now, now + duration);
        now += duration;
    }
    let index = 0;
    return () => values[index++];
}

module.exports = {candidate, clock, file, input, output, plan, prediction};
