"use strict";

// One bounded vocabulary covers categorization and auto-tagging. Candidates
// receive the same labeled selected-file batches; no candidate may crawl or
// mutate the filesystem through this domain boundary.

const Benchmark = require("./workload-benchmark.js");
const Tagging = require("./file-auto-tagging.js");

const WORKLOAD_ID = "file-categorization";
const TAXONOMY_VERSION = 1;
const CATEGORIES = Object.freeze([
    "article", "code", "correspondence", "finance", "form", "identity",
    "image", "presentation", "receipt", "reference", "report", "screenshot",
    "scan", "other",
]);
const FEATURE_SOURCE_BY_KIND = Object.freeze({
    host: "mime-metadata",
    gpu: "text-layout",
    hybrid: "mime-metadata-text-layout",
});
const FILE_FIELDS = Object.freeze([
    "id", "name", "sizeBytes", "mimeType", "expectedTags", "expectedCategory",
]);
const INPUT_FIELDS = Object.freeze(["id", "files"]);
const CANDIDATE_FIELDS = Object.freeze(["id", "kind", "featureSource", "categorize"]);
const OUTPUT_FIELDS = Object.freeze([
    "predictions", "stages", "memoryBytes", "vramBytes", "energyMilliJoules", "contentionMs",
]);
const PREDICTION_FIELDS = Object.freeze(["fileId", "category", "tags"]);
const IDENTIFIER = /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/u;

class CategorizationError extends Error {
    constructor(code, detail) {
        super(detail);
        this.name = "CategorizationError";
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

function taggingFile(file) {
    return {
        id: file.id,
        name: file.name,
        sizeBytes: file.sizeBytes,
        mimeType: file.mimeType,
        expectedTags: file.expectedTags,
    };
}

function validCategory(value) {
    return typeof value === "string" && CATEGORIES.includes(value);
}

function validFile(value) {
    return exactKeys(value, FILE_FIELDS)
        && Tagging.validFile(taggingFile(value))
        && validCategory(value.expectedCategory);
}

function taggingInput(input) {
    return {id: input.id, files: input.files.map(taggingFile)};
}

function validInput(value) {
    return exactKeys(value, INPUT_FIELDS)
        && Array.isArray(value.files)
        && value.files.every(validFile)
        && Tagging.validInput(taggingInput(value));
}

function validCandidate(value) {
    return exactKeys(value, CANDIDATE_FIELDS)
        && Tagging.validCandidate({id: value.id, kind: value.kind, tag: value.categorize})
        && value.featureSource === FEATURE_SOURCE_BY_KIND[value.kind];
}

function validPrediction(value, input) {
    return exactKeys(value, PREDICTION_FIELDS)
        && input.files.some((file) => file.id === value.fileId)
        && validCategory(value.category)
        && Tagging.validTags(value.tags);
}

function validPredictions(value, input) {
    return Array.isArray(value)
        && value.length === input.files.length
        && value.every((prediction) => validPrediction(prediction, input))
        && new Set(value.map((prediction) => prediction.fileId)).size === value.length
        && input.files.every((file) => value.some((prediction) => prediction.fileId === file.id));
}

function predictionCorrect(prediction, file) {
    return prediction.category === file.expectedCategory
        && Tagging.sameTags(prediction.tags, file.expectedTags);
}

function predictionsCorrect(predictions, input) {
    return input.files.every((file) => predictionCorrect(
        predictions.find((prediction) => prediction.fileId === file.id), file,
    ));
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
        throw new CategorizationError("candidate-output-invalid", "categorization output is invalid");
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

function validatePlan(plan) {
    if (!isRecord(plan) || !Array.isArray(plan.inputs) || !Array.isArray(plan.candidates)) {
        throw new CategorizationError("plan-invalid", "categorization benchmark plan is invalid");
    }
    if (!plan.inputs.every(validInput)) {
        throw new CategorizationError("inputs-invalid", "categorization inputs are invalid");
    }
    if (!plan.candidates.every(validCandidate)) {
        throw new CategorizationError("candidates-invalid", "categorization candidates are invalid");
    }
    Tagging.validatePlan({...plan, inputs: plan.inputs.map(taggingInput), candidates: plan.candidates.map(
        (candidate) => ({id: candidate.id, kind: candidate.kind, tag: candidate.categorize}),
    )});
}

function benchmarkInput(input) {
    return Object.freeze({
        id: input.id,
        size: Tagging.inputSize(taggingInput(input)),
        batchSize: input.files.length,
        payload: input,
    });
}

function benchmarkCandidate(candidate) {
    return Object.freeze({
        id: candidate.id,
        kind: candidate.kind,
        async run(input, context) {
            return observation(await candidate.categorize(input, context), input);
        },
    });
}

async function runCategorizationBenchmark(plan, options = {}) {
    validatePlan(plan);
    const report = await Benchmark.runBenchmark({
        workloadId: WORKLOAD_ID,
        measuredAt: plan.measuredAt,
        warmupRuns: plan.warmupRuns,
        measuredRuns: plan.measuredRuns,
        inputs: plan.inputs.map(benchmarkInput),
        candidates: plan.candidates.map(benchmarkCandidate),
    }, options);
    return Object.freeze({
        ...report,
        taxonomyVersion: TAXONOMY_VERSION,
        inputs: Object.freeze(report.inputs.map((input, index) => Object.freeze({
            ...input,
            families: Tagging.inputFamilies(taggingInput(plan.inputs[index])),
        }))),
    });
}

function recommendCategorizers(report, minimumAccuracy = 0.9) {
    if (!isRecord(report)
        || report.workloadId !== WORKLOAD_ID
        || report.taxonomyVersion !== TAXONOMY_VERSION) {
        throw new CategorizationError("report-invalid", "categorization report is invalid");
    }
    try {
        return Tagging.recommendTaggers({...report, workloadId: Tagging.WORKLOAD_ID}, minimumAccuracy);
    } catch {
        throw new CategorizationError("report-invalid", "categorization report is invalid");
    }
}

function validCandidateId(value) {
    return typeof value === "string" && value.length <= 80 && IDENTIFIER.test(value);
}

function reviewCategorization(input, predictions, candidateId) {
    if (!validInput(input) || !validPredictions(predictions, input) || !validCandidateId(candidateId)) {
        throw new CategorizationError("review-invalid", "review-only categorization is invalid");
    }
    return Object.freeze({
        version: 1,
        taxonomyVersion: TAXONOMY_VERSION,
        candidateId,
        reviewOnly: true,
        items: Object.freeze(input.files.map((file) => {
            const prediction = predictions.find((item) => item.fileId === file.id);
            return Object.freeze({
                fileId: file.id,
                fileName: file.name,
                family: Tagging.familyOf(file.name),
                category: prediction.category,
                tags: Object.freeze([...prediction.tags]),
            });
        })),
    });
}

module.exports = {
    CATEGORIES,
    FEATURE_SOURCE_BY_KIND,
    TAXONOMY_VERSION,
    WORKLOAD_ID,
    CategorizationError,
    observation,
    predictionsCorrect,
    recommendCategorizers,
    reviewCategorization,
    runCategorizationBenchmark,
    taggingFile,
    taggingInput,
    validCandidate,
    validCandidateOutput,
    validCategory,
    validFile,
    validInput,
    validPrediction,
    validPredictions,
    validatePlan,
};
