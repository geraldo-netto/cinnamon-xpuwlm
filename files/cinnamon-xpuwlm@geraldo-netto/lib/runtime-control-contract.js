"use strict";

const Domain = require("./domain.js");

const CONTROL_VERSION = 2;
const COMMAND_ID = /^[A-Za-z0-9._-]+$/u;
const OPERATIONS = new Set([
    "set-profile-enabled",
    "set-profile-weight",
    "set-profile-device",
    "set-paused",
    "apply-profiles",
]);
// Several profile settings as one command, one revision, one acknowledgement.
// Sending them separately spends a revision each and leaves policy
// half-applied when one fails, with nothing to retry as a unit.
const CHANGE_PROPERTIES = new Set(["profileId", "enabled", "weight", "deviceId"]);
const MAX_CHANGES = 128;
const ACKNOWLEDGEMENT_STATUSES = new Set(["applied", "rejected"]);
const COMMAND_PROPERTIES = new Set([
    "version", "id", "issuedAt", "expectedRevision", "operation", "profileId", "value",
]);
const BATCH_COMMAND_PROPERTIES = new Set([...COMMAND_PROPERTIES, "changes"]);
const ACKNOWLEDGEMENT_PROPERTIES = new Set([
    "version", "commandId", "status", "revision", "appliedAt", "message", "portfolio",
]);
const PORTFOLIO_PROPERTIES = new Set(["paused", "profiles", "deviceChoices"]);
const PROFILE_PROPERTIES = new Set(["enabled", "weight"]);

const exactRecord = Domain.exactRecord;

function commandIdentity(value) {
    return typeof value === "string"
        && [...value].length >= 1
        && [...value].length <= 120
        && COMMAND_ID.test(value);
}

function boundedProfileId(value) {
    return typeof value === "string" && [...value].length >= 1 && [...value].length <= 80;
}

function isEnabledCommand(value) {
    return boundedProfileId(value.profileId) && typeof value.value === "boolean";
}

function isWeightCommand(value) {
    return boundedProfileId(value.profileId)
        && Number.isInteger(value.value)
        && value.value >= Domain.MIN_WEIGHT
        && value.value <= Domain.MAX_WEIGHT;
}

function isPauseCommand(value) {
    return value.profileId === null
        && typeof value.value === "boolean";
}

function isDeviceChoice(value) {
    return value === null || Domain.validGpuDeviceId(value);
}

function isDeviceCommand(value) {
    return boundedProfileId(value.profileId) && isDeviceChoice(value.value);
}

// A change that sets neither is a caller mistake worth refusing: accepting it
// would spend a revision and alter nothing.
function changesSomething(value) {
    const names = ["enabled", "weight", "deviceId"];
    return names.some((name) => Object.hasOwn(value, name))
        && validOptionalProfileValues(value);
}

function validOptionalProfileValues(value) {
    const enabled = !Object.hasOwn(value, "enabled") || typeof value.enabled === "boolean";
    const weight = !Object.hasOwn(value, "weight") || isWeightValue(value.weight);
    const device = !Object.hasOwn(value, "deviceId") || isDeviceChoice(value.deviceId);
    return enabled && weight && device;
}

function isProfileChange(value) {
    return Domain.isPlainObject(value)
        && Object.keys(value).every((name) => CHANGE_PROPERTIES.has(name))
        && boundedProfileId(value.profileId)
        && changesSomething(value);
}

function isWeightValue(value) {
    return Number.isInteger(value) && value >= Domain.MIN_WEIGHT && value <= Domain.MAX_WEIGHT;
}

function isBatchCommand(value) {
    return value.profileId === null
        && value.value === null
        && Array.isArray(value.changes)
        && value.changes.length >= 1
        && value.changes.length <= MAX_CHANGES
        && value.changes.every(isProfileChange);
}

