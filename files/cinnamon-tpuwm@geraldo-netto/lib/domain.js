"use strict";

const SNAPSHOT_VERSION = 1;
const MIN_GENERATED_AT = 1;
const MAX_CLOCK_SKEW_MS = 60000;
const DEFAULT_STALE_AFTER_MS = 15000;
const MIN_WEIGHT = 1;
const MAX_WEIGHT = 5;
const MAX_QUEUE_DEPTH = 1000000;
const MAX_ALERTS = 100;

const PROFILE_DEFINITIONS = Object.freeze([
    Object.freeze({
        id: "hardware-health",
        title: "Hardware health",
        group: "System health",
        description: "Power · UPS · memory faults",
        icon: "applications-system-symbolic",
        order: 10,
        defaultEnabled: true,
        defaultWeight: 2,
    }),
    Object.freeze({
        id: "storage-intelligence",
        title: "Storage intelligence",
        group: "System health",
        description: "SMART · I/O · cache · storage tiers",
        icon: "drive-harddisk-symbolic",
        order: 20,
        defaultEnabled: true,
        defaultWeight: 3,
    }),
    Object.freeze({
        id: "resource-scheduler",
        title: "Resource scheduler",
        group: "Orchestration",
        description: "Placement · queues · background jobs",
        icon: "view-grid-symbolic",
        order: 30,
        defaultEnabled: true,
        defaultWeight: 3,
    }),
    Object.freeze({
        id: "build-advisor",
        title: "Build advisor",
        group: "Orchestration",
        description: "Compiler profiles · regressions",
        icon: "applications-engineering-symbolic",
        order: 40,
        defaultEnabled: true,
        defaultWeight: 2,
    }),
    Object.freeze({
        id: "visual-library",
        title: "Visual library",
        group: "Local workflows",
        description: "Search · tagging · scenes · low-light",
        icon: "image-x-generic-symbolic",
        order: 50,
        defaultEnabled: true,
        defaultWeight: 2,
    }),
    Object.freeze({
        id: "network-peripherals",
        title: "Network & peripherals",
        group: "Local workflows",
        description: "Wi-Fi · USB anomaly scoring",
        icon: "network-wireless-symbolic",
        order: 60,
        defaultEnabled: false,
        defaultWeight: 2,
    }),
    Object.freeze({
        id: "desktop-context",
        title: "Desktop context",
        group: "Local workflows",
        description: "Window-layout suggestions",
        icon: "view-dual-symbolic",
        order: 70,
        defaultEnabled: false,
        defaultWeight: 1,
    }),
    Object.freeze({
        id: "document-intelligence",
        title: "Document intelligence",
        group: "Local workflows",
        description: "Categories · duplicates · layout",
        icon: "x-office-document-symbolic",
        order: 80,
        defaultEnabled: false,
        defaultWeight: 2,
    }),
]);

const PROFILE_STATUSES = new Set([
    "healthy",
    "running",
    "watching",
    "idle",
    "paused",
    "unavailable",
]);
const ALERT_SEVERITIES = new Set(["advisory", "warning", "critical"]);
const DEVICE_KINDS = new Set(["usb", "pcie", "unknown"]);

// Device presence and runtime availability are independent facts. A snapshot
// that cannot be read says nothing about the accelerator, so device health
// stays `unknown` instead of claiming the device is absent.
const DEVICE_STATES = new Set(["present", "absent", "unknown"]);
const RUNTIME_STATES = new Set([
    "connected",
    "not-started",
    "absent",
    "stale",
    "malformed",
    "unreadable",
    "probe-failed",
]);
const SOURCE_RUNTIME_STATES = Object.freeze({
    fallback: "not-started",
    invalid: "malformed",
    error: "unreadable",
    probe: "probe-failed",
    runtime: "stale",
});

function isPlainObject(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value);
}

function finiteNumber(value, fallback) {
    return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function normalizeStaleAfterMs(value) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric) || numeric === 0) {
        return DEFAULT_STALE_AFTER_MS;
    }
    return Math.max(1000, numeric);
}

function boundedInteger(value, minimum, maximum, fallback) {
    const number = finiteNumber(value, fallback);
    return Math.min(maximum, Math.max(minimum, Math.trunc(number)));
}

