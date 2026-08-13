"use strict";

const TagFixture = require("./file-auto-tagging-fixture.js");

function sample(sequence, overrides = {}) {
    return {
        sequence,
        minuteBucket: 540,
        weekday: 1,
        appClass: 1,
        deviceClass: 0,
        activeSeconds: 600,
        transitionCount: 2,
        ...overrides,
    };
}

function expected(id, actionId) {
    return {id, actionId};
}

function input(id, samples, expectedSuggestions) {
    return {id, featureVersion: 1, samples, expectedSuggestions};
}

function suggestion(id, actionId, evidenceSequences, overrides = {}) {
    return {id, actionId, confidence: 0.95, evidenceSequences, ...overrides};
}

function output(currentInput, options = {}) {
    return {
        suggestions: options.suggestions ?? currentInput.expectedSuggestions.map((item) => suggestion(
            item.id, item.actionId, [currentInput.samples[0].sequence],
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
        async recognize(currentInput, context) {
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
            input("short", [sample(1)], [expected("morning-dev", "prepare-development")]),
            input("long", [sample(10), sample(11), sample(12)], [
                expected("meeting", "prepare-meeting"),
            ]),
        ],
        candidates: [
            candidate("statistics", "host", "statistical"),
            candidate("host-model", "host", "host-model"),
            candidate("vulkan", "gpu", "gpu-model"),
            candidate("hybrid", "hybrid", "hybrid"),
        ],
        ...overrides,
    };
}

module.exports = {
    candidate, clock: TagFixture.clock, expected, input, output, plan, sample, suggestion,
};
