"use strict";

// Offline evaluation for the existing review-only organizer. Host metadata,
// GPU, and hybrid taggers receive the same labeled batches. Recommendation is
// matrix-local and only among candidates meeting the requested accuracy.

const Benchmark = require("./workload-benchmark.js");

const WORKLOAD_ID = "file-auto-tagging";
const MAX_FILES_PER_BATCH = 16;
const MAX_TAGS = 16;
const MAX_TAG_LENGTH = 48;
const MAX_FILE_BYTES = 128 * 1024 * 1024;
const TAG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const FILE_ID = /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/u;
const CANDIDATE_KINDS = Object.freeze(["host", "gpu", "hybrid"]);
const FAMILY_DEFINITIONS = Object.freeze([
    Object.freeze({family: "text", suffixes: Object.freeze([".md", ".txt"])}),
    Object.freeze({family: "document", suffixes: Object.freeze([".pdf"])}),
    Object.freeze({family: "image", suffixes: Object.freeze([".jpeg", ".jpg", ".png", ".webp"])}),
]);
const INPUT_FIELDS = Object.freeze(["id", "files"]);
const FILE_FIELDS = Object.freeze([
    "id", "name", "sizeBytes", "mimeType", "expectedTags",
]);
const CANDIDATE_FIELDS = Object.freeze(["id", "kind", "tag"]);
const OUTPUT_FIELDS = Object.freeze([
    "predictions", "stages", "memoryBytes", "vramBytes", "energyMilliJoules", "contentionMs",
]);
const PREDICTION_FIELDS = Object.freeze(["fileId", "tags"]);
const PLAN_FIELDS = Object.freeze([
    "measuredAt", "warmupRuns", "measuredRuns", "inputs", "candidates",
]);