function isCommandOperation(value) {
    switch (value.operation) {
    case "set-profile-enabled":
        return isEnabledCommand(value);
    case "set-profile-weight":
        return isWeightCommand(value);
    case "set-profile-device":
        return isDeviceCommand(value);
    case "set-paused":
        return isPauseCommand(value);
    case "apply-profiles":
        return isBatchCommand(value);
    default:
        return false;
    }
}

function hasCommandEnvelope(value) {
    return value.version === CONTROL_VERSION
        && commandIdentity(value.id)
        && Number.isInteger(value.issuedAt)
        && value.issuedAt >= 1
        && Number.isInteger(value.expectedRevision)
        && value.expectedRevision >= 0
        && OPERATIONS.has(value.operation);
}

function isRuntimeCommand(value) {
    const expected = Domain.isPlainObject(value) && value.operation === "apply-profiles"
        ? BATCH_COMMAND_PROPERTIES
        : COMMAND_PROPERTIES;
    return exactRecord(value, expected)
        && hasCommandEnvelope(value)
        && isCommandOperation(value);
}

function isProfilePreference(value) {
    return exactRecord(value, PROFILE_PROPERTIES)
        && typeof value.enabled === "boolean"
        && Number.isInteger(value.weight)
        && value.weight >= Domain.MIN_WEIGHT
        && value.weight <= Domain.MAX_WEIGHT;
}

function isPortfolio(value) {
    return exactRecord(value, PORTFOLIO_PROPERTIES)
        && typeof value.paused === "boolean"
        && Domain.isPlainObject(value.profiles)
        && Object.values(value.profiles).every(isProfilePreference)
        && Domain.isPlainObject(value.deviceChoices)
        && Object.keys(value.deviceChoices).length <= Domain.MAX_DEVICE_CHOICES
        && Object.entries(value.deviceChoices).every(
            ([profileId, deviceId]) => boundedProfileId(profileId)
                && Domain.validGpuDeviceId(deviceId),
        );
}

function isRuntimeAcknowledgement(value) {
    return exactRecord(value, ACKNOWLEDGEMENT_PROPERTIES)
        && hasAcknowledgementEnvelope(value)
        && isPortfolio(value.portfolio);
}

function hasAcknowledgementEnvelope(value) {
    return value.version === CONTROL_VERSION
        && commandIdentity(value.commandId)
        && ACKNOWLEDGEMENT_STATUSES.has(value.status)
        && Number.isInteger(value.revision)
        && value.revision >= 0
        && Number.isInteger(value.appliedAt)
        && value.appliedAt >= 1
        && Domain.safeText(value.message, 240) === value.message;
}

// A reply the applet cannot read is a different failure from a service that is
// absent, slow, or refusing, and a caller has to tell them apart without
// matching on English error text. The marker travels with the error, so the
// transport raises it and the presentation layer classifies it structurally
// without either depending on the other.
function contractViolation(ErrorType, message) {
    const error = new ErrorType(message);
    error.controlContractViolation = true;
    return error;
}

function isContractViolation(error) {
    return error !== null
        && typeof error === "object"
        && error.controlContractViolation === true;
}

function requireControlGateway(candidate) {
    if (!candidate
        || typeof candidate.send !== "function"
        || typeof candidate.cancel !== "function") {
        throw new TypeError("A runtime control gateway with send/cancel is required");
    }
    return candidate;
}

module.exports = {
    ACKNOWLEDGEMENT_STATUSES,
    CHANGE_PROPERTIES,
    MAX_CHANGES,
    CONTROL_VERSION,
    OPERATIONS,
    boundedProfileId,
    commandIdentity,
    contractViolation,
    exactRecord,
    hasAcknowledgementEnvelope,
    hasCommandEnvelope,
    changesSomething,
    isBatchCommand,
    isCommandOperation,
    isProfileChange,
    isContractViolation,
    isDeviceChoice,
    isDeviceCommand,
    isEnabledCommand,
    isPauseCommand,
    isPortfolio,
    isProfilePreference,
    isRuntimeAcknowledgement,
    isRuntimeCommand,
    isWeightCommand,
    requireControlGateway,
    validOptionalProfileValues,
};
