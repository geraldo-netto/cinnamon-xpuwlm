"use strict";

const Domain = require("./domain.js");
const SnapshotValidator = require("./snapshot-validator.js");
const WorkloadRegistry = require("./workload-registry.js");

const ROOT_REQUIRED = Object.freeze(["version", "generatedAt", "devices", "metrics", "profiles", "alerts"]);
// Plug-in telemetry is an optional, independently versioned extension the
// runtime publishes and this applet does not read. It is validated rather
// than ignored so the concrete validator stays equivalent to the shipped
// schema, and it stays out of ROOT_REQUIRED so a runtime that omits it is
// still a valid snapshot.
const ROOT_PROPERTIES = new Set([...ROOT_REQUIRED, "pluginTelemetry"]);
const DEVICE_PROPERTIES = new Set(["id", "backend", "available", "name", "kind", "vendor", "load", "reason"]);
const DEVICE_REQUIRED = Object.freeze(["id", "backend", "available", "name", "kind"]);
const MAX_DEVICE_ENTRIES = 16;
const METRIC_PROPERTIES = new Set(["queueDepth", "runningProfiles"]);
const METRIC_REQUIRED = Object.freeze([...METRIC_PROPERTIES]);
const PROFILE_PROPERTIES = new Set(["status", "queued", "detail"]);
// The runtime bounds how many profiles one snapshot may describe, matching the
// plug-in ceiling the registry enforces. Without the bound a hostile snapshot
// could make the applet walk an unbounded map before anything rejected it.
const MAX_PROFILE_ENTRIES = WorkloadRegistry.MAX_WORKLOADS;
// `resultRef` is the runtime's handle for the job result behind an alert. The
// applet does not resolve it yet, but it must be accepted: the runtime stamps
// one on every alert it publishes.
const ALERT_PROPERTIES = new Set([
    "id", "profileId", "title", "summary", "severity", "timestamp",
    "confidence", "riskScore", "resolved", "resultRef",
]);
const RESULT_REFERENCE = /^result-[A-Za-z0-9._-]+$/u;
const ALERT_REQUIRED = Object.freeze(["id", "profileId", "title", "summary", "severity", "timestamp"]);
const DEVICE_KINDS = new Set(["usb", "pcie", "accel", "dri", "unknown"]);
const DEVICE_BACKENDS = new Set(["tpu", "npu", "gpu"]);
const PROFILE_STATUSES = new Set(["healthy", "running", "watching", "idle", "paused", "unavailable"]);
const ALERT_SEVERITIES = new Set(["advisory", "warning", "critical"]);

const TELEMETRY_PROPERTIES = new Set(["version", "plugins"]);
const TELEMETRY_REQUIRED = Object.freeze([...TELEMETRY_PROPERTIES]);
const TELEMETRY_VERSION = 1;
const MAX_TELEMETRY_PLUGINS = 128;
const TELEMETRY_COUNTERS = Object.freeze([
    "deadlineExceeded", "retries", "cancellations", "drops", "successes", "failures",
]);
const TELEMETRY_PLUGIN_REQUIRED = Object.freeze([
    "id", "health", "stage", "artifactReadiness", "queuedJobs", "activeJobs",
    "lastSuccessAt", "lastErrorCode", "lastErrorAt", ...TELEMETRY_COUNTERS,
]);
const TELEMETRY_PLUGIN_PROPERTIES = new Set(TELEMETRY_PLUGIN_REQUIRED);
const TELEMETRY_HEALTH = new Set(["initializing", "healthy", "degraded", "unavailable", "stopped"]);
const TELEMETRY_STAGES = new Set([
    null, "collect", "preprocess", "resolve", "infer", "postprocess", "deliver", "terminal",
]);
const TELEMETRY_ARTIFACT_READINESS = new Set([
    "unknown", "resolving", "ready", "missing", "rejected", "incompatible",
]);
const MAX_TELEMETRY_COUNTER = 1_000_000_000;
const MAX_TELEMETRY_TIMESTAMP = Number.MAX_SAFE_INTEGER;
// Lower-case, dash-separated identifiers; the runtime uses the same grammar
// for plug-in ids and error codes.
const TELEMETRY_IDENTIFIER = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;

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
    return isRecord(value)
        && Object.keys(value).length <= MAX_PROFILE_ENTRIES
        && Object.values(value).every(isProfile);
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

