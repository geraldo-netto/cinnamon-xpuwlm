"use strict";

// Performance evidence is a matrix, not a backend preference. The harness
// gives every candidate the same ordered inputs, separates warm-up from
// measurement, and retains the stage and resource observations needed to
// explain where a crossover occurred.

const VERSION = 1;
const MAX_CANDIDATES = 8;
const MAX_INPUTS = 64;
const MAX_RUNS = 100;
const MAX_IDENTIFIER_LENGTH = 80;
const IDENTIFIER = /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/u;
const CANDIDATE_KINDS = Object.freeze(["host", "gpu", "hybrid"]);
const STAGE_NAMES = Object.freeze([
    "preprocessingMs", "transferMs", "inferenceMs", "postprocessingMs",
]);
const OBJECTIVES = Object.freeze([
    Object.freeze({name: "accuracy", field: "accuracy", direction: "maximum"}),
    Object.freeze({name: "p95-latency", field: "p95LatencyMs", direction: "minimum"}),
    Object.freeze({name: "throughput", field: "throughputPerSecond", direction: "maximum"}),
    Object.freeze({name: "energy", field: "energyMilliJoulesPerRun", direction: "minimum"}),
]);

class BenchmarkError extends Error {
    constructor(code, detail) {
        super(detail);
        this.name = "BenchmarkError";
        this.code = code;
    }
}

function isRecord(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value);
}

function exactKeys(value, expected) {
    return isRecord(value)
        && Object.keys(value).length === expected.length
        && expected.every((name) => Object.hasOwn(value, name));
}

function identifier(value) {
    return typeof value === "string"
        && value.length >= 1
        && value.length <= MAX_IDENTIFIER_LENGTH
        && IDENTIFIER.test(value);
}

function boundedInteger(value, minimum, maximum) {
    return Number.isInteger(value) && value >= minimum && value <= maximum;
}

function observable(value) {
    return value === null || (Number.isFinite(value) && value >= 0);
}

function resourceBytes(value) {
    return value === null || (Number.isSafeInteger(value) && value >= 0);
}

function validStages(value) {
    return exactKeys(value, STAGE_NAMES)
        && STAGE_NAMES.every((name) => Number.isFinite(value[name]) && value[name] >= 0);
}

function validObservation(value) {
    return exactKeys(value, [
        "correct", "stages", "memoryBytes", "vramBytes", "energyMilliJoules", "contentionMs",
    ])
        && typeof value.correct === "boolean"
        && validStages(value.stages)
        && resourceBytes(value.memoryBytes)
        && resourceBytes(value.vramBytes)
        && observable(value.energyMilliJoules)
        && Number.isFinite(value.contentionMs)
        && value.contentionMs >= 0;
}

function boundedCollection(value, minimum, maximum) {
    return Array.isArray(value) && value.length >= minimum && value.length <= maximum;
}

function validInput(input) {
    return exactKeys(input, ["id", "size", "batchSize", "payload"])
        && identifier(input.id)
        && Number.isSafeInteger(input.size)
        && input.size >= 1
        && Number.isSafeInteger(input.batchSize)
        && input.batchSize >= 1;
}

function validateInputs(inputs) {
    if (!boundedCollection(inputs, 1, MAX_INPUTS)) {
        throw new BenchmarkError("inputs-invalid", "benchmark inputs are outside their bound");
    }
    if (!inputs.every(validInput)) {
        throw new BenchmarkError("input-invalid", "benchmark input is invalid");
    }
    const identities = new Set(inputs.map((input) => input.id));
    const matrixPoints = new Set(inputs.map((input) => `${input.size}:${input.batchSize}`));
    if (identities.size !== inputs.length || matrixPoints.size !== inputs.length) {
        throw new BenchmarkError("input-duplicate", "benchmark input ids and matrix points must be unique");
    }
}

function validCandidate(candidate) {
    return exactKeys(candidate, ["id", "kind", "run"])
        && identifier(candidate.id)
        && CANDIDATE_KINDS.includes(candidate.kind)
        && typeof candidate.run === "function";
}

