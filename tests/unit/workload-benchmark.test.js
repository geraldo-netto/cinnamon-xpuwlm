"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const Benchmark = require("../../files/cinnamon-xpuwlm@geraldo-netto/lib/workload-benchmark.js");

function observation(overrides = {}) {
    return {
        correct: true,
        stages: {preprocessingMs: 1, transferMs: 2, inferenceMs: 3, postprocessingMs: 4},
        memoryBytes: 100,
        vramBytes: 200,
        energyMilliJoules: 50,
        contentionMs: 5,
        ...overrides,
    };
}

function clock(values) {
    let index = 0;
    return () => values[index++];
}

function plan(overrides = {}) {
    return {
        workloadId: "image-tags",
        measuredAt: 1_700_000_000_000,
        warmupRuns: 1,
        measuredRuns: 2,
        inputs: [
            {id: "small", size: 10, batchSize: 1, payload: Object.freeze({value: "small"})},
            {id: "large", size: 100, batchSize: 4, payload: Object.freeze({value: "large"})},
        ],
        candidates: [
            {id: "host", kind: "host", run: async () => observation()},
            {id: "vulkan", kind: "gpu", run: async () => observation()},
        ],
        ...overrides,
    };
}

test("benchmark measures the same matrix after isolated warm-up and records crossovers", async () => {
    const calls = [];
    const candidate = (id, kind, correctness) => ({
        id,
        kind,
        run: async (payload, context) => {
            calls.push({id, payload, ...context});
            return observation({
                correct: correctness(context.inputId, context.runIndex),
                memoryBytes: id === "host" ? 120 : 80,
                vramBytes: id === "host" ? 0 : 400,
                energyMilliJoules: context.inputId === "small" ? null : (id === "host" ? 20 : 10),
                contentionMs: id === "host" ? 2 : 1,
            });
        },
    });
    const benchmarkPlan = plan({
        candidates: [
            candidate("host", "host", () => true),
            candidate("vulkan", "gpu", (inputId, runIndex) => inputId === "large" || runIndex === 0),
        ],
    });
    // Warm-up: host=10ms, gpu=20ms for both inputs. Measurements make host
    // fastest for small and Vulkan fastest for large, producing one crossover.
    const times = [
        0, 10, 10, 30, 30, 40, 40, 60,
        60, 65, 65, 75, 75, 95, 95, 100,
        100, 105, 105, 115, 115, 135, 135, 140,
    ];
    const report = await Benchmark.runBenchmark(benchmarkPlan, {clock: clock(times)});

    assert.equal(calls.length, 12);
    assert.deepEqual(calls.slice(0, 4).map((item) => [item.id, item.inputId, item.warmup]), [
        ["host", "small", true], ["vulkan", "small", true],
        ["host", "large", true], ["vulkan", "large", true],
    ]);
    assert.equal(calls.every((item) => item.payload === benchmarkPlan.inputs.find(
        (input) => input.id === item.inputId,
    ).payload), true);
    assert.deepEqual(report.inputs, [
        {id: "small", size: 10, batchSize: 1}, {id: "large", size: 100, batchSize: 4},
    ]);
    assert.equal(report.version, 1);
    assert.equal(report.candidates[0].summaries[0].accuracy, 1);
    assert.equal(report.candidates[1].summaries[0].accuracy, 0.5);
    assert.equal(report.candidates[0].summaries[0].p50LatencyMs, 5);
    assert.equal(report.candidates[0].summaries[0].p95LatencyMs, 5);
    assert.equal(report.candidates[0].summaries[0].startupLatencyMs, 10);
    assert.equal(report.candidates[0].summaries[0].warmupRuns, 1);
    assert.equal(report.candidates[0].summaries[0].warmupP50LatencyMs, 10);
    assert.equal(report.candidates[0].summaries[0].warmupP95LatencyMs, 10);
    assert.equal(report.candidates[0].summaries[0].batchSize, 1);
    assert.equal(report.candidates[0].summaries[0].throughputPerSecond, 200);
    assert.deepEqual(report.candidates[0].summaries[0].stageMeanMs, {
        preprocessingMs: 1, transferMs: 2, inferenceMs: 3, postprocessingMs: 4,
    });
    assert.equal(report.candidates[0].summaries[0].peakMemoryBytes, 120);
    assert.equal(report.candidates[0].summaries[0].peakVramBytes, 0);
    assert.equal(report.candidates[0].summaries[0].energyMilliJoulesPerRun, null);
    assert.equal(report.candidates[0].summaries[0].p95ContentionMs, 2);
    assert.deepEqual(report.crossovers, [
        {objective: "p95-latency", inputSize: 100, batchSize: 4, fromCandidateId: "host", toCandidateId: "vulkan"},
        {objective: "throughput", inputSize: 100, batchSize: 4, fromCandidateId: "host", toCandidateId: "vulkan"},
    ]);
    assert.equal(Object.isFrozen(report), true);
    assert.equal(Object.isFrozen(report.candidates[0].summaries[0].stageMeanMs), true);
});

