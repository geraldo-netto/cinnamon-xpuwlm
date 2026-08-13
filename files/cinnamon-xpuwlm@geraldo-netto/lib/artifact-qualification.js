"use strict";

const Manifest = require("./workload-manifest.js");
const Benchmark = require("./workload-benchmark.js");
const Validation = require("./validation.js");

const VERSION = 1;
const MAX_TEXT = 160;
const MAX_URL = 512;
const IDENTIFIER = /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/u;
const SEMANTIC_VERSION = /^(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)$/u;
const SPDX_ID = /^[A-Za-z0-9][A-Za-z0-9.+-]{0,79}$/u;
const ED25519_SIGNATURE = /^[A-Za-z0-9+/]{86}==$/u;
const ROOT_PROPERTIES = Object.freeze([
    "version", "artifactId", "artifactVersion", "recipe", "portableExport",
    "nativeBinding", "tensorContractSha256", "license", "signature", "hardwareEvidence",
]);
const RECIPE_PROPERTIES = Object.freeze(["id", "revision", "sha256", "reviewedBy", "reviewedAt"]);
const PORTABLE_PROPERTIES = Object.freeze(["format", "sha256"]);
const BINDING_PROPERTIES = Object.freeze([
    "backend", "paramSha256", "weightsSha256", "minimumNcnnVersion", "vulkanRequired",
]);
const LICENSE_PROPERTIES = Object.freeze(["spdxId", "sourceUrl", "noticeSha256"]);
const SIGNATURE_PROPERTIES = Object.freeze(["algorithm", "keyId", "value"]);
const HARDWARE_PROPERTIES = Object.freeze([
    "deviceName", "driverVersion", "runtimeVersion", "benchmarkVersion",
    "benchmarkRecordSha256", "measuredAt", "decision",
]);
const DECISIONS = Object.freeze(["accepted", "rejected"]);

class QualificationError extends Error {
    constructor(code, detail) {
        super(detail);
        this.name = "QualificationError";
        this.code = code;
    }
}

const isRecord = Validation.isRecord;
const exactKeys = Validation.exactKeys;

function boundedText(value, maximum = MAX_TEXT) {
    return Validation.boundedText(value, 1, maximum);
}

function identifier(value) {
    return boundedText(value, 80) && IDENTIFIER.test(value);
}

const digest = Validation.isDigest;

function version(value) {
    return typeof value === "string" && value.length <= 32 && SEMANTIC_VERSION.test(value);
}

function timestamp(value) {
    return Number.isSafeInteger(value) && value >= 0;
}

function validRecipe(value) {
    return exactKeys(value, RECIPE_PROPERTIES)
        && identifier(value.id)
        && version(value.revision)
        && digest(value.sha256)
        && identifier(value.reviewedBy)
        && timestamp(value.reviewedAt);
}

function validPortableExport(value) {
    return exactKeys(value, PORTABLE_PROPERTIES)
        && value.format === "onnx"
        && digest(value.sha256);
}

function validNativeBinding(value) {
    return exactKeys(value, BINDING_PROPERTIES)
        && value.backend === "ncnn-vulkan"
        && digest(value.paramSha256)
        && digest(value.weightsSha256)
        && boundedText(value.minimumNcnnVersion, 80)
        && value.vulkanRequired === true;
}

function validLicense(value) {
    return exactKeys(value, LICENSE_PROPERTIES)
        && typeof value.spdxId === "string"
        && SPDX_ID.test(value.spdxId)
        && boundedText(value.sourceUrl, MAX_URL)
        && value.sourceUrl.startsWith("https://")
        && digest(value.noticeSha256);
}

function validSignature(value) {
    return exactKeys(value, SIGNATURE_PROPERTIES)
        && value.algorithm === "ed25519"
        && identifier(value.keyId)
        && typeof value.value === "string"
        && ED25519_SIGNATURE.test(value.value);
}

function validHardwareEvidence(value) {
    return exactKeys(value, HARDWARE_PROPERTIES)
        && boundedText(value.deviceName)
        && boundedText(value.driverVersion, 80)
        && boundedText(value.runtimeVersion, 80)
        && value.benchmarkVersion === Benchmark.VERSION
        && digest(value.benchmarkRecordSha256)
        && timestamp(value.measuredAt)
        && DECISIONS.includes(value.decision);
}

function validArtifactIdentity(value) {
    return exactKeys(value, ROOT_PROPERTIES)
        && value.version === VERSION
        && identifier(value.artifactId)
        && version(value.artifactVersion);
}

function validArtifactContracts(value) {
    return validRecipe(value.recipe)
        && validPortableExport(value.portableExport)
        && validNativeBinding(value.nativeBinding)
        && digest(value.tensorContractSha256)
        && validLicense(value.license)
        && validSignature(value.signature)
        && validHardwareEvidence(value.hardwareEvidence);
}

function isQualification(value) {
    return validArtifactIdentity(value) && validArtifactContracts(value);
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

function clone(value) {
    return JSON.parse(JSON.stringify(value));
}

function requireQualification(value) {
    if (!isQualification(value)) {
        throw new QualificationError("qualification-invalid", "artifact qualification is invalid");
    }
    return value;
}

function createQualification(value) {
    return deepFreeze(clone(requireQualification(value)));
}

function unsignedQualification(value) {
    const qualification = requireQualification(value);
    const unsigned = Object.fromEntries(
        Object.entries(qualification).filter(([name]) => name !== "signature"),
    );
    return deepFreeze(clone(unsigned));
}

function canonicalUnsignedQualification(value) {
    return Manifest.canonicalJson(unsignedQualification(value));
}

module.exports = {
    VERSION,
    MAX_TEXT,
    MAX_URL,
    DECISIONS,
    ROOT_PROPERTIES,
    QualificationError,
    isQualification,
    createQualification,
    unsignedQualification,
    canonicalUnsignedQualification,
    validRecipe,
    validPortableExport,
    validNativeBinding,
    validLicense,
    validSignature,
    validHardwareEvidence,
};
