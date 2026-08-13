"use strict";

// Routine experiments consume categorical/scalar activity summaries only.
// Output is a confirmation-required suggestion set, never an automation port.

const Benchmark = require("./workload-benchmark.js");
const Tagging = require("./file-auto-tagging.js");

const WORKLOAD_ID = "local-routine-recognition";
const MAX_SAMPLES = 512;
const MAX_SUGGESTIONS = 16;
const MAX_EVIDENCE = 32;
const STRATEGIES = Object.freeze(["statistical", "host-model", "gpu-model", "hybrid"]);
const STRATEGY_KIND = Object.freeze({
    statistical: "host", "host-model": "host", "gpu-model": "gpu", hybrid: "hybrid",
});
const ACTIONS = Object.freeze([
    "prepare-development", "prepare-media", "prepare-meeting", "prepare-presentation",
]);
const SAMPLE_FIELDS = Object.freeze([
    "sequence", "minuteBucket", "weekday", "appClass", "deviceClass",
    "activeSeconds", "transitionCount",
]);
const EXPECTED_FIELDS = Object.freeze(["id", "actionId"]);
const INPUT_FIELDS = Object.freeze(["id", "featureVersion", "samples", "expectedSuggestions"]);
const CANDIDATE_FIELDS = Object.freeze(["id", "kind", "strategy", "recognize"]);
const SUGGESTION_FIELDS = Object.freeze(["id", "actionId", "confidence", "evidenceSequences"]);
const OUTPUT_FIELDS = Object.freeze([
    "suggestions", "stages", "memoryBytes", "vramBytes", "energyMilliJoules", "contentionMs",
]);
const PLAN_FIELDS = Object.freeze([
    "measuredAt", "warmupRuns", "measuredRuns", "inputs", "candidates",
]);
const IDENTIFIER = /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/u;

class RoutineRecognitionError extends Error {
    constructor(code, detail) {
        super(detail);
        this.name = "RoutineRecognitionError";
        this.code = code;
    }
}

function isRecord(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value);
}

function exactKeys(value, fields) {
    return isRecord(value)
        && Object.keys(value).length === fields.length
        && fields.every((name) => Object.hasOwn(value, name));
}

function identifier(value) {
    return typeof value === "string" && value.length <= 80 && IDENTIFIER.test(value);
}

function boundedInteger(value, minimum, maximum) {
    return Number.isSafeInteger(value) && value >= minimum && value <= maximum;
}

function validSample(value) {
    return exactKeys(value, SAMPLE_FIELDS)
        && boundedInteger(value.sequence, 1, Number.MAX_SAFE_INTEGER)
        && boundedInteger(value.minuteBucket, 0, 1439)
        && boundedInteger(value.weekday, 0, 6)
        && boundedInteger(value.appClass, 0, 5)
        && boundedInteger(value.deviceClass, 0, 5)
        && boundedInteger(value.activeSeconds, 0, 86_400)
        && boundedInteger(value.transitionCount, 0, 1024);
}

function validExpectedSuggestion(value) {
    return exactKeys(value, EXPECTED_FIELDS)
        && identifier(value.id)
        && ACTIONS.includes(value.actionId);
}

function uniqueIdentities(values) {
    return new Set(values.map((item) => item.id)).size === values.length;
}

function validSamples(value) {
    return Array.isArray(value)
        && value.length >= 1
        && value.length <= MAX_SAMPLES
        && value.every(validSample)
        && new Set(value.map((sample) => sample.sequence)).size === value.length;
}

function validExpectedSuggestions(value) {
    return Array.isArray(value)
        && value.length <= MAX_SUGGESTIONS
        && value.every(validExpectedSuggestion)
        && uniqueIdentities(value);
}

function validInput(value) {
    return exactKeys(value, INPUT_FIELDS)
        && identifier(value.id)
        && boundedInteger(value.featureVersion, 1, 255)
        && validSamples(value.samples)
        && validExpectedSuggestions(value.expectedSuggestions);
}

function validCandidate(value) {
    return exactKeys(value, CANDIDATE_FIELDS)
        && STRATEGIES.includes(value.strategy)
        && STRATEGY_KIND[value.strategy] === value.kind
        && Tagging.validCandidate({id: value.id, kind: value.kind, tag: value.recognize});
}

function validEvidence(value, input) {
    return Array.isArray(value)
        && value.length >= 1
        && value.length <= MAX_EVIDENCE
        && value.every((sequence) => input.samples.some((sample) => sample.sequence === sequence))
        && new Set(value).size === value.length;
}

function validConfidence(value) {
    return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;
}