test("benchmark reports every observable resource and deterministic ties", async () => {
    const noResources = observation({memoryBytes: null, vramBytes: null, energyMilliJoules: null});
    const benchmarkPlan = plan({
        warmupRuns: 0,
        measuredRuns: 1,
        inputs: [{id: "only", size: 1, batchSize: 1, payload: null}],
        candidates: [
            {id: "zeta", kind: "hybrid", run: async () => noResources},
            {id: "alpha", kind: "gpu", run: async () => noResources},
        ],
    });
    const report = await Benchmark.runBenchmark(benchmarkPlan, {clock: clock([0, 0, 0, 0])});
    const summary = report.candidates[0].summaries[0];

    assert.equal(summary.throughputPerSecond, null);
    assert.equal(summary.peakMemoryBytes, null);
    assert.equal(summary.peakVramBytes, null);
    assert.equal(summary.energyMilliJoulesPerRun, null);
    assert.equal(summary.startupLatencyMs, 0);
    assert.equal(summary.warmupRuns, 0);
    assert.equal(summary.warmupP50LatencyMs, null);
    assert.equal(summary.warmupP95LatencyMs, null);
    assert.deepEqual(report.crossovers, []);
    assert.equal(Benchmark.percentile([9, 1, 4, 7], 0.5), 4);
    assert.equal(Benchmark.percentile([9, 1, 4, 7], 0.95), 9);
});

test("benchmark rejects malformed plans, candidates, inputs, clocks, and evidence", async () => {
    const invalidPlans = [
        null,
        {...plan(), extra: true},
        {...plan(), workloadId: "Bad id"},
        {...plan(), measuredAt: -1},
        {...plan(), warmupRuns: -1},
        {...plan(), measuredRuns: 0},
        {...plan(), inputs: []},
        {...plan(), inputs: [
            {id: "same", size: 1, batchSize: 1, payload: null},
            {id: "same", size: 2, batchSize: 1, payload: null},
        ]},
        {...plan(), inputs: [
            {id: "one", size: 1, batchSize: 1, payload: null},
            {id: "two", size: 1, batchSize: 1, payload: null},
        ]},
        {...plan(), inputs: [{id: "bad id", size: 1, batchSize: 1, payload: null}]},
        {...plan(), candidates: []},
        {...plan(), candidates: [plan().candidates[0], plan().candidates[0]]},
        {...plan(), candidates: [{id: "one", kind: "cpu", run: () => {}}, plan().candidates[1]]},
    ];
    for (const invalid of invalidPlans) {
        assert.throws(() => Benchmark.validatePlan(invalid), Benchmark.BenchmarkError);
    }
    assert.throws(() => Benchmark.validatePlan({
        ...plan(), inputs: [{id: "one", size: 0, batchSize: 1, payload: null}],
    }), /input is invalid/u);
    await assert.rejects(Benchmark.runBenchmark(plan(), {clock: null}), /clock must be a function/u);
    await assert.rejects(Benchmark.runBenchmark(plan({warmupRuns: 0}), {
        clock: clock([2, 1]),
    }), /finite and monotonic/u);

    const invalidObservations = [
        null,
        {...observation(), extra: true},
        {...observation(), correct: 1},
        {...observation(), stages: {...observation().stages, transferMs: -1}},
        {...observation(), memoryBytes: 1.5},
        {...observation(), vramBytes: -1},
        {...observation(), energyMilliJoules: Number.NaN},
        {...observation(), contentionMs: Number.POSITIVE_INFINITY},
    ];
    for (const invalid of invalidObservations) {
        assert.equal(Benchmark.validObservation(invalid), false);
    }
    const badCandidate = {id: "host", kind: "host", run: async () => invalidObservations[1]};
    await assert.rejects(Benchmark.runBenchmark(plan({
        warmupRuns: 0,
        candidates: [badCandidate, plan().candidates[1]],
    }), {clock: clock([0, 1])}), /returned invalid evidence/u);
});
