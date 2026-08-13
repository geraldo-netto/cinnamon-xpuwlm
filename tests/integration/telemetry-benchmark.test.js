"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const Benchmark = require("../../files/cinnamon-xpuwlm@geraldo-netto/lib/workload-benchmark.js");
const {TelemetryWindow} = require("../../files/cinnamon-xpuwlm@geraldo-netto/lib/telemetry-window.js");

function evidence(inferenceMs) {
    return {
        correct: true,
        stages: {preprocessingMs: 1, transferMs: 1, inferenceMs, postprocessingMs: 1},
        memoryBytes: 10,
        vramBytes: 20,
        energyMilliJoules: null,
        contentionMs: 0,
    };
}

test("benchmark candidates can publish one shared redacted telemetry vocabulary", async () => {
    let telemetryTime = 0;
    const telemetry = new TelemetryWindow({
        clock: () => telemetryTime++,
        redact: (raw) => ({"inference-ms": raw.stages.inferenceMs, "vram-bytes": raw.vramBytes}),
        featureSchema: {version: 1, names: ["inference-ms", "vram-bytes"]},
        maxSamples: 8,
        retentionMs: 100,
    });
    telemetry.setConsent(true);
    const candidate = (id, kind, inferenceMs) => ({
        id,
        kind,
        run: async () => {
            const result = evidence(inferenceMs);
            telemetry.capture(id, result);
            return result;
        },
    });
    let benchmarkTime = 0;
    await Benchmark.runBenchmark({
        workloadId: "shared-evidence",
        measuredAt: 1,
        warmupRuns: 0,
        measuredRuns: 1,
        inputs: [{id: "one", size: 1, batchSize: 1, payload: null}],
        candidates: [candidate("host", "host", 4), candidate("gpu", "gpu", 2)],
    }, {clock: () => benchmarkTime++});

    const replay = telemetry.replay();
    assert.deepEqual(replay.entries.map((entry) => [entry.sourceId, entry.features]), [
        ["host", {"inference-ms": 4, "vram-bytes": 20}],
        ["gpu", {"inference-ms": 2, "vram-bytes": 20}],
    ]);
});