function validSuggestion(value, input) {
    return exactKeys(value, SUGGESTION_FIELDS)
        && identifier(value.id)
        && ACTIONS.includes(value.actionId)
        && validConfidence(value.confidence)
        && validEvidence(value.evidenceSequences, input);
}

function validSuggestions(value, input) {
    return Array.isArray(value)
        && value.length <= MAX_SUGGESTIONS
        && value.every((suggestion) => validSuggestion(suggestion, input))
        && uniqueIdentities(value);
}

function suggestionKey(value) {
    return `${value.id}:${value.actionId}`;
}

function suggestionsCorrect(suggestions, input) {
    const actual = new Set(suggestions.map(suggestionKey));
    const expected = new Set(input.expectedSuggestions.map(suggestionKey));
    return actual.size === expected.size && [...actual].every((key) => expected.has(key));
}

function validOutput(value, input) {
    return exactKeys(value, OUTPUT_FIELDS)
        && validSuggestions(value.suggestions, input)
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
        throw new RoutineRecognitionError("output-invalid", "routine candidate output is invalid");
    }
    return Object.freeze({
        correct: suggestionsCorrect(value.suggestions, input),
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
            size: input.samples.length * SAMPLE_FIELDS.length,
            batchSize: input.samples.length,
            payload: input,
        })),
        candidates: plan.candidates.map((candidate) => ({
            id: candidate.id, kind: candidate.kind, run: candidate.recognize,
        })),
    };
}

function completeStrategyMatrix(candidates) {
    return STRATEGIES.every((strategy) => candidates.some(
        (candidate) => candidate.strategy === strategy,
    ));
}

function validatePlan(plan) {
    if (!exactKeys(plan, PLAN_FIELDS)
        || !Array.isArray(plan.inputs) || !plan.inputs.every(validInput)
        || !Array.isArray(plan.candidates) || !plan.candidates.every(validCandidate)
        || !completeStrategyMatrix(plan.candidates)) {
        throw new RoutineRecognitionError("plan-invalid", "routine benchmark plan is invalid");
    }
    Benchmark.validatePlan(commonPlan(plan));
}

function benchmarkPlan(plan) {
    return {
        ...commonPlan(plan),
        candidates: plan.candidates.map((candidate) => ({
            id: candidate.id,
            kind: candidate.kind,
            async run(input, context) {
                return observation(await candidate.recognize(input, context), input);
            },
        })),
    };
}

async function runRoutineBenchmark(plan, options = {}) {
    validatePlan(plan);
    const report = await Benchmark.runBenchmark(benchmarkPlan(plan), options);
    return Object.freeze({
        ...report,
        inputs: Object.freeze(report.inputs.map((input) => Object.freeze({
            ...input, families: Object.freeze(["routine"]),
        }))),
        candidates: Object.freeze(report.candidates.map((candidate) => Object.freeze({
            ...candidate,
            strategy: plan.candidates.find((item) => item.id === candidate.id).strategy,
        }))),
    });
}

function recommendRoutineCandidates(report, minimumAccuracy = 0.9) {
    if (!isRecord(report) || report.workloadId !== WORKLOAD_ID) {
        throw new RoutineRecognitionError("report-invalid", "routine benchmark report is invalid");
    }
    try {
        return Tagging.recommendTaggers(
            {...report, workloadId: Tagging.WORKLOAD_ID}, minimumAccuracy,
        );
    } catch {
        throw new RoutineRecognitionError("report-invalid", "routine benchmark report is invalid");
    }
}

function reviewRoutineSuggestions(input, suggestions, candidateId) {
    if (!validInput(input) || !validSuggestions(suggestions, input) || !identifier(candidateId)) {
        throw new RoutineRecognitionError("review-invalid", "routine review is invalid");
    }
    return Object.freeze({
        version: 1,
        candidateId,
        optInRequired: true,
        reviewOnly: true,
        suggestions: Object.freeze(suggestions.map((suggestion) => Object.freeze({
            ...suggestion,
            evidenceSequences: Object.freeze([...suggestion.evidenceSequences]),
            confirmationRequired: true,
        }))),
    });
}

module.exports = {
    ACTIONS,
    MAX_EVIDENCE,
    MAX_SAMPLES,
    MAX_SUGGESTIONS,
    STRATEGIES,
    STRATEGY_KIND,
    WORKLOAD_ID,
    RoutineRecognitionError,
    observation,
    recommendRoutineCandidates,
    reviewRoutineSuggestions,
    runRoutineBenchmark,
    suggestionsCorrect,
    validCandidate,
    validInput,
    validOutput,
    validSample,
    validSuggestion,
    validSuggestions,
    validatePlan,
};
