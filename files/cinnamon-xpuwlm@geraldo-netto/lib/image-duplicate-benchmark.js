"use strict";

// Similar-looking is not byte-identical. Every candidate receives the same
// labeled image pairs, while exact identity remains a full SHA-256 comparison.

const Benchmark = require("./workload-benchmark.js");
const Tagging = require("./file-auto-tagging.js");
const Validation = require("./validation.js");

const WORKLOAD_ID = "image-duplicate-detection";
const MAX_IMAGES = 16;
const MAX_PAIRS = (MAX_IMAGES * (MAX_IMAGES - 1)) / 2;
const {DIGEST} = Validation;
const STRATEGIES = Object.freeze([
    "phash-scalar", "phash-simd", "phash-gpu-batch",
    "embedding-gpu-batch", "hybrid-cascade",
]);
const STRATEGY_KIND = Object.freeze({
    "phash-scalar": "host",
    "phash-simd": "host",
    "phash-gpu-batch": "gpu",
    "embedding-gpu-batch": "gpu",
    "hybrid-cascade": "hybrid",
});
const IMAGE_FIELDS = Object.freeze(["id", "name", "sizeBytes", "mimeType", "sha256"]);
const PAIR_FIELDS = Object.freeze(["leftId", "rightId", "expectedRelated"]);
const INPUT_FIELDS = Object.freeze(["id", "images", "pairs"]);
const CANDIDATE_FIELDS = Object.freeze(["id", "kind", "strategy", "compare"]);
const DECISION_FIELDS = Object.freeze([
    "leftId", "rightId", "leftSha256", "rightSha256", "byteIdentical", "related", "score",
]);
const OUTPUT_FIELDS = Object.freeze([
    "decisions", "stages", "memoryBytes", "vramBytes", "energyMilliJoules", "contentionMs",
]);
const PLAN_FIELDS = Object.freeze([
    "measuredAt", "warmupRuns", "measuredRuns", "inputs", "candidates",
]);

class DuplicateBenchmarkError extends Error {
    constructor(code, detail) {
        super(detail);
        this.name = "DuplicateBenchmarkError";
        this.code = code;
    }
}

const isRecord = Validation.isRecord;
const exactKeys = Validation.exactKeys;

function taggingImage(image) {
    return {
        id: image.id, name: image.name, sizeBytes: image.sizeBytes,
        mimeType: image.mimeType, expectedTags: [],
    };
}

function validImage(value) {
    return exactKeys(value, IMAGE_FIELDS)
        && Tagging.validFile(taggingImage(value))
        && Tagging.familyOf(value.name) === "image"
        && DIGEST.test(value.sha256);
}

function imageById(input, id) {
    return input.images.find((image) => image.id === id);
}

function pairKey(pair) {
    return [pair.leftId, pair.rightId].sort(Validation.compareText).join(":");
}

function validPair(value, input) {
    return exactKeys(value, PAIR_FIELDS)
        && typeof value.expectedRelated === "boolean"
        && value.leftId !== value.rightId
        && imageById(input, value.leftId) !== undefined
        && imageById(input, value.rightId) !== undefined;
}

function validImages(value) {
    return Array.isArray(value)
        && value.length >= 2
        && value.length <= MAX_IMAGES
        && value.every(validImage)
        && new Set(value.map((image) => image.id)).size === value.length;
}

function validPairs(value, input) {
    return Array.isArray(value)
        && value.length >= 1
        && value.length <= MAX_PAIRS
        && value.every((pair) => validPair(pair, input))
        && new Set(value.map(pairKey)).size === value.length;
}

function validInput(value) {
    return exactKeys(value, INPUT_FIELDS)
        && validImages(value.images)
        && validPairs(value.pairs, value)
        && Tagging.validInput({id: value.id, files: value.images.map(taggingImage)});
}

function validCandidate(value) {
    return exactKeys(value, CANDIDATE_FIELDS)
        && STRATEGIES.includes(value.strategy)
        && STRATEGY_KIND[value.strategy] === value.kind
        && Tagging.validCandidate({id: value.id, kind: value.kind, tag: value.compare});
}

function labeledPair(input, decision) {
    return input.pairs.find((pair) => (
        pair.leftId === decision?.leftId && pair.rightId === decision?.rightId
    ));
}

function validScore(value) {
    return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;
}

function decisionMatchesSources(value, input) {
    const pair = labeledPair(input, value);
    return pair !== undefined
        && value.leftSha256 === imageById(input, pair.leftId).sha256
        && value.rightSha256 === imageById(input, pair.rightId).sha256;
}

function validExactIdentity(value) {
    return DIGEST.test(value.leftSha256)
        && DIGEST.test(value.rightSha256)
        && typeof value.byteIdentical === "boolean"
        && value.byteIdentical === (value.leftSha256 === value.rightSha256);
}

function validDecision(value, input) {
    return exactKeys(value, DECISION_FIELDS)
        && decisionMatchesSources(value, input)
        && validExactIdentity(value)
        && typeof value.related === "boolean"
        && validScore(value.score);
}

