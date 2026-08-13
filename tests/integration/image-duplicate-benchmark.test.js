"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const Fixture = require("../helpers/image-duplicate-fixture.js");
const Duplicate = require("../../files/cinnamon-xpuwlm@geraldo-netto/lib/image-duplicate-benchmark.js");

test("all duplicate strategies share labeled batches and expose crossovers", async () => {
    const report = await Duplicate.runDuplicateBenchmark(Fixture.plan(), {
        clock: Fixture.clock([5, 3, 6, 8, 7, 20, 15, 8, 4, 6]),
    });
    assert.deepEqual(report.candidates.map((candidate) => candidate.strategy), Duplicate.STRATEGIES);
    assert.deepEqual(Duplicate.recommendDuplicateCandidates(report).map((item) => ({
        input: item.inputId, candidate: item.candidateId, strategy: item.strategy,
    })), [
        {input: "small-pair", candidate: "simd", strategy: "phash-simd"},
        {input: "large-batch", candidate: "gpu-embedding", strategy: "embedding-gpu-batch"},
    ]);
});
