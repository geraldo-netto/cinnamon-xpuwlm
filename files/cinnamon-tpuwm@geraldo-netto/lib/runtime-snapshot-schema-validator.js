"use strict";

const Domain = require("./domain.js");
const SnapshotValidator = require("./snapshot-validator.js");
const WorkloadRegistry = require("./workload-registry.js");

const ROOT_PROPERTIES = new Set(["version", "generatedAt", "devices", "metrics", "profiles", "alerts"]);
const ROOT_REQUIRED = Object.freeze([...ROOT_PROPERTIES]);
const DEVICE_PROPERTIES = new Set(["id", "backend", "available", "name", "kind", "vendor", "load", "reason"]);
const DEVICE_REQUIRED = Object.freeze(["id", "backend", "available", "name", "kind"]);
const MAX_DEVICE_ENTRIES = 16;
const METRIC_PROPERTIES = new Set(["queueDepth", "runningProfiles"]);
const METRIC_REQUIRED = Object.freeze([...METRIC_PROPERTIES]);
const PROFILE_PROPERTIES = new Set(["status", "queued", "detail"]);
const ALERT_PROPERTIES = new Set([
    "id", "profileId", "title", "summary", "severity", "timestamp",
    "confidence", "riskScore", "resolved",
]);
const ALERT_REQUIRED = Object.freeze(["id", "profileId", "title", "summary", "severity", "timestamp"]);
const DEVICE_KINDS = new Set(["usb", "pcie", "accel", "dri", "unknown"]);
const DEVICE_BACKENDS = new Set(["tpu", "npu", "gpu"]);
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

function hasDeviceIdentity(value) {
    return hasCodePointLength(value.id, 1, 80)
        && DEVICE_BACKENDS.has(value.backend)
        && typeof value.available === "boolean"
        && hasCodePointLength(value.name, 0, 120)
        && DEVICE_KINDS.has(value.kind);
}

function hasDeviceMeasurements(value) {
    return optionalProperty(value, "vendor", (vendor) => hasCodePointLength(vendor, 0, 80))
        && optionalProperty(value, "load", (load) => load === null || isNumberBetween(load, 0, 100))
        && optionalProperty(value, "reason", (reason) => hasCodePointLength(reason, 0, 240));
}

function isDeviceEntry(value) {
    return isRecord(value)
        && hasContractProperties(value, DEVICE_REQUIRED, DEVICE_PROPERTIES)
        && hasDeviceIdentity(value)
        && hasDeviceMeasurements(value);
}

function isDevices(value) {
    return Array.isArray(value)
        && value.length >= 1
        && value.length <= MAX_DEVICE_ENTRIES
        && value.every(isDeviceEntry);
}

function isMetrics(value) {
    return isRecord(value)
        && hasContractProperties(value, METRIC_REQUIRED, METRIC_PROPERTIES)
        && isIntegerBetween(value.queueDepth, 0, 1_000_000)
        && isIntegerBetween(value.runningProfiles, 0, WorkloadRegistry.MAX_WORKLOADS);
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

function hasAlertIdentity(value) {
    return hasCodePointLength(value.id, 1, 120)
        && hasCodePointLength(value.profileId, 1, 80)
        && hasCodePointLength(value.title, 1, 160);
}

function hasAlertReport(value) {
    return hasCodePointLength(value.summary, 0, 500)
        && ALERT_SEVERITIES.has(value.severity)
        && isIntegerAtLeast(value.timestamp, 0);
}

function hasAlertEvidence(value) {
    return optionalProperty(value, "confidence", isNullableEvidence)
        && optionalProperty(value, "riskScore", isNullableEvidence)
        && optionalProperty(value, "resolved", (resolved) => typeof resolved === "boolean");
}

function isAlert(value) {
    return isRecord(value)
        && hasContractProperties(value, ALERT_REQUIRED, ALERT_PROPERTIES)
        && hasAlertIdentity(value)
        && hasAlertReport(value)
        && hasAlertEvidence(value);
}

function isAlerts(value) {
    return Array.isArray(value) && value.length <= 100 && value.every(isAlert);
}

function isRuntimeSnapshot(value) {
    return isRecord(value)
        && hasContractProperties(value, ROOT_REQUIRED, ROOT_PROPERTIES)
        && value.version === Domain.SNAPSHOT_VERSION
        && isIntegerAtLeast(value.generatedAt, Domain.MIN_GENERATED_AT)
        && isDevices(value.devices)
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