function isResultReference(value) {
    return hasCodePointLength(value, 8, 120) && RESULT_REFERENCE.test(value);
}

function hasAlertEvidence(value) {
    return optionalProperty(value, "confidence", isNullableEvidence)
        && optionalProperty(value, "riskScore", isNullableEvidence)
        && optionalProperty(value, "resolved", (resolved) => typeof resolved === "boolean")
        && optionalProperty(value, "resultRef", isResultReference);
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

function isTelemetryIdentifier(value, minimum, maximum) {
    return hasCodePointLength(value, minimum, maximum) && TELEMETRY_IDENTIFIER.test(value);
}

// `null` carries no string or numeric facets in JSON Schema, so a nullable
// field is either absent of value or fully constrained, never half-checked.
function isNullableTelemetryCode(value) {
    return value === null || isTelemetryIdentifier(value, 1, 80);
}

function isNullableTelemetryTimestamp(value) {
    return value === null || isIntegerBetween(value, 0, MAX_TELEMETRY_TIMESTAMP);
}

function hasTelemetryState(value) {
    return isTelemetryIdentifier(value.id, 1, 80)
        && TELEMETRY_HEALTH.has(value.health)
        && TELEMETRY_STAGES.has(value.stage)
        && TELEMETRY_ARTIFACT_READINESS.has(value.artifactReadiness);
}

function hasTelemetryWorkload(value) {
    return isIntegerBetween(value.queuedJobs, 0, 1_000_000)
        && isIntegerBetween(value.activeJobs, 0, 1024)
        && isNullableTelemetryTimestamp(value.lastSuccessAt)
        && isNullableTelemetryTimestamp(value.lastErrorAt)
        && isNullableTelemetryCode(value.lastErrorCode);
}

function hasTelemetryCounters(value) {
    return TELEMETRY_COUNTERS.every(
        (name) => isIntegerBetween(value[name], 0, MAX_TELEMETRY_COUNTER),
    );
}

function isTelemetryPlugin(value) {
    return isRecord(value)
        && hasContractProperties(value, TELEMETRY_PLUGIN_REQUIRED, TELEMETRY_PLUGIN_PROPERTIES)
        && hasTelemetryState(value)
        && hasTelemetryWorkload(value)
        && hasTelemetryCounters(value);
}

function isPluginTelemetry(value) {
    return isRecord(value)
        && hasContractProperties(value, TELEMETRY_REQUIRED, TELEMETRY_PROPERTIES)
        && value.version === TELEMETRY_VERSION
        && Array.isArray(value.plugins)
        && value.plugins.length <= MAX_TELEMETRY_PLUGINS
        && value.plugins.every(isTelemetryPlugin);
}

function hasSnapshotCollections(value) {
    return isDevices(value.devices)
        && isMetrics(value.metrics)
        && isProfiles(value.profiles)
        && isAlerts(value.alerts)
        && optionalProperty(value, "pluginTelemetry", isPluginTelemetry);
}

function isRuntimeSnapshot(value) {
    return isRecord(value)
        && hasContractProperties(value, ROOT_REQUIRED, ROOT_PROPERTIES)
        && value.version === Domain.SNAPSHOT_VERSION
        && isIntegerAtLeast(value.generatedAt, Domain.MIN_GENERATED_AT)
        && hasSnapshotCollections(value);
}

class RuntimeSnapshotSchemaValidator {
    validate(candidate) {
        return isRuntimeSnapshot(candidate)
            ? SnapshotValidator.validationAccepted()
            : SnapshotValidator.validationRejected("schema-v1");
    }
}

module.exports = {
    MAX_PROFILE_ENTRIES,
    MAX_TELEMETRY_PLUGINS,
    RuntimeSnapshotSchemaValidator,
    isPluginTelemetry,
    isRuntimeSnapshot,
    isTelemetryPlugin,
};
