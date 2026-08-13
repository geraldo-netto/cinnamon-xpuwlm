"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const test = require("node:test");

const Qualification = require("../../files/cinnamon-xpuwlm@geraldo-netto/lib/artifact-qualification.js");
const Benchmark = require("../../files/cinnamon-xpuwlm@geraldo-netto/lib/workload-benchmark.js");
const Manifest = require("../../files/cinnamon-xpuwlm@geraldo-netto/lib/workload-manifest.js");
const {valid} = require("../helpers/artifact-qualification-fixture.js");

function evidence() {
    return {
        correct: true,
        stages: {preprocessingMs: 0, transferMs: 0, inferenceMs: 1, postprocessingMs: 0},
        memoryBytes: 1,
        vramBytes: 1,
        energyMilliJoules: null,
        contentionMs: 0,
    };
}

test("qualification pins the exact shared benchmark record and tensor contract", async () => {
    let time = 0;
    const benchmark = await Benchmark.runBenchmark({
        workloadId: "qualified-model",
        measuredAt: 1,
        warmupRuns: 0,
        measuredRuns: 1,
        inputs: [{id: "one", size: 1, batchSize: 1, payload: null}],
        candidates: [
            {id: "host", kind: "host", run: async () => evidence()},
            {id: "gpu", kind: "gpu", run: async () => evidence()},
        ],
    }, {clock: () => time++});
    const tensor = {inputs: [{shape: [1, 8], dtype: "float32", layout: "NC"}]};
    const sha256 = (value) => crypto.createHash("sha256").update(value).digest("hex");
    const record = Qualification.createQualification(valid({
        tensorContractSha256: sha256(Manifest.canonicalJson(tensor)),
        hardwareEvidence: {
            ...valid().hardwareEvidence,
            benchmarkRecordSha256: sha256(Manifest.canonicalJson(benchmark)),
        },
    }));

    assert.equal(record.hardwareEvidence.benchmarkVersion, Benchmark.VERSION);
    assert.equal(record.hardwareEvidence.benchmarkRecordSha256, sha256(Manifest.canonicalJson(benchmark)));
    assert.equal(record.tensorContractSha256, sha256(Manifest.canonicalJson(tensor)));
});
