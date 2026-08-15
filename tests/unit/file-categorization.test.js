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

// The taxonomy is closed on purpose: a category outside it reaches the review
// surface as a label nobody defined, and the whole point of this workflow is
// that a human reviews a bounded vocabulary rather than free text.
test("only the published taxonomy is a category", () => {
    for (const category of Categorization.CATEGORIES) {
        assert.equal(Categorization.validCategory(category), true, category);
    }
    assert.equal(Categorization.CATEGORIES.includes("other"), true, "the escape hatch exists");

    for (const value of [
        "Receipt", "RECEIPT", " receipt", "receipt ", "invoice", "",
        null, undefined, 7, ["receipt"], {category: "receipt"},
    ]) {
        assert.equal(Categorization.validCategory(value), false, JSON.stringify(value));
    }
});

test("a file and a prediction are refused unless they name a known category", () => {
    const file = Fixture.file("scan-1", "invoice.png", 100, ["invoice"], "receipt");
    assert.equal(Categorization.validFile(file), true);
    assert.equal(Categorization.validFile({...file, expectedCategory: "invoice"}), false);
    assert.equal(Categorization.validFile({...file, unexpected: true}), false, "closed record");

    const input = Fixture.input("single", [file]);
    const prediction = Fixture.prediction("scan-1", "receipt", ["invoice"]);
    assert.equal(Categorization.validPrediction(prediction, input), true);
    // A prediction has to be about a file the input actually carries.
    assert.equal(
        Categorization.validPrediction({...prediction, fileId: "absent"}, input),
        false,
        "unknown file",
    );
    assert.equal(
        Categorization.validPrediction({...prediction, category: "invoice"}, input),
        false,
        "unknown category",
    );
    assert.equal(
        Categorization.validPrediction({...prediction, unexpected: true}, input),
        false,
        "closed record",
    );
});

// Each refusal names which part of the plan was wrong, because "the plan is
// invalid" sends whoever wrote it to read all of it.
test("plan validation names the part that is wrong", () => {
    const plan = Fixture.plan();
    assert.doesNotThrow(() => Categorization.validatePlan(plan));

    for (const [label, candidate, code] of [
        ["not a record", null, "plan-invalid"],
        ["inputs missing", {...plan, inputs: undefined}, "plan-invalid"],
        ["candidates missing", {...plan, candidates: undefined}, "plan-invalid"],
        ["input shape", {...plan, inputs: [{id: "", files: []}]}, "inputs-invalid"],
        [
            "candidate shape",
            {...plan, candidates: [{id: "x", kind: "cpu", categorize: () => {}}]},
            "candidates-invalid",
        ],
    ]) {
        assert.throws(
            () => Categorization.validatePlan(candidate),
            (error) => error.code === code,
            `${label} should raise ${code}`,
        );
    }
});

// The recommendation is delegated to the tagging benchmark, so the identity
// checks here are what stop a report from another workload or another taxonomy
// version being ranked as if it were this one.
test("a report is ranked only when it is this workload at this taxonomy version", () => {
    const report = {
        workloadId: Categorization.WORKLOAD_ID,
        taxonomyVersion: Categorization.TAXONOMY_VERSION,
        inputs: [{id: "batch", families: ["image"], size: 1, batchSize: 1}],
        candidates: [
            {id: "metadata", kind: "host", summaries: [{accuracy: 0.95, p95LatencyMs: 10}]},
        ],
    };
    const [only] = Categorization.recommendCategorizers(report);
    assert.equal(only.candidateId, "metadata");

    for (const [label, candidate] of [
        ["not a record", null],
        ["foreign workload", {...report, workloadId: "file-auto-tagging"}],
        ["missing taxonomy version", {...report, taxonomyVersion: undefined}],
        ["older taxonomy version", {...report, taxonomyVersion: Categorization.TAXONOMY_VERSION - 1}],
        ["measurements missing", {...report, candidates: []}],
    ]) {
        assert.throws(
            () => Categorization.recommendCategorizers(candidate),
            (error) => error.code === "report-invalid",
            label,
        );
    }

    // A nonsense floor is refused rather than admitting or excluding all.
    assert.throws(
        () => Categorization.recommendCategorizers(report, 1.5),
        (error) => error.code === "report-invalid",
    );
});
