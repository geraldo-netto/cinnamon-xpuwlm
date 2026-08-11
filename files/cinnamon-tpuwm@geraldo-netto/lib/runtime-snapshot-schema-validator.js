"use strict";

const Contract = require("./runtime-snapshot-contract.js");
const Domain = require("./domain.js");
const ProfileBlockers = require("./profile-blockers.js");
const SnapshotValidator = require("./snapshot-validator.js");
const WorkloadRegistry = require("./workload-registry.js");

// Every name, value, and bound below is derived from the shipped schema by
// scripts/generate-snapshot-contract.js rather than written twice. The copy
// that used to live here drifted once, and the applet reported that as a
// runtime service which was not publishing state — indistinguishable from one
// that had stopped. What stays hand-written is the checking itself: types,
// structure, and the rules a JSON schema cannot express.
const {ALLOWLISTS, BOUNDS, ENUMS, REQUIRED} = Contract;

const ROOT_REQUIRED = REQUIRED.root;
// Plug-in telemetry is an optional, independently versioned extension the
// runtime publishes and this applet does not read. It is validated rather
// than ignored so the concrete validator stays equivalent to the shipped
// schema, and it stays out of ROOT_REQUIRED so a runtime that omits it is
// still a valid snapshot.
const ROOT_PROPERTIES = ALLOWLISTS.root;
const DEVICE_PROPERTIES = ALLOWLISTS.device;
const DEVICE_REQUIRED = REQUIRED.device;
const MAX_DEVICE_ENTRIES = BOUNDS.maxDevices;
const METRIC_PROPERTIES = ALLOWLISTS.metric;
const METRIC_REQUIRED = REQUIRED.metric;
const PROFILE_PROPERTIES = ALLOWLISTS.profile;
// The machine-readable counterpart to `detail`. Read from the classifier
// rather than restated, because a second copy of this list is a second thing
// to forget: the runtime adding a state the validator does not know would
// make the applet reject every snapshot rather than report one profile it
// does not recognise.
const PROFILE_REASONS = new Set([
    ...Object.keys(ProfileBlockers.REASON_CODE_KINDS),
    ...ProfileBlockers.NON_BLOCKING_REASON_CODES,
]);
// The runtime bounds how many profiles one snapshot may describe, matching the
// plug-in ceiling the registry enforces. Without the bound a hostile snapshot
// could make the applet walk an unbounded map before anything rejected it.
const MAX_PROFILE_ENTRIES = Math.min(BOUNDS.maxProfiles, WorkloadRegistry.MAX_WORKLOADS);
// `resultRef` is the runtime's handle for the job result behind an alert. The
// applet does not resolve it yet, but it must be accepted: the runtime stamps
// one on every alert it publishes.
const ALERT_PROPERTIES = ALLOWLISTS.alert;
const RESULT_REFERENCE = /^result-[A-Za-z0-9._-]+$/u;
const ALERT_REQUIRED = REQUIRED.alert;
const DEVICE_KINDS = ENUMS.deviceKind;
const DEVICE_BACKENDS = ENUMS.deviceBackend;
const PROFILE_STATUSES = ENUMS.profileStatus;
const ALERT_SEVERITIES = ENUMS.alertSeverity;

// Where the runtime will read a referenced input buffer from. Optional, so a
// runtime that predates the field still publishes a valid snapshot, and
// validated rather than ignored so this validator stays equivalent to the
// shipped schema.
const INPUTS_PROPERTIES = ALLOWLISTS.inputs;
const INPUTS_REQUIRED = REQUIRED.inputs;
const MAX_INPUT_ROOTS = BOUNDS.maxInputRoots;
const MAX_INPUT_ROOT_LENGTH = BOUNDS.maxInputRootLength;
const MAX_INPUT_BYTES = BOUNDS.maxInputBytes;

const KERNEL_PROPERTIES = ALLOWLISTS.kernelTelemetry;
const KERNEL_REQUIRED = REQUIRED.kernelTelemetry;
const KERNEL_HISTOGRAM_PROPERTIES = ALLOWLISTS.kernelHistogram;
const KERNEL_HISTOGRAM_REQUIRED = REQUIRED.kernelHistogram;
const KERNEL_COUNTER_PROPERTIES = ALLOWLISTS.kernelCounter;
const KERNEL_COUNTER_REQUIRED = REQUIRED.kernelCounter;
const KERNEL_STATES = ENUMS.kernelTelemetryState;
const MAX_KERNEL_SERIES = BOUNDS.maxKernelSeries;
const MAX_KERNEL_BUCKETS = BOUNDS.maxKernelBuckets;
const MAX_KERNEL_NAME_LENGTH = BOUNDS.maxKernelNameLength;
const MAX_KERNEL_DETAIL_LENGTH = BOUNDS.maxKernelDetailLength;
const MAX_KERNEL_COUNT = BOUNDS.maxKernelCount;
const KERNEL_TELEMETRY_VERSION = BOUNDS.kernelTelemetryVersion;