function boundedNumber(value, minimum, maximum, fallback) {
    const number = finiteNumber(value, fallback);
    return Math.min(maximum, Math.max(minimum, number));
}

function nullableBoundedNumber(value, minimum, maximum) {
    if (value === null || typeof value !== "number" || !Number.isFinite(value)) {
        return null;
    }
    return Math.min(maximum, Math.max(minimum, value));
}

function safeText(value, maximumLength, fallback = "") {
    if (typeof value !== "string") {
        return fallback;
    }
    const numericMaximum = Number(maximumLength);
    const limit = Number.isFinite(numericMaximum)
        ? Math.max(0, Math.trunc(numericMaximum))
        : 0;
    const characters = [];
    for (const character of value.trim()) {
        if (characters.length >= limit) {
            break;
        }
        const codePoint = character.codePointAt(0);
        characters.push(codePoint >= 0xd800 && codePoint <= 0xdfff ? "\ufffd" : character);
    }
    return characters.join("");
}

const PROFILE_DEFINITION_PROPERTIES = new Set([
    "id", "title", "group", "description", "icon", "order", "defaultEnabled", "defaultWeight",
]);

function hasProfileDefinitionShape(value) {
    return isPlainObject(value)
        && Object.keys(value).length === PROFILE_DEFINITION_PROPERTIES.size
        && Object.keys(value).every((name) => PROFILE_DEFINITION_PROPERTIES.has(name));
}

function hasProfileDefinitionIdentity(value) {
    return safeText(value.id, 80) === value.id
        && value.id.length > 0
        && safeText(value.icon, 120) === value.icon
        && value.icon.endsWith("-symbolic");
}

function hasProfileDefinitionText(value) {
    return safeText(value.title, 120) === value.title
        && value.title.length > 0
        && safeText(value.group, 120) === value.group
        && value.group.length > 0
        && safeText(value.description, 240) === value.description
        && value.description.length > 0;
}

function hasProfileDefinitionDefaults(value) {
    return Number.isInteger(value.order)
        && value.order >= 0
        && value.order <= 1000
        && typeof value.defaultEnabled === "boolean"
        && Number.isInteger(value.defaultWeight)
        && value.defaultWeight >= MIN_WEIGHT
        && value.defaultWeight <= MAX_WEIGHT;
}

function isProfileDefinition(value) {
    return hasProfileDefinitionShape(value)
        && hasProfileDefinitionIdentity(value)
        && hasProfileDefinitionText(value)
        && hasProfileDefinitionDefaults(value);
}

class WorkloadCatalog {
    constructor(definitions) {
        if (!Array.isArray(definitions) || !definitions.every(isProfileDefinition)) {
            throw new TypeError("A workload catalog requires valid profile definitions");
        }
        const identifiers = definitions.map((definition) => definition.id);
        if (new Set(identifiers).size !== identifiers.length) {
            throw new RangeError("Workload catalog identifiers must be unique");
        }
        this._definitions = Object.freeze(definitions.map((definition) => Object.freeze({...definition})));
        this._ids = new Set(identifiers);
    }

    get size() {
        return this._definitions.length;
    }

    has(id) {
        return this._ids.has(id);
    }

    definitions() {
        return this._definitions;
    }
}

const DEFAULT_WORKLOAD_CATALOG = new WorkloadCatalog(PROFILE_DEFINITIONS);
const PROFILE_IDS = new Set(PROFILE_DEFINITIONS.map((profile) => profile.id));

function requireWorkloadCatalog(candidate) {
    if (!(candidate instanceof WorkloadCatalog)) {
        throw new TypeError("A workload catalog is required");
    }
    return candidate;
}

// The single `generatedAt` rule shared by the JSON schema, the handwritten
// schema validator, and this normalization step. The clock-skew bound is
// domain-only because a static schema cannot know the current time.
function isValidGeneratedAt(value, nowMs) {
    return Number.isInteger(value)
        && value >= MIN_GENERATED_AT
        && value <= nowMs + MAX_CLOCK_SKEW_MS;
}

function clampWeight(value) {
    return boundedInteger(value, MIN_WEIGHT, MAX_WEIGHT, MIN_WEIGHT);
}

