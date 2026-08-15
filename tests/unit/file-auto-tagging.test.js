"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const Fixture = require("../helpers/file-auto-tagging-fixture.js");
const Tagging = require("../../files/cinnamon-xpuwlm@geraldo-netto/lib/file-auto-tagging.js");

test("supported organizer files resolve to explicit benchmark families", () => {
    for (const [name, family] of [
        ["notes.txt", "text"], ["README.MD", "text"], ["report.PDF", "document"],
        ["scan.png", "image"], ["photo.JPG", "image"], ["photo.jpeg", "image"],
        ["preview.webp", "image"],
    ]) {
        assert.equal(Tagging.familyOf(name), family, name);
    }
    assert.equal(Tagging.familyOf("archive.zip"), "");
    assert.equal(Tagging.familyOf(null), "");
    assert.equal(Object.isFrozen(Tagging.FAMILY_DEFINITIONS), true);
});

test("tags and labeled files are closed, bounded, and family-aware", () => {
    assert.equal(Tagging.validTags([]), true);
    assert.equal(Tagging.validTags(["screenshot", "error-message"]), true);
    for (const tags of [
        null, ["duplicate", "duplicate"], ["Bad Tag"], ["x".repeat(49)],
        Array.from({length: 17}, (_value, index) => `tag-${index}`),
    ]) {
        assert.equal(Tagging.validTags(tags), false);
    }
    const valid = Fixture.file("image-1", "capture.png", 1, ["screenshot"]);
    assert.equal(Tagging.validFile(valid), true);
    for (const fault of [
        null,
        {...valid, extra: true},
        {...valid, id: "Bad id"},
        {...valid, name: ".hidden.png"},
        {...valid, name: "folder/capture.png"},
        {...valid, name: "folder\\capture.png"},
        {...valid, name: "capture.bin"},
        {...valid, sizeBytes: 0},
        {...valid, sizeBytes: Tagging.MAX_FILE_BYTES + 1},
        {...valid, mimeType: ""},
        {...valid, expectedTags: ["Bad Tag"]},
    ]) {
        assert.equal(Tagging.validFile(fault), false);
    }
});

test("benchmark inputs preserve batch size, total bytes, and sorted families", () => {
    const current = Fixture.plan().inputs[1];
    assert.equal(Tagging.validInput(current), true);
    assert.equal(Tagging.inputSize(current), 1500);
    assert.deepEqual(Tagging.inputFamilies(current), ["document", "image"]);
    assert.equal(Object.isFrozen(Tagging.inputFamilies(current)), true);
    for (const fault of [
        null,
        {...current, extra: true},
        {...current, id: "Bad id"},
        {...current, files: []},
        {...current, files: Array.from({length: 17}, (_value, index) => (
            Fixture.file(`file-${index}`, `file-${index}.png`, 1, [])
        ))},
        {...current, files: [current.files[0], current.files[0]]},
    ]) {
        assert.equal(Tagging.validInput(fault), false);
    }
});

test("benchmark requires unique host, GPU, and hybrid candidates", () => {
    const valid = Fixture.plan();
    assert.doesNotThrow(() => Tagging.validatePlan(valid));
    const faults = [
        null,
        {...valid, measuredAt: -1},
        {...valid, extra: true},
        {...valid, warmupRuns: "one"},
        {...valid, warmupRuns: -1},
        {...valid, warmupRuns: Tagging.MAX_RUNS + 1},
        {...valid, measuredRuns: null},
        {...valid, measuredRuns: 0},
        {...valid, measuredRuns: Tagging.MAX_RUNS + 1},
        {...valid, inputs: []},
        {...valid, inputs: [valid.inputs[0], valid.inputs[0]]},
        {...valid, candidates: []},
        {...valid, candidates: [valid.candidates[0], valid.candidates[0]]},
        {...valid, candidates: [
            valid.candidates[0], valid.candidates[1],
            {...valid.candidates[2], id: "bad!id"},
        ]},
        {...valid, candidates: [
            valid.candidates[0], valid.candidates[1],
            {...valid.candidates[2], kind: "host"},
        ]},
    ];
    for (const fault of faults) {
        assert.throws(() => Tagging.validatePlan(fault), Tagging.AutoTaggingError);
    }
    assert.equal(Tagging.validCandidate({id: "host", kind: "host", tag() {}}), true);
    assert.equal(Tagging.validCandidate({id: "host", kind: "cpu", tag() {}}), false);
});

