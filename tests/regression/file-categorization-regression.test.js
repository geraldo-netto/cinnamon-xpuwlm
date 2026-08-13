"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const TagFixture = require("../helpers/file-auto-tagging-fixture.js");
const Fixture = require("../helpers/file-categorization-fixture.js");
const Categorization = require("../../files/cinnamon-xpuwlm@geraldo-netto/lib/file-categorization.js");

test("regression: fast category-only inference cannot hide wrong tags", async () => {
    const plan = Fixture.plan();
    const inaccurate = Fixture.candidate("layout-vulkan", "gpu", "text-layout", {
        outputs: {single: {tags: {"scan-1": ["wrong"]}}},
    });
    const report = await Categorization.runCategorizationBenchmark({
        ...plan,
        candidates: [plan.candidates[0], inaccurate, plan.candidates[2]],
    }, {clock: TagFixture.clock([5, 1, 7, 5, 1, 7])});
    assert.equal(report.candidates[1].summaries[0].accuracy, 0);
    assert.equal(Categorization.recommendCategorizers(report, 1)[0].candidateId, "metadata");
});

test("regression: foreign or malformed reports fail closed", () => {
    for (const report of [null, {}, {workloadId: "file-categorization", taxonomyVersion: 2}]) {
        assert.throws(() => Categorization.recommendCategorizers(report), /report is invalid/u);
    }
    const shaped = {workloadId: "file-categorization", taxonomyVersion: 1};
    assert.throws(() => Categorization.recommendCategorizers(shaped), /report is invalid/u);
});