class AutoTaggingError extends Error {
    constructor(code, detail) {
        super(detail);
        this.name = "AutoTaggingError";
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

function boundedText(value, minimum, maximum) {
    return typeof value === "string"
        && !value.includes("\0")
        && [...value].length >= minimum
        && [...value].length <= maximum;
}

function validTag(value) {
    return boundedText(value, 1, MAX_TAG_LENGTH) && TAG.test(value);
}

function validTags(value) {
    return Array.isArray(value)
        && value.length <= MAX_TAGS
        && value.every(validTag)
        && new Set(value).size === value.length;
}

function familyOf(name) {
    if (typeof name !== "string") {
        return "";
    }
    const lowered = name.toLowerCase();
    return FAMILY_DEFINITIONS.find((item) => item.suffixes.some(
        (suffix) => lowered.endsWith(suffix),
    ))?.family || "";
}

function validFileIdentity(value) {
    return boundedText(value.id, 1, 80)
        && FILE_ID.test(value.id)
        && boundedText(value.name, 1, 255)
        && !value.name.includes("/")
        && !value.name.includes("\\")
        && !value.name.startsWith(".")
        && familyOf(value.name) !== "";
}

function validFileContent(value) {
    return Number.isSafeInteger(value.sizeBytes)
        && value.sizeBytes >= 1
        && value.sizeBytes <= MAX_FILE_BYTES
        && boundedText(value.mimeType, 1, 120)
        && validTags(value.expectedTags);
}

function validFile(value) {
    return exactKeys(value, FILE_FIELDS)
        && validFileIdentity(value)
        && validFileContent(value);
}

function validInput(value) {
    return exactKeys(value, INPUT_FIELDS)
        && boundedText(value.id, 1, 80)
        && FILE_ID.test(value.id)
        && Array.isArray(value.files)
        && value.files.length >= 1
        && value.files.length <= MAX_FILES_PER_BATCH
        && value.files.every(validFile)
        && new Set(value.files.map((file) => file.id)).size === value.files.length;
}

function inputFamilies(input) {
    return Object.freeze([...new Set(input.files.map((file) => familyOf(file.name)))].sort());
}

function inputSize(input) {
    return input.files.reduce((total, file) => total + file.sizeBytes, 0);
}

function validCandidate(value) {
    return exactKeys(value, CANDIDATE_FIELDS)
        && boundedText(value.id, 1, 80)
        && FILE_ID.test(value.id)
        && CANDIDATE_KINDS.includes(value.kind)
        && typeof value.tag === "function";
}

function validPlanShape(value) {
    return exactKeys(value, PLAN_FIELDS)
        && Number.isSafeInteger(value.measuredAt)
        && value.measuredAt >= 0;
}

function validPlanControls(value) {
    return Number.isSafeInteger(value.warmupRuns)
        && value.warmupRuns >= 0
        && value.warmupRuns <= Benchmark.MAX_RUNS
        && Number.isSafeInteger(value.measuredRuns)
        && value.measuredRuns >= 1
        && value.measuredRuns <= Benchmark.MAX_RUNS
        && Array.isArray(value.inputs)
        && Array.isArray(value.candidates);
}

function validInputs(inputs) {
    return inputs.length >= 1
        && inputs.length <= Benchmark.MAX_INPUTS
        && inputs.every(validInput)
        && new Set(inputs.map((input) => input.id)).size === inputs.length;
}

function validCandidates(candidates) {
    return candidates.length >= 2
        && candidates.length <= Benchmark.MAX_CANDIDATES
        && candidates.every(validCandidate)
        && new Set(candidates.map((candidate) => candidate.id)).size === candidates.length;
}

function completeMatrix(candidates) {
    return CANDIDATE_KINDS.every((kind) => candidates.some((candidate) => candidate.kind === kind));
}

function validatePlan(value) {
    if (!validPlanShape(value) || !validPlanControls(value)) {
        throw new AutoTaggingError("plan-invalid", "auto-tagging benchmark plan is invalid");
    }
    if (!validInputs(value.inputs)) {
        throw new AutoTaggingError("inputs-invalid", "auto-tagging benchmark inputs are invalid");
    }
    if (!validCandidates(value.candidates)) {
        throw new AutoTaggingError("candidates-invalid", "auto-tagging candidates are invalid");
    }
    if (!completeMatrix(value.candidates)) {
        throw new AutoTaggingError("matrix-incomplete", "host, GPU, and hybrid candidates are required");
    }
}

function sortedTags(tags) {
    return [...tags].sort((left, right) => left.localeCompare(right));
}

function sameTags(left, right) {
    return JSON.stringify(sortedTags(left)) === JSON.stringify(sortedTags(right));
}

function validPrediction(value, input) {
    const file = input.files.find((candidate) => candidate.id === value?.fileId);
    return exactKeys(value, PREDICTION_FIELDS)
        && file !== undefined
        && validTags(value.tags);
}

function validPredictions(value, input) {
    return Array.isArray(value)
        && value.length === input.files.length
        && value.every((prediction) => validPrediction(prediction, input))
        && new Set(value.map((prediction) => prediction.fileId)).size === value.length
        && input.files.every((file) => value.some((prediction) => prediction.fileId === file.id));
}

function predictionsCorrect(predictions, input) {
    return input.files.every((file) => {
        const prediction = predictions.find((item) => item.fileId === file.id);
        return sameTags(prediction.tags, file.expectedTags);
    });
}

function validCandidateOutput(value, input) {
    return exactKeys(value, OUTPUT_FIELDS)
        && validPredictions(value.predictions, input)
        && Benchmark.validObservation({
            correct: true,
            stages: value.stages,
            memoryBytes: value.memoryBytes,
            vramBytes: value.vramBytes,
            energyMilliJoules: value.energyMilliJoules,
            contentionMs: value.contentionMs,
        });
}

function observation(value, input) {
    if (!validCandidateOutput(value, input)) {
        throw new AutoTaggingError("candidate-output-invalid", "tagging candidate output is invalid");
    }
    return Object.freeze({
        correct: predictionsCorrect(value.predictions, input),
        stages: Object.freeze({...value.stages}),
        memoryBytes: value.memoryBytes,
        vramBytes: value.vramBytes,
        energyMilliJoules: value.energyMilliJoules,
        contentionMs: value.contentionMs,
    });
}

function benchmarkInput(input) {
    return Object.freeze({
        id: input.id,
        size: inputSize(input),
        batchSize: input.files.length,
        payload: input,
    });
}

function benchmarkCandidate(candidate) {
    return Object.freeze({
        id: candidate.id,
        kind: candidate.kind,
        async run(input, context) {
            return observation(await candidate.tag(input, context), input);
        },
    });
}

async function runAutoTaggingBenchmark(plan, options = {}) {
    validatePlan(plan);
    const benchmarkPlan = {
        workloadId: WORKLOAD_ID,
        measuredAt: plan.measuredAt,
        warmupRuns: plan.warmupRuns,
        measuredRuns: plan.measuredRuns,
        inputs: plan.inputs.map(benchmarkInput),
        candidates: plan.candidates.map(benchmarkCandidate),
    };
    const report = await Benchmark.runBenchmark(benchmarkPlan, options);
    return Object.freeze({
        ...report,
        inputs: Object.freeze(report.inputs.map((input, index) => Object.freeze({
            ...input,
            families: inputFamilies(plan.inputs[index]),
        }))),
    });
}

function eligibleCandidates(report, inputIndex, minimumAccuracy) {
    return report.candidates.map((candidate) => ({
        id: candidate.id,
        kind: candidate.kind,
        summary: candidate.summaries[inputIndex],
    })).filter((candidate) => candidate.summary.accuracy >= minimumAccuracy);
}

function fasterCandidate(left, right) {
    if (left.summary.p95LatencyMs === right.summary.p95LatencyMs) {
        return left.id.localeCompare(right.id) <= 0 ? left : right;
    }
    return left.summary.p95LatencyMs < right.summary.p95LatencyMs ? left : right;
}

function validRecommendationReport(report) {
    return isRecord(report)
        && report.workloadId === WORKLOAD_ID
        && Array.isArray(report.inputs)
        && report.inputs.length >= 1
        && report.inputs.every((input) => (
            isRecord(input)
            && boundedText(input.id, 1, 80)
            && Array.isArray(input.families)
            && Number.isSafeInteger(input.size)
            && input.size >= 1
            && Number.isSafeInteger(input.batchSize)
            && input.batchSize >= 1
        ))
        && Array.isArray(report.candidates)
        && report.candidates.length >= 1
        && report.candidates.every((candidate) => (
            isRecord(candidate)
            && boundedText(candidate.id, 1, 80)
            && CANDIDATE_KINDS.includes(candidate.kind)
            && Array.isArray(candidate.summaries)
            && candidate.summaries.length === report.inputs.length
            && candidate.summaries.every((summary) => (
                isRecord(summary)
                && validAccuracy(summary.accuracy)
                && Number.isFinite(summary.p95LatencyMs)
                && summary.p95LatencyMs >= 0
            ))
        ));
}

function validAccuracy(value) {
    return typeof value === "number"
        && Number.isFinite(value)
        && value >= 0
        && value <= 1;
}

function recommendTaggers(report, minimumAccuracy = 0.9) {
    if (!validRecommendationReport(report) || !validAccuracy(minimumAccuracy)) {
        throw new AutoTaggingError("report-invalid", "auto-tagging report is invalid");
    }
    return Object.freeze(report.inputs.map((input, index) => {
        const eligible = eligibleCandidates(report, index, minimumAccuracy);
        const winner = eligible.length === 0
            ? null
            : eligible.slice(1).reduce(fasterCandidate, eligible[0]);
        return Object.freeze({
            inputId: input.id,
            families: Object.freeze([...input.families]),
            size: input.size,
            batchSize: input.batchSize,
            candidateId: winner?.id || null,
            candidateKind: winner?.kind || null,
            reason: winner === null ? "accuracy-threshold-not-met" : "measured-lowest-p95",
        });
    }));
}

function reviewTagPlan(input, predictions, candidateId) {
    if (!validInput(input)
        || !validPredictions(predictions, input)
        || !boundedText(candidateId, 1, 80)
        || !FILE_ID.test(candidateId)) {
        throw new AutoTaggingError("review-invalid", "review-only tagging plan is invalid");
    }
    return Object.freeze({
        version: 1,
        candidateId,
        reviewOnly: true,
        items: Object.freeze(input.files.map((file) => {
            const prediction = predictions.find((item) => item.fileId === file.id);
            return Object.freeze({
                fileId: file.id,
                fileName: file.name,
                family: familyOf(file.name),
                tags: Object.freeze([...prediction.tags]),
            });
        })),
    });
}

module.exports = {
    CANDIDATE_KINDS,
    FAMILY_DEFINITIONS,
    MAX_FILE_BYTES,
    MAX_FILES_PER_BATCH,
    MAX_RUNS: Benchmark.MAX_RUNS,
    MAX_TAG_LENGTH,
    MAX_TAGS,
    WORKLOAD_ID,
    AutoTaggingError,
    familyOf,
    inputFamilies,
    inputSize,
    observation,
    predictionsCorrect,
    recommendTaggers,
    reviewTagPlan,
    runAutoTaggingBenchmark,
    sameTags,
    validCandidate,
    validCandidateOutput,
    validFile,
    validInput,
    validPrediction,
    validPredictions,
    validTag,
    validTags,
    validatePlan,
};