test("prediction validation is order-independent but coverage-exact", () => {
    const input = Fixture.plan().inputs[1];
    const predictions = [
        Fixture.prediction("image-2", ["scan"]),
        Fixture.prediction("document-1", ["report"]),
    ];
    assert.equal(Tagging.validPredictions(predictions, input), true);
    assert.equal(Tagging.predictionsCorrect(predictions, input), true);
    assert.equal(Tagging.sameTags(["scan", "invoice"], ["invoice", "scan"]), true);
    assert.equal(Tagging.sameTags(["scan"], ["invoice"]), false);
    for (const fault of [
        null,
        [],
        [predictions[0], predictions[0]],
        [{...predictions[0], extra: true}, predictions[1]],
        [{...predictions[0], fileId: "other"}, predictions[1]],
        [{...predictions[0], tags: ["Bad Tag"]}, predictions[1]],
    ]) {
        assert.equal(Tagging.validPredictions(fault, input), false);
    }
    const wrong = [predictions[0], {...predictions[1], tags: ["invoice"]}];
    assert.equal(Tagging.predictionsCorrect(wrong, input), false);
});

test("candidate output becomes common benchmark evidence with measured correctness", () => {
    const input = Fixture.plan().inputs[0];
    const valid = Fixture.output(input);
    const observed = Tagging.observation(valid, input);
    assert.equal(observed.correct, true);
    assert.equal(Object.isFrozen(observed), true);
    assert.equal(Object.isFrozen(observed.stages), true);
    assert.equal(Tagging.observation({
        ...valid,
        predictions: [{fileId: "image-1", tags: ["photo"]}],
    }, input).correct, false);
    for (const fault of [
        null,
        {...valid, extra: true},
        {...valid, predictions: []},
        {...valid, stages: {...valid.stages, inferenceMs: -1}},
        {...valid, memoryBytes: -1},
    ]) {
        assert.equal(Tagging.validCandidateOutput(fault, input), false);
        assert.throws(() => Tagging.observation(fault, input), /candidate output is invalid/u);
    }
});

test("review plan exposes tags only and no mutation capability", () => {
    const input = Fixture.plan().inputs[1];
    const predictions = input.files.map((file) => Fixture.prediction(file.id, file.expectedTags));
    const review = Tagging.reviewTagPlan(input, predictions, "metadata-vulkan");
    assert.equal(review.reviewOnly, true);
    assert.deepEqual(review.items.map((item) => item.family), ["document", "image"]);
    assert.equal(Object.isFrozen(review.items[0].tags), true);
    for (const forbidden of ["apply", "move", "rename", "delete", "watch"]) {
        assert.equal(Object.hasOwn(review, forbidden), false);
    }
    for (const args of [
        [null, predictions, "metadata"],
        [input, [], "metadata"],
        [input, predictions, "Bad id"],
    ]) {
        assert.throws(() => Tagging.reviewTagPlan(...args), /review-only tagging plan is invalid/u);
    }
});

function recommendationReport(overrides = {}) {
    return {
        workloadId: Tagging.WORKLOAD_ID,
        inputs: [{id: "batch-1", families: ["text"], size: 4, batchSize: 2}],
        candidates: [
            {id: "host-suffix", kind: "host", summaries: [{accuracy: 0.95, p95LatencyMs: 40}]},
            {id: "gpu-model", kind: "gpu", summaries: [{accuracy: 0.97, p95LatencyMs: 25}]},
        ],
        ...overrides,
    };
}

// The recommendation decides which implementation actually runs, so the
// threshold, the tie-break, and the "nothing qualified" answer are the whole
// contract: a rule that drifts picks a slower or less accurate tagger and says
// nothing about it.
test("the fastest candidate at or above the accuracy floor is recommended", () => {
    const [only] = Tagging.recommendTaggers(recommendationReport());
    assert.equal(only.inputId, "batch-1");
    assert.equal(only.candidateId, "gpu-model", "lowest measured p95 wins");
    assert.equal(only.candidateKind, "gpu");
    assert.equal(only.reason, "measured-lowest-p95");
    assert.deepEqual(only.families, ["text"]);
    assert.equal(only.size, 4);
    assert.equal(only.batchSize, 2);

    // The floor is inclusive: a candidate exactly at it qualifies.
    const exact = Tagging.recommendTaggers(recommendationReport({
        candidates: [
            {id: "slow-sure", kind: "host", summaries: [{accuracy: 0.9, p95LatencyMs: 90}]},
        ],
    }))[0];
    assert.equal(exact.candidateId, "slow-sure");

    // Below it, nothing is recommended and the reason says which rule refused.
    const none = Tagging.recommendTaggers(recommendationReport({
        candidates: [
            {id: "fast-wrong", kind: "gpu", summaries: [{accuracy: 0.89, p95LatencyMs: 1}]},
        ],
    }))[0];
    assert.equal(none.candidateId, null);
    assert.equal(none.candidateKind, null);
    assert.equal(none.reason, "accuracy-threshold-not-met");

    // Accuracy is never traded for speed: a faster candidate under the floor
    // loses to a slower one above it.
    const honest = Tagging.recommendTaggers(recommendationReport({
        candidates: [
            {id: "fast-wrong", kind: "gpu", summaries: [{accuracy: 0.5, p95LatencyMs: 1}]},
            {id: "slow-right", kind: "host", summaries: [{accuracy: 0.99, p95LatencyMs: 500}]},
        ],
    }))[0];
    assert.equal(honest.candidateId, "slow-right");
});

