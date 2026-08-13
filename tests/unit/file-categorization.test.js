"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const Fixture = require("../helpers/file-categorization-fixture.js");
const Categorization = require("../../files/cinnamon-xpuwlm@geraldo-netto/lib/file-categorization.js");

test("taxonomy is fixed, unique, and shared with tags", () => {
    assert.equal(Categorization.TAXONOMY_VERSION, 1);
    assert.equal(new Set(Categorization.CATEGORIES).size, Categorization.CATEGORIES.length);
    assert.equal(Object.isFrozen(Categorization.CATEGORIES), true);
    for (const category of Categorization.CATEGORIES) {
        assert.equal(Categorization.validCategory(category), true);
    }
    for (const value of [null, "", "unknown", "Finance"]) {
        assert.equal(Categorization.validCategory(value), false);
    }
});

test("labeled files preserve the auto-tagging file boundary", () => {
    const current = Fixture.plan().inputs[0].files[0];
    assert.equal(Categorization.validFile(current), true);
    assert.deepEqual(Categorization.taggingFile(current), {
        id: "scan-1", name: "invoice.png", sizeBytes: 100,
        mimeType: "image/png", expectedTags: ["invoice"],
    });
    for (const fault of [
        null,
        {...current, extra: true},
        {...current, expectedCategory: "unknown"},
        {...current, expectedTags: ["Bad Tag"]},
    ]) {
        assert.equal(Categorization.validFile(fault), false);
    }
});

test("labeled inputs remain closed and bounded", () => {
    const input = Fixture.plan().inputs[1];
    assert.equal(Categorization.validInput(input), true);
    assert.deepEqual(Categorization.taggingInput(input).files.map((file) => file.id), [
        "report-1", "notes-1",
    ]);
    for (const fault of [null, {...input, extra: true}, {...input, files: []}]) {
        assert.equal(Categorization.validInput(fault), false);
    }
});

test("candidate kind requires its exact feature source", () => {
    for (const candidate of Fixture.plan().candidates) {
        assert.equal(Categorization.validCandidate(candidate), true);
    }
    const current = Fixture.plan().candidates[1];
    assert.equal(Categorization.validCandidate({...current, featureSource: "mime-metadata"}), false);
    assert.equal(Categorization.validCandidate({...current, extra: true}), false);
    assert.equal(Categorization.validCandidate(null), false);
});

test("category and tags must both match for correctness", () => {
    const input = Fixture.plan().inputs[0];
    const valid = [Fixture.prediction("scan-1", "receipt", ["invoice"])];
    assert.equal(Categorization.validPredictions(valid, input), true);
    assert.equal(Categorization.predictionsCorrect(valid, input), true);
    assert.equal(Categorization.predictionsCorrect([{...valid[0], category: "finance"}], input), false);
    assert.equal(Categorization.predictionsCorrect([{...valid[0], tags: ["scan"]}], input), false);
    for (const fault of [
        null, [], [valid[0], valid[0]], [{...valid[0], extra: true}],
        [{...valid[0], fileId: "other"}], [{...valid[0], category: "unknown"}],
    ]) {
        assert.equal(Categorization.validPredictions(fault, input), false);
    }
});

test("candidate output is closed and produces common evidence", () => {
    const input = Fixture.plan().inputs[0];
    const valid = Fixture.output(input);
    assert.equal(Categorization.validCandidateOutput(valid, input), true);
    assert.equal(Categorization.observation(valid, input).correct, true);
    assert.equal(Object.isFrozen(Categorization.observation(valid, input).stages), true);
    for (const fault of [null, {...valid, extra: true}, {...valid, predictions: []}]) {
        assert.equal(Categorization.validCandidateOutput(fault, input), false);
        assert.throws(() => Categorization.observation(fault, input), /output is invalid/u);
    }
});

test("plans reject malformed inputs and mismatched feature matrices", () => {
    const plan = Fixture.plan();
    assert.doesNotThrow(() => Categorization.validatePlan(plan));
    for (const fault of [
        null,
        {...plan, inputs: null},
        {...plan, inputs: [{...plan.inputs[0], extra: true}]},
        {...plan, candidates: null},
        {...plan, candidates: [{...plan.candidates[0], kind: "gpu"}]},
        {...plan, measuredRuns: 0},
    ]) {
        assert.throws(() => Categorization.validatePlan(fault));
    }
});

test("review output combines category and tags without apply capability", () => {
    const input = Fixture.plan().inputs[0];
    const predictions = [Fixture.prediction("scan-1", "receipt", ["invoice"])];
    const review = Categorization.reviewCategorization(input, predictions, "hybrid-vulkan");
    assert.equal(review.reviewOnly, true);
    assert.deepEqual(review.items[0], {
        fileId: "scan-1", fileName: "invoice.png", family: "image",
        category: "receipt", tags: ["invoice"],
    });
    for (const key of ["apply", "move", "rename", "delete", "watch"]) {
        assert.equal(Object.hasOwn(review, key), false);
    }
    assert.throws(() => Categorization.reviewCategorization(null, predictions, "candidate"));
    assert.throws(() => Categorization.reviewCategorization(input, [], "candidate"));
    assert.throws(() => Categorization.reviewCategorization(input, predictions, "Bad id"));
});