const TELEMETRY_PROPERTIES = ALLOWLISTS.telemetry;
const TELEMETRY_REQUIRED = REQUIRED.telemetry;
const TELEMETRY_VERSION = BOUNDS.telemetryVersion;
const MAX_TELEMETRY_PLUGINS = BOUNDS.maxTelemetryPlugins;
const TELEMETRY_COUNTERS = Object.freeze([
    "deadlineExceeded", "retries", "cancellations", "drops", "successes", "failures",
]);
const TELEMETRY_PLUGIN_REQUIRED = Object.freeze([
    "id", "health", "stage", "artifactReadiness", "queuedJobs", "activeJobs",
    "lastSuccessAt", "lastErrorCode", "lastErrorAt", ...TELEMETRY_COUNTERS,
]);
const TELEMETRY_PLUGIN_PROPERTIES = ALLOWLISTS.telemetryPlugin;
const TELEMETRY_HEALTH = ENUMS.telemetryHealth;
const TELEMETRY_STAGES = ENUMS.telemetryStage;
const TELEMETRY_ARTIFACT_READINESS = ENUMS.telemetryArtifactReadiness;
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
        && optionalProperty(value, "detail", (detail) => hasCodePointLength(detail, 0, 240))
        && optionalProperty(value, "reason", (reason) => PROFILE_REASONS.has(reason));
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

function isInputRoots(value) {
    return Array.isArray(value)
        && value.length <= MAX_INPUT_ROOTS
        && new Set(value).size === value.length
        && value.every((root) => hasCodePointLength(root, 1, MAX_INPUT_ROOT_LENGTH));
}

function isSnapshotInputs(value) {
    return isRecord(value)
        && hasContractProperties(value, INPUTS_REQUIRED, INPUTS_PROPERTIES)
        && isInputRoots(value.roots)
        && isIntegerBetween(value.maxBytes, 0, MAX_INPUT_BYTES);
}

function isKernelHistogram(value) {
    return isRecord(value)
        && hasContractProperties(
            value, KERNEL_HISTOGRAM_REQUIRED, KERNEL_HISTOGRAM_PROPERTIES,
        )
        && hasCodePointLength(value.name, 1, MAX_KERNEL_NAME_LENGTH)
        && hasCodePointLength(value.unit, 1, MAX_KERNEL_NAME_LENGTH)
        && Array.isArray(value.buckets)
        && value.buckets.length <= MAX_KERNEL_BUCKETS
        && value.buckets.every((count) => isIntegerBetween(count, 0, MAX_KERNEL_COUNT));
}

function isKernelCounter(value) {
    return isRecord(value)
        && hasContractProperties(value, KERNEL_COUNTER_REQUIRED, KERNEL_COUNTER_PROPERTIES)
        && hasCodePointLength(value.name, 1, MAX_KERNEL_NAME_LENGTH)
        && isIntegerBetween(value.value, 0, MAX_KERNEL_COUNT);
}

function hasKernelTelemetryMetadata(value) {
    return value.version === KERNEL_TELEMETRY_VERSION
        && KERNEL_STATES.has(value.state)
        && hasCodePointLength(value.detail, 0, MAX_KERNEL_DETAIL_LENGTH)
        && isIntegerBetween(value.collectedAtMs, 0, MAX_KERNEL_COUNT);
}

function hasKernelTelemetrySeries(value) {
    return Array.isArray(value.histograms)
        && value.histograms.length <= MAX_KERNEL_SERIES
        && value.histograms.every(isKernelHistogram)
        && Array.isArray(value.counters)
        && value.counters.length <= MAX_KERNEL_SERIES
        && value.counters.every(isKernelCounter);
}

function isKernelTelemetry(value) {
    return isRecord(value)
        && hasContractProperties(value, KERNEL_REQUIRED, KERNEL_PROPERTIES)
        && hasKernelTelemetryMetadata(value)
        && hasKernelTelemetrySeries(value);
}

function hasSnapshotCollections(value) {
    return isDevices(value.devices)
        && isMetrics(value.metrics)
        && isProfiles(value.profiles)
        && isAlerts(value.alerts)
        && optionalProperty(value, "inputs", isSnapshotInputs)
        && optionalProperty(value, "kernelTelemetry", isKernelTelemetry)
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

const CONTRACT_ALLOWLISTS = Object.freeze({
    root: ROOT_PROPERTIES,
    inputs: INPUTS_PROPERTIES,
    kernelTelemetry: KERNEL_PROPERTIES,
    kernelHistogram: KERNEL_HISTOGRAM_PROPERTIES,
    kernelCounter: KERNEL_COUNTER_PROPERTIES,
    device: DEVICE_PROPERTIES,
    metric: METRIC_PROPERTIES,
    profile: PROFILE_PROPERTIES,
    alert: ALERT_PROPERTIES,
    telemetry: TELEMETRY_PROPERTIES,
    telemetryPlugin: TELEMETRY_PLUGIN_PROPERTIES,
});

const CONTRACT_ENUMS = Object.freeze({
    profileStatus: PROFILE_STATUSES,
    profileReason: PROFILE_REASONS,
    alertSeverity: ALERT_SEVERITIES,
    deviceKind: DEVICE_KINDS,
    deviceBackend: DEVICE_BACKENDS,
    kernelTelemetryState: KERNEL_STATES,
});

module.exports = {
    CONTRACT_ALLOWLISTS,
    CONTRACT_ENUMS,
    MAX_PROFILE_ENTRIES,
    PROFILE_REASONS,
    MAX_TELEMETRY_PLUGINS,
    RuntimeSnapshotSchemaValidator,
    isPluginTelemetry,
    isKernelTelemetry,
    isRuntimeSnapshot,
    isSnapshotInputs,
    isTelemetryPlugin,
};
