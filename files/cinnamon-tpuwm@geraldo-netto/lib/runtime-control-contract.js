"use strict";

const Domain = require("./domain.js");

const CONTROL_VERSION = 1;
const COMMAND_ID = /^[A-Za-z0-9._-]+$/u;
const OPERATIONS = new Set([
    "set-profile-enabled",
    "set-profile-weight",
    "set-paused",
]);
const ACKNOWLEDGEMENT_STATUSES = new Set(["applied", "rejected"]);
const COMMAND_PROPERTIES = new Set([
    "version", "id", "issuedAt", "expectedRevision", "operation", "profileId", "value",
]);
const ACKNOWLEDGEMENT_PROPERTIES = new Set([
    "version", "commandId", "status", "revision", "appliedAt", "message", "portfolio",
]);
const PORTFOLIO_PROPERTIES = new Set(["paused", "profiles"]);
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

function isCommandOperation(value) {
    switch (value.operation) {
    case "set-profile-enabled":
        return isEnabledCommand(value);
    case "set-profile-weight":
        return isWeightCommand(value);
    case "set-paused":
        return isPauseCommand(value);
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
    return exactRecord(value, COMMAND_PROPERTIES)
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
        && Object.values(value.profiles).every(isProfilePreference);
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
    CONTROL_VERSION,
    OPERATIONS,
    boundedProfileId,
    commandIdentity,
    contractViolation,
    exactRecord,
    hasAcknowledgementEnvelope,
    hasCommandEnvelope,
    isCommandOperation,
    isContractViolation,
    isEnabledCommand,
    isPauseCommand,
    isPortfolio,
    isProfilePreference,
    isRuntimeAcknowledgement,
    isRuntimeCommand,
    isWeightCommand,
    requireControlGateway,
};
