"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const Benchmark = require("../../files/cinnamon-xpuwlm@geraldo-netto/lib/workload-benchmark.js");

function evidence() {
    return {
        correct: true,
        stages: {preprocessingMs: 0, transferMs: 0, inferenceMs: 1, postprocessingMs: 0},
        memoryBytes: 0,
        vramBytes: 0,
        energyMilliJoules: 0,
        contentionMs: 0,
    };
}

test("regression: candidate order cannot invent a crossover on equal measurements", async () => {
    let time = 0;
    const report = await Benchmark.runBenchmark({
        workloadId: "ties",
        measuredAt: 0,
        warmupRuns: 0,
        measuredRuns: 2,
        inputs: [
            {id: "one", size: 1, batchSize: 1, payload: null},
            {id: "two", size: 2, batchSize: 2, payload: null},
        ],
        candidates: [
            {id: "zeta", kind: "host", run: async () => evidence()},
            {id: "alpha", kind: "gpu", run: async () => evidence()},
        ],
    }, {clock: () => time++});

    assert.deepEqual(report.crossovers, []);
    assert.deepEqual(report.candidates.map((candidate) => candidate.id), ["zeta", "alpha"]);
});