function validDecisions(value, input) {
    return Array.isArray(value)
        && value.length === input.pairs.length
        && value.every((decision) => validDecision(decision, input))
        && new Set(value.map(pairKey)).size === value.length
        && input.pairs.every((pair) => value.some((decision) => pairKey(decision) === pairKey(pair)));
}

function decisionsCorrect(decisions, input) {
    return input.pairs.every((pair) => decisions.find((decision) => (
        decision.leftId === pair.leftId && decision.rightId === pair.rightId
    )).related === pair.expectedRelated);
}

function validOutput(value, input) {
    return exactKeys(value, OUTPUT_FIELDS)
        && validDecisions(value.decisions, input)
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
    if (!validOutput(value, input)) {
        throw new DuplicateBenchmarkError("output-invalid", "duplicate candidate output is invalid");
    }
    return Object.freeze({
        correct: decisionsCorrect(value.decisions, input),
        stages: Object.freeze({...value.stages}),
        memoryBytes: value.memoryBytes,
        vramBytes: value.vramBytes,
        energyMilliJoules: value.energyMilliJoules,
        contentionMs: value.contentionMs,
    });
}

function commonPlan(plan) {
    return {
        workloadId: WORKLOAD_ID,
        measuredAt: plan.measuredAt,
        warmupRuns: plan.warmupRuns,
        measuredRuns: plan.measuredRuns,
        inputs: plan.inputs.map((input) => ({
            id: input.id,
            size: input.images.reduce((total, image) => total + image.sizeBytes, 0),
            batchSize: input.images.length,
            payload: input,
        })),
        candidates: plan.candidates.map((candidate) => ({
            id: candidate.id, kind: candidate.kind, run: candidate.compare,
        })),
    };
}

function validatePlan(plan) {
    if (!exactKeys(plan, PLAN_FIELDS)
        || !Array.isArray(plan.inputs) || !Array.isArray(plan.candidates)) {
        throw new DuplicateBenchmarkError("plan-invalid", "duplicate benchmark plan is invalid");
    }
    if (!plan.inputs.every(validInput)) {
        throw new DuplicateBenchmarkError("inputs-invalid", "duplicate benchmark inputs are invalid");
    }
    if (!plan.candidates.every(validCandidate)
        || !STRATEGIES.every((strategy) => plan.candidates.some(
            (candidate) => candidate.strategy === strategy,
        ))) {
        throw new DuplicateBenchmarkError("matrix-incomplete", "every duplicate strategy is required");
    }
    Benchmark.validatePlan(commonPlan(plan));
}

function benchmarkPlan(plan) {
    const common = commonPlan(plan);
    return {
        ...common,
        candidates: plan.candidates.map((candidate) => ({
            id: candidate.id,
            kind: candidate.kind,
            async run(input, context) {
                return observation(await candidate.compare(input, context), input);
            },
        })),
    };
}

async function runDuplicateBenchmark(plan, options = {}) {
    validatePlan(plan);
    const report = await Benchmark.runBenchmark(benchmarkPlan(plan), options);
    return Object.freeze({
        ...report,
        inputs: Object.freeze(report.inputs.map((input) => Object.freeze({
            ...input, families: Object.freeze(["image"]),
        }))),
        candidates: Object.freeze(report.candidates.map((candidate) => Object.freeze({
            ...candidate,
            strategy: plan.candidates.find((item) => item.id === candidate.id).strategy,
        }))),
    });
}

function recommendDuplicateCandidates(report, minimumAccuracy = 0.9) {
    if (!isRecord(report) || report.workloadId !== WORKLOAD_ID) {
        throw new DuplicateBenchmarkError("report-invalid", "duplicate benchmark report is invalid");
    }
    let recommendations;
    try {
        recommendations = Tagging.recommendTaggers(
            {...report, workloadId: Tagging.WORKLOAD_ID}, minimumAccuracy,
        );
    } catch {
        throw new DuplicateBenchmarkError("report-invalid", "duplicate benchmark report is invalid");
    }
    return Object.freeze(recommendations.map((item) => Object.freeze({
        ...item,
        strategy: report.candidates.find((candidate) => candidate.id === item.candidateId)?.strategy || null,
    })));
}

function reviewDuplicatePairs(input, decisions, candidateId) {
    if (!validInput(input) || !validDecisions(decisions, input)
        || typeof candidateId !== "string" || !/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/u.test(candidateId)) {
        throw new DuplicateBenchmarkError("review-invalid", "duplicate review is invalid");
    }
    return Object.freeze({
        version: 1,
        candidateId,
        reviewOnly: true,
        pairs: Object.freeze(decisions.map((decision) => Object.freeze({...decision}))),
    });
}

module.exports = {
    MAX_IMAGES,
    MAX_PAIRS,
    STRATEGIES,
    STRATEGY_KIND,
    WORKLOAD_ID,
    DuplicateBenchmarkError,
    decisionsCorrect,
    observation,
    recommendDuplicateCandidates,
    reviewDuplicatePairs,
    runDuplicateBenchmark,
    taggingImage,
    validCandidate,
    validDecision,
    validDecisions,
    validImage,
    validInput,
    validOutput,
    validatePlan,
};
