"use strict";

const Validation = require("./validation.js");

const VERSION = 1;
const MAX_TEXT = 500;
const MAX_ISSUES = 64;
const IDENTIFIER = /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/u;
const BACKENDS = Object.freeze(["tpu", "npu", "gpu"]);
const SCENARIOS = Object.freeze([
    "click-to-result", "cancellation", "pressure", "restart",
    "source-loss", "device-loss", "recovery",
]);
const EXPECTED_OUTCOMES = Object.freeze({
    "click-to-result": "succeeded",
    cancellation: "cancelled",
    pressure: "deferred",
    restart: "recovered",
    "source-loss": "lost",
    "device-loss": "lost",
    recovery: "recovered",
});
const ROOT_KEYS = Object.freeze([
    "version", "workloadId", "measuredAt", "hardware", "recording", "scenarios",
]);
const HARDWARE_KEYS = Object.freeze([
    "hostId", "deviceName", "backend", "driverVersion", "runtimeVersion",
]);
const RECORDING_KEYS = Object.freeze([
    "sessionType", "startedAt", "endedAt", "replaySha256",
]);
const SCENARIO_KEYS = Object.freeze([
    "id", "execution", "clickControlId", "startedAt", "endedAt",
    "expectedOutcome", "observedOutcome", "resultValid", "resultSha256",
    "errors", "warnings",
]);

class ReadinessError extends Error {
    constructor(code, detail) {
        super(detail);
        this.name = "ReadinessError";
        this.code = code;
    }
}

const isRecord = Validation.isRecord;
const exactKeys = Validation.exactKeys;

function boundedText(value, maximum = MAX_TEXT) {
    return Validation.boundedText(value, 1, maximum);
}

function identifier(value) {
    return boundedText(value, 120) && IDENTIFIER.test(value);
}

function timestamp(value) {
    return Number.isSafeInteger(value) && value >= 0;
}

const digest = Validation.isDigest;

function validHardware(value) {
    return exactKeys(value, HARDWARE_KEYS)
        && identifier(value.hostId)
        && boundedText(value.deviceName, 160)
        && BACKENDS.includes(value.backend)
        && boundedText(value.driverVersion, 120)
        && boundedText(value.runtimeVersion, 120);
}

function validRecording(value) {
    return exactKeys(value, RECORDING_KEYS)
        && value.sessionType === "cinnamon-screen-recording"
        && timestamp(value.startedAt)
        && timestamp(value.endedAt)
        && value.endedAt > value.startedAt
        && digest(value.replaySha256);
}

function validIssue(value) {
    return exactKeys(value, ["code", "message", "timestamp"])
        && identifier(value.code)
        && boundedText(value.message)
        && timestamp(value.timestamp);
}

function validIssues(value) {
    return Array.isArray(value)
        && value.length <= MAX_ISSUES
        && value.every(validIssue);
}

function validResultProof(value) {
    return typeof value.resultValid === "boolean"
        && (value.resultSha256 === null || digest(value.resultSha256))
        && (value.resultValid === false || value.resultSha256 !== null);
}

function validScenarioShape(value) {
    return exactKeys(value, SCENARIO_KEYS)
        && SCENARIOS.includes(value.id)
        && value.execution === "real-cinnamon"
        && identifier(value.clickControlId)
        && timestamp(value.startedAt)
        && timestamp(value.endedAt)
        && value.endedAt > value.startedAt;
}

function validScenarioOutcome(value) {
    return value.expectedOutcome === EXPECTED_OUTCOMES[value.id]
        && value.observedOutcome === value.expectedOutcome
        && validResultProof(value)
        && validIssues(value.errors)
        && validIssues(value.warnings);
}

function validScenario(value) {
    return validScenarioShape(value) && validScenarioOutcome(value);
}

function scenariosComplete(scenarios) {
    return Array.isArray(scenarios)
        && scenarios.length === SCENARIOS.length
        && scenarios.every(validScenario)
        && new Set(scenarios.map((scenario) => scenario.id)).size === SCENARIOS.length;
}

function scenariosInsideRecording(scenarios, recording) {
    return scenarios.every((scenario) => scenario.startedAt >= recording.startedAt
        && scenario.endedAt <= recording.endedAt);
}

function requiredResultProofs(scenarios) {
    return scenarios.find((scenario) => scenario.id === "click-to-result").resultValid
        && scenarios.find((scenario) => scenario.id === "recovery").resultValid;
}

function validRecordedScenarios(value) {
    return scenariosComplete(value.scenarios)
        && scenariosInsideRecording(value.scenarios, value.recording)
        && requiredResultProofs(value.scenarios);
}

function isReadinessEvidence(value) {
    return exactKeys(value, ROOT_KEYS)
        && value.version === VERSION
        && identifier(value.workloadId)
        && timestamp(value.measuredAt)
        && validHardware(value.hardware)
        && validRecording(value.recording)
        && validRecordedScenarios(value);
}

function deepFreeze(value) {
    if (!isRecord(value) && !Array.isArray(value)) {
        return value;
    }
    for (const child of Object.values(value)) {
        deepFreeze(child);
    }
    return Object.freeze(value);
}

function createReadinessEvidence(value) {
    if (!isReadinessEvidence(value)) {
        throw new ReadinessError(
            "readiness-evidence-invalid",
            "named-hardware Cinnamon readiness evidence is incomplete or invalid",
        );
    }
    return deepFreeze(JSON.parse(JSON.stringify(value)));
}

function readinessDecision(value) {
    if (!isReadinessEvidence(value)) {
        return Object.freeze({ready: false, reason: "evidence-invalid"});
    }
    const issueCount = value.scenarios.reduce(
        (count, scenario) => count + scenario.errors.length + scenario.warnings.length,
        0,
    );
    if (issueCount > 0) {
        return Object.freeze({ready: false, reason: "issues-observed", issueCount});
    }
    return Object.freeze({
        ready: true,
        reason: "accepted",
        workloadId: value.workloadId,
        hostId: value.hardware.hostId,
        deviceName: value.hardware.deviceName,
        replaySha256: value.recording.replaySha256,
        issueCount,
    });
}

module.exports = {
    BACKENDS,
    EXPECTED_OUTCOMES,
    MAX_ISSUES,
    ReadinessError,
    SCENARIOS,
    VERSION,
    createReadinessEvidence,
    isReadinessEvidence,
    readinessDecision,
    validHardware,
    validIssue,
    validRecording,
    validScenario,
};