function validateCandidates(candidates) {
    if (!boundedCollection(candidates, 2, MAX_CANDIDATES)) {
        throw new BenchmarkError("candidates-invalid", "benchmark candidates are outside their bound");
    }
    if (!candidates.every(validCandidate)) {
        throw new BenchmarkError("candidate-invalid", "benchmark candidate is invalid");
    }
    const identities = new Set(candidates.map((candidate) => candidate.id));
    if (identities.size !== candidates.length) {
        throw new BenchmarkError("candidate-duplicate", "benchmark candidate ids must be unique");
    }
}

function validatePlan(plan) {
    if (!exactKeys(plan, [
        "workloadId", "measuredAt", "warmupRuns", "measuredRuns", "inputs", "candidates",
    ]) || !identifier(plan.workloadId)
        || !Number.isSafeInteger(plan.measuredAt)
        || plan.measuredAt < 0
        || !boundedInteger(plan.warmupRuns, 0, MAX_RUNS)
        || !boundedInteger(plan.measuredRuns, 1, MAX_RUNS)) {
        throw new BenchmarkError("plan-invalid", "benchmark plan is invalid");
    }
    validateInputs(plan.inputs);
    validateCandidates(plan.candidates);
}

function percentile(values, percentage) {
    const ordered = [...values].sort((left, right) => left - right);
    const index = Math.max(0, Math.ceil(percentage * ordered.length) - 1);
    return ordered[index];
}

function mean(values) {
    return values.reduce((total, value) => total + value, 0) / values.length;
}

function peak(values) {
    const observed = values.filter((value) => value !== null);
    return observed.length === 0 ? null : Math.max(...observed);
}

function energyPerRun(measurements) {
    const values = measurements.map((item) => item.energyMilliJoules);
    return values.every((value) => value !== null) ? mean(values) : null;
}

function warmupLatency(warmups, measurements) {
    const source = warmups.length > 0 ? warmups : measurements;
    return source[0].latencyMs;
}

function summarize(input, measurements, warmups) {
    const latencies = measurements.map((item) => item.latencyMs);
    const warmupLatencies = warmups.map((item) => item.latencyMs);
    const totalLatency = latencies.reduce((total, value) => total + value, 0);
    const stages = {};
    for (const name of STAGE_NAMES) {
        stages[name] = mean(measurements.map((item) => item.stages[name]));
    }
    return Object.freeze({
        inputId: input.id,
        inputSize: input.size,
        batchSize: input.batchSize,
        startupLatencyMs: warmupLatency(warmups, measurements),
        warmupRuns: warmups.length,
        warmupP50LatencyMs: warmups.length === 0 ? null : percentile(warmupLatencies, 0.5),
        warmupP95LatencyMs: warmups.length === 0 ? null : percentile(warmupLatencies, 0.95),
        runs: measurements.length,
        accuracy: measurements.filter((item) => item.correct).length / measurements.length,
        p50LatencyMs: percentile(latencies, 0.5),
        p95LatencyMs: percentile(latencies, 0.95),
        throughputPerSecond: totalLatency === 0 ? null : (measurements.length * 1000) / totalLatency,
        stageMeanMs: Object.freeze(stages),
        peakMemoryBytes: peak(measurements.map((item) => item.memoryBytes)),
        peakVramBytes: peak(measurements.map((item) => item.vramBytes)),
        energyMilliJoulesPerRun: energyPerRun(measurements),
        p95ContentionMs: percentile(measurements.map((item) => item.contentionMs), 0.95),
    });
}

async function observe(candidate, input, runIndex, warmup, clock) {
    const startedAt = clock();
    const result = await candidate.run(input.payload, Object.freeze({
        inputId: input.id, inputSize: input.size, batchSize: input.batchSize, runIndex, warmup,
    }));
    const finishedAt = clock();
    if (!Number.isFinite(startedAt) || !Number.isFinite(finishedAt) || finishedAt < startedAt) {
        throw new BenchmarkError("clock-invalid", "benchmark clock must be finite and monotonic");
    }
    if (!validObservation(result)) {
        throw new BenchmarkError("observation-invalid", `candidate ${candidate.id} returned invalid evidence`);
    }
    return Object.freeze({...result, stages: Object.freeze({...result.stages}), latencyMs: finishedAt - startedAt});
}

async function warmCandidates(plan, clock, buckets) {
    for (let runIndex = 0; runIndex < plan.warmupRuns; runIndex += 1) {
        for (const input of plan.inputs) {
            for (const candidate of plan.candidates) {
                const measurement = await observe(candidate, input, runIndex, true, clock);
                buckets.get(candidate.id).get(input.id).push(measurement);
            }
        }
    }
}