function defaultProfileState(catalog = DEFAULT_WORKLOAD_CATALOG) {
    const definitions = requireWorkloadCatalog(catalog).definitions();
    const profiles = {};
    for (const definition of definitions) {
        profiles[definition.id] = {
            enabled: definition.defaultEnabled,
            weight: definition.defaultWeight,
        };
    }
    return {paused: false, profiles};
}

function sanitizeProfileState(candidate, catalog = DEFAULT_WORKLOAD_CATALOG) {
    const definitions = requireWorkloadCatalog(catalog).definitions();
    const defaults = defaultProfileState(catalog);
    if (!isPlainObject(candidate)) {
        return defaults;
    }
    const suppliedProfiles = isPlainObject(candidate.profiles) ? candidate.profiles : {};
    for (const definition of definitions) {
        const supplied = suppliedProfiles[definition.id];
        if (!isPlainObject(supplied)) {
            continue;
        }
        defaults.profiles[definition.id] = {
            enabled: typeof supplied.enabled === "boolean"
                ? supplied.enabled
                : definition.defaultEnabled,
            weight: clampWeight(supplied.weight ?? definition.defaultWeight),
        };
    }
    defaults.paused = candidate.paused === true;
    return defaults;
}

function normalizeProfileRuntime(candidate) {
    if (!isPlainObject(candidate)) {
        return {status: "idle", queued: 0, detail: ""};
    }
    return {
        status: PROFILE_STATUSES.has(candidate.status) ? candidate.status : "idle",
        queued: boundedInteger(candidate.queued, 0, MAX_QUEUE_DEPTH, 0),
        detail: safeText(candidate.detail, 240),
    };
}

function normalizeDevice(candidate) {
    if (!isPlainObject(candidate)) {
        return {
            available: false,
            state: "absent",
            name: "No TPU detected",
            kind: "unknown",
            reason: "Device state is missing",
        };
    }
    const available = candidate.available === true;
    return {
        available,
        state: available ? "present" : "absent",
        name: safeText(candidate.name, 120, available ? "TPU accelerator" : "No TPU detected"),
        kind: DEVICE_KINDS.has(candidate.kind) ? candidate.kind : "unknown",
        reason: safeText(candidate.reason, 240, available ? "" : "Device unavailable"),
    };
}

function unknownDevice(detail) {
    return {
        available: false,
        state: "unknown",
        name: "TPU state unknown",
        kind: "unknown",
        reason: detail,
    };
}

function health(device, runtime, detail) {
    return {
        device: DEVICE_STATES.has(device) ? device : "unknown",
        runtime: RUNTIME_STATES.has(runtime) ? runtime : "unreadable",
        detail: safeText(detail, 240),
    };
}

function normalizeMetrics(candidate, catalog = DEFAULT_WORKLOAD_CATALOG) {
    const source = isPlainObject(candidate) ? candidate : {};
    const load = nullableBoundedNumber(source.load, 0, 100);
    return {
        load,
        queueDepth: boundedInteger(source.queueDepth, 0, MAX_QUEUE_DEPTH, 0),
        runningProfiles: boundedInteger(source.runningProfiles, 0, requireWorkloadCatalog(catalog).size, 0),
    };
}

function normalizeAlert(candidate, nowMs, catalog = DEFAULT_WORKLOAD_CATALOG) {
    if (!isPlainObject(candidate)) {
        return null;
    }
    const id = safeText(candidate.id, 120);
    const profileId = safeText(candidate.profileId, 80);
    const title = safeText(candidate.title, 160);
    if (!id || !requireWorkloadCatalog(catalog).has(profileId) || !title) {
        return null;
    }
    return {
        id,
        profileId,
        title,
        summary: safeText(candidate.summary, 500),
        severity: ALERT_SEVERITIES.has(candidate.severity) ? candidate.severity : "advisory",
        timestamp: boundedInteger(candidate.timestamp, 0, nowMs + MAX_CLOCK_SKEW_MS, nowMs),
        confidence: nullableBoundedNumber(candidate.confidence, 0, 1),
        riskScore: nullableBoundedNumber(candidate.riskScore, 0, 1),
        resolved: candidate.resolved === true,
    };
}

