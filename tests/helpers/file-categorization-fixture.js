"use strict";

const TagFixture = require("./file-auto-tagging-fixture.js");

function file(id, name, sizeBytes, expectedTags, expectedCategory) {
    return {...TagFixture.file(id, name, sizeBytes, expectedTags), expectedCategory};
}

function input(id, files) {
    return {id, files};
}

function prediction(fileId, category, tags) {
    return {fileId, category, tags};
}

function output(currentInput, options = {}) {
    return {
        ...TagFixture.output(currentInput, options),
        predictions: currentInput.files.map((item) => prediction(
            item.id,
            options.categories?.[item.id] ?? item.expectedCategory,
            options.tags?.[item.id] ?? item.expectedTags,
        )),
    };
}

function candidate(id, kind, featureSource, options = {}) {
    return {
        id,
        kind,
        featureSource,
        async categorize(currentInput, context) {
            return output(currentInput, options.outputs?.[context.inputId] ?? {});
        },
    };
}

function plan(overrides = {}) {
    return {
        measuredAt: 1_700_000_000_000,
        warmupRuns: 0,
        measuredRuns: 1,
        inputs: [
            input("single", [file("scan-1", "invoice.png", 100, ["invoice"], "receipt")]),
            input("batch", [
                file("report-1", "quarterly.pdf", 1000, ["quarterly"], "finance"),
                file("notes-1", "notes.md", 500, ["meeting"], "correspondence"),
            ]),
        ],
        candidates: [
            candidate("metadata", "host", "mime-metadata"),
            candidate("layout-vulkan", "gpu", "text-layout"),
            candidate("hybrid-vulkan", "hybrid", "mime-metadata-text-layout"),
        ],
        ...overrides,
    };
}

module.exports = {candidate, file, input, output, plan, prediction};
