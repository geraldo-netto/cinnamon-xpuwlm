"use strict";

const TagFixture = require("./file-auto-tagging-fixture.js");

const DIGEST_A = "a".repeat(64);
const DIGEST_B = "b".repeat(64);
const DIGEST_C = "c".repeat(64);

function image(id, name, sizeBytes, sha256) {
    return {id, name, sizeBytes, mimeType: "image/png", sha256};
}

function pair(leftId, rightId, expectedRelated) {
    return {leftId, rightId, expectedRelated};
}

function input(id, images, pairs) {
    return {id, images, pairs};
}

function decision(currentInput, currentPair, overrides = {}) {
    const left = currentInput.images.find((item) => item.id === currentPair.leftId);
    const right = currentInput.images.find((item) => item.id === currentPair.rightId);
    return {
        leftId: currentPair.leftId,
        rightId: currentPair.rightId,
        leftSha256: left.sha256,
        rightSha256: right.sha256,
        byteIdentical: left.sha256 === right.sha256,
        related: currentPair.expectedRelated,
        score: currentPair.expectedRelated ? 0.95 : 0.1,
        ...overrides,
    };
}

function output(currentInput, options = {}) {
    return {
        decisions: currentInput.pairs.map((currentPair) => decision(
            currentInput,
            currentPair,
            options.decisions?.[`${currentPair.leftId}:${currentPair.rightId}`],
        )),
        stages: {
            preprocessingMs: 1, transferMs: 0, inferenceMs: 1, postprocessingMs: 1,
        },
        memoryBytes: 1024,
        vramBytes: 0,
        energyMilliJoules: null,
        contentionMs: 0,
    };
}

function candidate(id, kind, strategy, options = {}) {
    return {
        id,
        kind,
        strategy,
        async compare(currentInput, context) {
            return output(currentInput, options.outputs?.[context.inputId] ?? {});
        },
    };
}

function plan(overrides = {}) {
    const small = input("small-pair", [
        image("original", "original.png", 100, DIGEST_A),
        image("resized", "resized.jpg", 100, DIGEST_B),
    ], [pair("original", "resized", true)]);
    const large = input("large-batch", [
        image("copy-a", "copy-a.png", 1000, DIGEST_C),
        image("copy-b", "copy-b.png", 1000, DIGEST_C),
        image("other", "other.png", 1000, DIGEST_B),
    ], [pair("copy-a", "copy-b", true), pair("copy-a", "other", false)]);
    return {
        measuredAt: 1_700_000_000_000,
        warmupRuns: 0,
        measuredRuns: 1,
        inputs: [small, large],
        candidates: [
            candidate("scalar", "host", "phash-scalar"),
            candidate("simd", "host", "phash-simd"),
            candidate("gpu-phash", "gpu", "phash-gpu-batch"),
            candidate("gpu-embedding", "gpu", "embedding-gpu-batch"),
            candidate("hybrid", "hybrid", "hybrid-cascade"),
        ],
        ...overrides,
    };
}

module.exports = {
    DIGEST_A, DIGEST_B, DIGEST_C, candidate, decision, image, input, output, pair, plan,
    clock: TagFixture.clock,
};