function unavailableSnapshot(reason, nowMs, source = "fallback") {
    const detail = safeText(reason, 240, "Runtime state is unknown");
    return {
        version: SNAPSHOT_VERSION,
        generatedAt: nowMs,
        stale: false,
        source,
        health: health("unknown", SOURCE_RUNTIME_STATES[source], detail),
        device: unknownDevice(detail),
        metrics: {load: null, queueDepth: null, runningProfiles: null},
        profiles: {},
        alerts: [],
    };
}

function staleSnapshot(generatedAt) {
    const snapshot = unavailableSnapshot("Runtime snapshot is stale", generatedAt, "runtime");
    snapshot.stale = true;
    return snapshot;
}

function expiresOnClock(snapshot) {
    return isPlainObject(snapshot)
        && snapshot.source === "runtime"
        && snapshot.stale !== true;
}

// Milliseconds until a connected snapshot crosses its freshness deadline, or
// null when the snapshot can never expire on its own. The extra millisecond
// keeps the deadline strictly exceeded, matching `normalizeSnapshot`.
function snapshotExpiryDelayMs(snapshot, nowMs, staleAfterMs = DEFAULT_STALE_AFTER_MS) {
    if (!expiresOnClock(snapshot)) {
        return null;
    }
    const deadline = snapshot.generatedAt + normalizeStaleAfterMs(staleAfterMs);
    return Math.max(0, deadline - nowMs) + 1;
}

function isSnapshotExpired(snapshot, nowMs, staleAfterMs = DEFAULT_STALE_AFTER_MS) {
    return expiresOnClock(snapshot)
        && Math.max(0, nowMs - snapshot.generatedAt) > normalizeStaleAfterMs(staleAfterMs);
}

function expireSnapshot(snapshot, nowMs, staleAfterMs = DEFAULT_STALE_AFTER_MS) {
    return isSnapshotExpired(snapshot, nowMs, staleAfterMs)
        ? staleSnapshot(snapshot.generatedAt)
        : snapshot;
}

function probeSnapshot(device, nowMs) {
    const normalizedDevice = normalizeDevice(device);
    return {
        version: SNAPSHOT_VERSION,
        generatedAt: nowMs,
        stale: false,
        source: "probe",
        health: health(
            normalizedDevice.state,
            "absent",
            "No runtime service is publishing a snapshot",
        ),
        device: normalizedDevice,
        metrics: {load: null, queueDepth: null, runningProfiles: null},
        profiles: {},
        alerts: [],
    };
}

function rejectSnapshot(candidate, nowMs, staleAfterMs) {
    if (!isPlainObject(candidate)) {
        return unavailableSnapshot("Runtime snapshot is not an object", nowMs, "invalid");
    }
    if (candidate.version !== SNAPSHOT_VERSION) {
        return unavailableSnapshot("Unsupported runtime snapshot version", nowMs, "invalid");
    }
    if (!isValidGeneratedAt(candidate.generatedAt, nowMs)) {
        return unavailableSnapshot("Runtime snapshot timestamp is invalid", nowMs, "invalid");
    }
    if (Math.max(0, nowMs - candidate.generatedAt) > normalizeStaleAfterMs(staleAfterMs)) {
        return staleSnapshot(candidate.generatedAt);
    }
    return null;
}

function normalizeProfiles(candidate, catalog = DEFAULT_WORKLOAD_CATALOG) {
    const profiles = {};
    const supplied = isPlainObject(candidate) ? candidate : {};
    for (const definition of requireWorkloadCatalog(catalog).definitions()) {
        if (Object.hasOwn(supplied, definition.id)) {
            profiles[definition.id] = normalizeProfileRuntime(supplied[definition.id]);
        }
    }
    return profiles;
}

function normalizeAlerts(candidate, nowMs, catalog = DEFAULT_WORKLOAD_CATALOG) {
    // Stryker disable next-line ArrayDeclaration: a seeded element is not a plain
    // object, so normalizeAlert discards it and the fallback stays observably empty.
    const supplied = Array.isArray(candidate) ? candidate : [];
    const alerts = [];
    for (const suppliedAlert of supplied.slice(0, MAX_ALERTS)) {
        const alert = normalizeAlert(suppliedAlert, nowMs, catalog);
        if (alert !== null) {
            alerts.push(alert);
        }
    }
    return alerts;
}