test("a measured tie is broken by identifier, so the answer is reproducible", () => {
    const tie = (ids) => Tagging.recommendTaggers(recommendationReport({
        candidates: ids.map((id) => ({
            id, kind: "host", summaries: [{accuracy: 0.95, p95LatencyMs: 30}],
        })),
    }))[0].candidateId;

    // Whatever order they were measured in, the same candidate is chosen.
    assert.equal(tie(["beta", "alpha"]), "alpha");
    assert.equal(tie(["alpha", "beta"]), "alpha");
    assert.equal(tie(["b", "a", "c"]), "a");
});

test("each input is answered on its own measurements", () => {
    const report = recommendationReport({
        inputs: [
            {id: "small", families: ["text"], size: 1, batchSize: 1},
            {id: "large", families: ["image"], size: 900, batchSize: 8},
        ],
        candidates: [
            {
                id: "host-suffix",
                kind: "host",
                summaries: [{accuracy: 0.95, p95LatencyMs: 5}, {accuracy: 0.95, p95LatencyMs: 800}],
            },
            {
                id: "gpu-model",
                kind: "gpu",
                summaries: [{accuracy: 0.95, p95LatencyMs: 60}, {accuracy: 0.95, p95LatencyMs: 90}],
            },
        ],
    });
    const [small, large] = Tagging.recommendTaggers(report);
    assert.equal(small.candidateId, "host-suffix", "the host wins on a small batch");
    assert.equal(large.candidateId, "gpu-model", "and loses on a large one");
});

test("a report that is not the measured shape is refused rather than ranked", () => {
    const cases = {
        "not a record": null,
        "foreign workload": recommendationReport({workloadId: "other-workload"}),
        "no inputs": recommendationReport({inputs: []}),
        "input id": recommendationReport({inputs: [{id: "", families: [], size: 1, batchSize: 1}]}),
        "input families": recommendationReport({
            inputs: [{id: "batch-1", families: "text", size: 1, batchSize: 1}],
        }),
        "input size": recommendationReport({
            inputs: [{id: "batch-1", families: [], size: 0, batchSize: 1}],
        }),
        "input batch": recommendationReport({
            inputs: [{id: "batch-1", families: [], size: 1, batchSize: 0}],
        }),
        "no candidates": recommendationReport({candidates: []}),
        "candidate id": recommendationReport({
            candidates: [{id: "", kind: "host", summaries: [{accuracy: 1, p95LatencyMs: 1}]}],
        }),
        "candidate kind": recommendationReport({
            candidates: [{id: "a", kind: "cpu", summaries: [{accuracy: 1, p95LatencyMs: 1}]}],
        }),
        // One summary per input, or the index the ranking uses is meaningless.
        "summary count": recommendationReport({
            candidates: [{id: "a", kind: "host", summaries: []}],
        }),
        "accuracy above one": recommendationReport({
            candidates: [{id: "a", kind: "host", summaries: [{accuracy: 1.1, p95LatencyMs: 1}]}],
        }),
        "accuracy below zero": recommendationReport({
            candidates: [{id: "a", kind: "host", summaries: [{accuracy: -0.1, p95LatencyMs: 1}]}],
        }),
        "accuracy not finite": recommendationReport({
            candidates: [
                {id: "a", kind: "host", summaries: [{accuracy: Number.NaN, p95LatencyMs: 1}]},
            ],
        }),
        "negative latency": recommendationReport({
            candidates: [{id: "a", kind: "host", summaries: [{accuracy: 1, p95LatencyMs: -1}]}],
        }),
        "latency not finite": recommendationReport({
            candidates: [
                {id: "a", kind: "host", summaries: [{accuracy: 1, p95LatencyMs: Infinity}]},
            ],
        }),
    };
    for (const [label, report] of Object.entries(cases)) {
        assert.throws(() => Tagging.recommendTaggers(report), /report is invalid/u, label);
    }

    // The floor itself is a probability, and a nonsense one is refused rather
    // than silently admitting or excluding everything.
    for (const floor of [-0.1, 1.1, Number.NaN, "0.9", null]) {
        assert.throws(
            () => Tagging.recommendTaggers(recommendationReport(), floor),
            /report is invalid/u,
            String(floor),
        );
    }
});
