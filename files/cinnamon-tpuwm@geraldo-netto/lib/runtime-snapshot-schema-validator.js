"use strict";

const Domain = require("./domain.js");
const SnapshotValidator = require("./snapshot-validator.js");

const ROOT_PROPERTIES = new Set(["version", "generatedAt", "device", "metrics", "profiles", "alerts"]);
const ROOT_REQUIRED = Object.freeze([...ROOT_PROPERTIES]);
const DEVICE_PROPERTIES = new Set(["available", "name", "kind", "reason"]);
const DEVICE_REQUIRED = Object.freeze(["available", "name", "kind"]);
const METRIC_PROPERTIES = new Set(["load", "queueDepth", "runningProfiles"]);
const METRIC_REQUIRED = Object.freeze([...METRIC_PROPERTIES]);
const PROFILE_PROPERTIES = new Set(["status", "queued", "detail"]);
const ALERT_PROPERTIES = new Set([
    "id", "profileId", "title", "summary", "severity", "timestamp",
    "confidence", "riskScore", "resolved",
]);
const ALERT_REQUIRED = Object.freeze(["id", "profileId", "title", "summary", "severity", "timestamp"]);
const DEVICE_KINDS = new Set(["usb", "pcie", "unknown"]);
const PROFILE_STATUSES = new Set(["healthy", "running", "watching", "idle", "paused", "unavailable"]);
const ALERT_SEVERITIES = new Set(["advisory", "warning", "critical"]);

function isRecord(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasContractProperties(value, required, allowed) {
    return required.every((name) => Object.hasOwn(value, name))
        && Object.keys(value).every((name) => allowed.has(name));
}

function hasCodePointLength(value, minimum, maximum) {
    if (typeof value !== "string") {
        return false;
    }
    let length = 0;
    for (const _character of value) {
        length += 1;
        if (length > maximum) {
            return false;
        }
    }
    return length >= minimum;
}

function isNumberBetween(value, minimum, maximum) {
    return Number.isFinite(value)
        && value >= minimum
        && value <= maximum;
}

function isIntegerBetween(value, minimum, maximum) {
    return Number.isInteger(value) && value >= minimum && value <= maximum;
}

function isIntegerAtLeast(value, minimum) {
    return Number.isInteger(value) && value >= minimum;
}

function optionalProperty(value, name, predicate) {
    return !Object.hasOwn(value, name) || predicate(value[name]);
}

function isDevice(value) {
    return isRecord(value)
        && hasContractProperties(value, DEVICE_REQUIRED, DEVICE_PROPERTIES)
        && typeof value.available === "boolean"
        && hasCodePointLength(value.name, 0, 120)
        && DEVICE_KINDS.has(value.kind)
        && optionalProperty(value, "reason", (reason) => hasCodePointLength(reason, 0, 240));
}

function isMetrics(value) {
    return isRecord(value)
        && hasContractProperties(value, METRIC_REQUIRED, METRIC_PROPERTIES)
        && (value.load === null || isNumberBetween(value.load, 0, 100))
        && isIntegerBetween(value.queueDepth, 0, 1_000_000)
        && isIntegerBetween(value.runningProfiles, 0, 8);
}

function isProfile(value) {
    return isRecord(value)
        && hasContractProperties(value, [], PROFILE_PROPERTIES)
        && optionalProperty(value, "status", (status) => PROFILE_STATUSES.has(status))
        && optionalProperty(value, "queued", (queued) => isIntegerBetween(queued, 0, 1_000_000))
        && optionalProperty(value, "detail", (detail) => hasCodePointLength(detail, 0, 240));
}

function isProfiles(value) {
    return isRecord(value) && Object.values(value).every(isProfile);
}

function isNullableEvidence(value) {
    return value === null || isNumberBetween(value, 0, 1);
}

function isAlert(value) {
    return isRecord(value)
        && hasContractProperties(value, ALERT_REQUIRED, ALERT_PROPERTIES)
        && hasCodePointLength(value.id, 1, 120)
        && hasCodePointLength(value.profileId, 1, 80)
        && hasCodePointLength(value.title, 1, 160)
        && hasCodePointLength(value.summary, 0, 500)
        && ALERT_SEVERITIES.has(value.severity)
        && isIntegerAtLeast(value.timestamp, 0)
        && optionalProperty(value, "confidence", isNullableEvidence)
        && optionalProperty(value, "riskScore", isNullableEvidence)
        && optionalProperty(value, "resolved", (resolved) => typeof resolved === "boolean");
}

function isAlerts(value) {
    return Array.isArray(value) && value.length <= 100 && value.every(isAlert);
}

function isRuntimeSnapshot(value) {
    return isRecord(value)
        && hasContractProperties(value, ROOT_REQUIRED, ROOT_PROPERTIES)
        && value.version === Domain.SNAPSHOT_VERSION
        && isIntegerAtLeast(value.generatedAt, Domain.MIN_GENERATED_AT)
        && isDevice(value.device)
        && isMetrics(value.metrics)
        && isProfiles(value.profiles)
        && isAlerts(value.alerts);
}

class RuntimeSnapshotSchemaValidator {
    validate(candidate) {
        return isRuntimeSnapshot(candidate)
            ? SnapshotValidator.validationAccepted()
            : SnapshotValidator.validationRejected("schema-v1");
    }
}

module.exports = {
    RuntimeSnapshotSchemaValidator,
    isRuntimeSnapshot,
};
