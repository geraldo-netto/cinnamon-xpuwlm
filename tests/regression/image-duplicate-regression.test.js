"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const Fixture = require("../helpers/image-duplicate-fixture.js");
const Duplicate = require("../../files/cinnamon-xpuwlm@geraldo-netto/lib/image-duplicate-benchmark.js");

test("regression: fast GPU false positives cannot win the accuracy gate", async () => {
    const plan = Fixture.plan();
    const inaccurate = Fixture.candidate("gpu-embedding", "gpu", "embedding-gpu-batch", {
        outputs: {"small-pair": {decisions: {"original:resized": {related: false}}}},
    });
    const report = await Duplicate.runDuplicateBenchmark({
        ...plan,
        inputs: [plan.inputs[0]],
        candidates: plan.candidates.map((candidate) => (
            candidate.strategy === "embedding-gpu-batch" ? inaccurate : candidate
        )),
    }, {clock: Fixture.clock([5, 3, 6, 1, 7])});
    assert.equal(report.candidates[3].summaries[0].accuracy, 0);
    assert.equal(Duplicate.recommendDuplicateCandidates(report, 1)[0].candidateId, "simd");
});

test("regression: malformed reports fail closed", () => {
    for (const report of [null, {}, {workloadId: "other"}, {
        workloadId: Duplicate.WORKLOAD_ID, inputs: [], candidates: [],
    }]) {
        assert.throws(() => Duplicate.recommendDuplicateCandidates(report), /report is invalid/u);
    }
});