function normalizeSnapshot(
    candidate,
    nowMs,
    staleAfterMs = DEFAULT_STALE_AFTER_MS,
    catalog = DEFAULT_WORKLOAD_CATALOG,
) {
    const rejected = rejectSnapshot(candidate, nowMs, staleAfterMs);
    if (rejected !== null) {
        return rejected;
    }
    const generatedAt = candidate.generatedAt;
    const profiles = normalizeProfiles(candidate.profiles, catalog);
    const alerts = normalizeAlerts(candidate.alerts, nowMs, catalog);

    const device = normalizeDevice(candidate.device);
    return {
        version: SNAPSHOT_VERSION,
        generatedAt,
        stale: false,
        source: "runtime",
        health: health(device.state, "connected", device.available ? "" : device.reason),
        device,
        metrics: normalizeMetrics(candidate.metrics, catalog),
        profiles,
        alerts,
    };
}

class WorkloadPortfolio {
    constructor(candidate, catalog = DEFAULT_WORKLOAD_CATALOG) {
        this._catalog = requireWorkloadCatalog(catalog);
        const state = sanitizeProfileState(candidate, catalog);
        this._paused = state.paused;
        this._profiles = state.profiles;
    }

    get paused() {
        return this._paused;
    }

    profile(id) {
        this._assertProfile(id);
        return {...this._profiles[id]};
    }

    setEnabled(id, enabled) {
        this._assertProfile(id);
        const next = enabled === true;
        if (this._profiles[id].enabled === next) {
            return false;
        }
        this._profiles[id].enabled = next;
        return true;
    }

    adjustWeight(id, delta) {
        this._assertProfile(id);
        const previous = this._profiles[id].weight;
        const next = clampWeight(previous + finiteNumber(delta, 0));
        this._profiles[id].weight = next;
        return next !== previous;
    }

    pauseAll() {
        if (this._paused) {
            return false;
        }
        this._paused = true;
        return true;
    }

    resumeAll() {
        if (!this._paused) {
            return false;
        }
        this._paused = false;
        return true;
    }

    serialize() {
        const profiles = {};
        for (const definition of this._catalog.definitions()) {
            profiles[definition.id] = {...this._profiles[definition.id]};
        }
        return {paused: this._paused, profiles};
    }

    list(runtimeProfiles = {}) {
        return this._catalog.definitions().map((definition) => {
            const configured = this._profiles[definition.id];
            const runtime = normalizeProfileRuntime(runtimeProfiles[definition.id]);
            const status = this._paused || !configured.enabled ? "paused" : runtime.status;
            return {...definition, ...configured, ...runtime, status};
        });
    }

    _assertProfile(id) {
        if (!this._catalog.has(id)) {
            throw new RangeError(`Unknown workload profile: ${id}`);
        }
    }
}

module.exports = {
    ALERT_SEVERITIES,
    DEFAULT_STALE_AFTER_MS,
    DEFAULT_WORKLOAD_CATALOG,
    DEVICE_STATES,
    MAX_ALERTS,
    MAX_CLOCK_SKEW_MS,
    MAX_WEIGHT,
    MIN_GENERATED_AT,
    MIN_WEIGHT,
    PROFILE_DEFINITIONS,
    PROFILE_IDS,
    PROFILE_STATUSES,
    RUNTIME_STATES,
    SNAPSHOT_VERSION,
    WorkloadCatalog,
    WorkloadPortfolio,
    boundedInteger,
    boundedNumber,
    clampWeight,
    defaultProfileState,
    expireSnapshot,
    finiteNumber,
    health,
    hasProfileDefinitionDefaults,
    hasProfileDefinitionIdentity,
    hasProfileDefinitionShape,
    hasProfileDefinitionText,
    isPlainObject,
    isProfileDefinition,
    isSnapshotExpired,
    isValidGeneratedAt,
    normalizeAlert,
    normalizeAlerts,
    normalizeDevice,
    normalizeMetrics,
    normalizeProfileRuntime,
    normalizeProfiles,
    normalizeSnapshot,
    normalizeStaleAfterMs,
    nullableBoundedNumber,
    probeSnapshot,
    rejectSnapshot,
    requireWorkloadCatalog,
    safeText,
    sanitizeProfileState,
    snapshotExpiryDelayMs,
    staleSnapshot,
    unavailableSnapshot,
    unknownDevice,
};
