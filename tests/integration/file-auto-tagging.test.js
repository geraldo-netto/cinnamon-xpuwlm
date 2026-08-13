"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const Fixture = require("../helpers/file-auto-tagging-fixture.js");
const Organizer = require("../../files/cinnamon-xpuwlm@geraldo-netto/lib/file-organizer.js");
const Tagging = require("../../files/cinnamon-xpuwlm@geraldo-netto/lib/file-auto-tagging.js");

test("tagging matrix records the same batches and measured crossovers", async () => {
    const plan = Fixture.plan();
    const durations = [
        5, 10, 7, 20, 5, 8,
        5, 10, 7, 20, 5, 8,
    ];
    const report = await Tagging.runAutoTaggingBenchmark(plan, {clock: Fixture.clock(durations)});
    assert.equal(report.workloadId, "file-auto-tagging");
    assert.deepEqual(report.inputs, [
        {id: "one-image", size: 100, batchSize: 1, families: ["image"]},
        {id: "document-batch", size: 1500, batchSize: 2, families: ["document", "image"]},
    ]);
    assert.equal(report.candidates.every((candidate) => (
        candidate.summaries.every((summary) => summary.accuracy === 1)
    )), true);
    assert.deepEqual(Tagging.recommendTaggers(report), [
        {
            inputId: "one-image", families: ["image"], size: 100, batchSize: 1,
            candidateId: "metadata", candidateKind: "host", reason: "measured-lowest-p95",
        },
        {
            inputId: "document-batch", families: ["document", "image"], size: 1500,
            batchSize: 2, candidateId: "vulkan", candidateKind: "gpu",
            reason: "measured-lowest-p95",
        },
    ]);
    assert.equal(Object.isFrozen(report), true);
});

test("auto-tag review remains compatible with organizer tag bounds", () => {
    assert.equal(Tagging.MAX_FILES_PER_BATCH, Organizer.MAX_PLAN_ITEMS);
    assert.equal(Tagging.MAX_TAGS, Organizer.MAX_TAGS);
    const input = Fixture.plan().inputs[0];
    const predictions = [Fixture.prediction("image-1", ["screenshot", "error-message"])];
    const review = Tagging.reviewTagPlan(input, predictions, "vulkan");
    assert.equal(review.items[0].tags.every((tag) => /^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(tag)), true);
});
