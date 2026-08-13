"use strict";

const Validation = require("./validation.js");

const IDENTIFIER = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const TRAINING_CONTRACT_REQUIRED = Object.freeze([
    "version", "profileId", "recipe", "reportSha256", "taskSemanticsSha256",
]);
const TRAINING_CONTRACT_PROPERTIES = new Set(TRAINING_CONTRACT_REQUIRED);
const NATIVE_EVIDENCE_REQUIRED = Object.freeze([
    "portableSha256", "nativeSha256", "reportSha256", "samples",
    "maximumAbsoluteError", "tolerance", "compilerReportSha256", "namedDeviceAccepted",
]);
const NATIVE_EVIDENCE_PROPERTIES = new Set(NATIVE_EVIDENCE_REQUIRED);

const {boundedText, exactKeys} = Validation;
const isModelDigest = Validation.isDigest;

function declared(value, name) {
    return Object.hasOwn(value, name) && value[name] !== undefined;
}

function identifier(value) {
    return boundedText(value, 1, 80) && IDENTIFIER.test(value);
}

function isTrainingContract(value) {
    return exactKeys(value, TRAINING_CONTRACT_PROPERTIES)
        && value.version === 1
        && identifier(value.profileId)
        && identifier(value.recipe)
        && isModelDigest(value.reportSha256)
        && isModelDigest(value.taskSemanticsSha256);
}

function hasNativeDigests(value) {
    return isModelDigest(value.portableSha256)
        && isModelDigest(value.nativeSha256)
        && isModelDigest(value.reportSha256);
}

function hasParityMeasurements(value) {
    return Number.isInteger(value.samples)
        && value.samples >= 1
        && Number.isFinite(value.maximumAbsoluteError)
        && value.maximumAbsoluteError >= 0
        && Number.isFinite(value.tolerance)
        && value.tolerance > 0;
}

function hasCompilerEvidence(value) {
    return value.compilerReportSha256 === null
        || isModelDigest(value.compilerReportSha256);
}

function isNativeEvidence(value) {
    return exactKeys(value, NATIVE_EVIDENCE_PROPERTIES)
        && hasNativeDigests(value)
        && hasParityMeasurements(value)
        && hasCompilerEvidence(value)
        && value.namedDeviceAccepted === false;
}

function hasProvenanceContracts(value) {
    return (!declared(value, "trainingContract")
        || isTrainingContract(value.trainingContract))
        && (!declared(value, "nativeEvidence")
        || isNativeEvidence(value.nativeEvidence));
}

module.exports = {
    NATIVE_EVIDENCE_PROPERTIES,
    TRAINING_CONTRACT_PROPERTIES,
    hasProvenanceContracts,
    isModelDigest,
    isNativeEvidence,
    isTrainingContract,
};