function measurementBuckets(plan) {
    const buckets = new Map();
    for (const candidate of plan.candidates) {
        buckets.set(candidate.id, new Map(plan.inputs.map((input) => [input.id, []])));
    }
    return buckets;
}

async function measureCandidates(plan, clock, buckets) {
    for (let runIndex = 0; runIndex < plan.measuredRuns; runIndex += 1) {
        for (const input of plan.inputs) {
            for (const candidate of plan.candidates) {
                const measurement = await observe(candidate, input, runIndex, false, clock);
                buckets.get(candidate.id).get(input.id).push(measurement);
            }
        }
    }
}

function candidateReports(plan, buckets, warmupBuckets) {
    return plan.candidates.map((candidate) => Object.freeze({
        id: candidate.id,
        kind: candidate.kind,
        summaries: Object.freeze(plan.inputs.map((input) => summarize(
            input,
            buckets.get(candidate.id).get(input.id),
            warmupBuckets.get(candidate.id).get(input.id),
        ))),
    }));
}

function comparableValue(summary, objective) {
    const value = summary[objective.field];
    return value === null ? null : value;
}

function betterCandidate(left, right, objective) {
    const leftValue = comparableValue(left.summary, objective);
    const rightValue = comparableValue(right.summary, objective);
    if (leftValue === rightValue) {
        return left.id.localeCompare(right.id) <= 0 ? left : right;
    }
    const leftWins = objective.direction === "minimum"
        ? leftValue < rightValue
        : leftValue > rightValue;
    return leftWins ? left : right;
}

function leaderFor(reports, inputIndex, objective) {
    const candidates = reports.map((report) => ({id: report.id, summary: report.summaries[inputIndex]}));
    const observed = candidates.filter((candidate) => comparableValue(candidate.summary, objective) !== null);
    if (observed.length === 0) {
        return null;
    }
    return observed.slice(1).reduce(
        (leader, candidate) => betterCandidate(leader, candidate, objective), observed[0],
    ).id;
}

function crossoverPoints(inputs, reports) {
    const ordered = inputs.map((input, index) => ({input, index}))
        .sort((left, right) => left.input.size - right.input.size
            || left.input.batchSize - right.input.batchSize);
    const crossovers = [];
    for (const objective of OBJECTIVES) {
        let previous = null;
        for (const item of ordered) {
            const leader = leaderFor(reports, item.index, objective);
            if (previous !== null && leader !== null && leader !== previous) {
                crossovers.push(Object.freeze({
                    objective: objective.name,
                    inputSize: item.input.size,
                    batchSize: item.input.batchSize,
                    fromCandidateId: previous,
                    toCandidateId: leader,
                }));
            }
            previous = leader;
        }
    }
    return Object.freeze(crossovers);
}

async function runBenchmark(plan, {clock = Date.now} = {}) {
    validatePlan(plan);
    if (typeof clock !== "function") {
        throw new BenchmarkError("clock-invalid", "benchmark clock must be a function");
    }
    const warmupBuckets = measurementBuckets(plan);
    const buckets = measurementBuckets(plan);
    await warmCandidates(plan, clock, warmupBuckets);
    await measureCandidates(plan, clock, buckets);
    const candidates = Object.freeze(candidateReports(plan, buckets, warmupBuckets));
    return Object.freeze({
        version: VERSION,
        workloadId: plan.workloadId,
        measuredAt: plan.measuredAt,
        warmupRuns: plan.warmupRuns,
        measuredRuns: plan.measuredRuns,
        inputs: Object.freeze(plan.inputs.map((input) => Object.freeze({
            id: input.id, size: input.size, batchSize: input.batchSize,
        }))),
        candidates,
        crossovers: crossoverPoints(plan.inputs, candidates),
    });
}

module.exports = {
    VERSION,
    MAX_CANDIDATES,
    MAX_INPUTS,
    MAX_RUNS,
    MAX_IDENTIFIER_LENGTH,
    CANDIDATE_KINDS,
    STAGE_NAMES,
    OBJECTIVES,
    BenchmarkError,
    validObservation,
    validatePlan,
    percentile,
    runBenchmark,
};
