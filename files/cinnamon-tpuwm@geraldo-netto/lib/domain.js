"use strict";

const SNAPSHOT_VERSION = 1;
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
        defaultEnabled: true,
        defaultWeight: 2,
    }),
    Object.freeze({
        id: "storage-intelligence",
        title: "Storage intelligence",
        group: "System health",
        description: "SMART · I/O · cache · storage tiers",
        icon: "drive-harddisk-symbolic",
        defaultEnabled: true,
        defaultWeight: 3,
    }),
    Object.freeze({
        id: "resource-scheduler",
        title: "Resource scheduler",
        group: "Orchestration",
        description: "Placement · queues · background jobs",
        icon: "view-grid-symbolic",
        defaultEnabled: true,
        defaultWeight: 3,
    }),
    Object.freeze({
        id: "build-advisor",
        title: "Build advisor",
        group: "Orchestration",
        description: "Compiler profiles · regressions",
        icon: "applications-engineering-symbolic",
        defaultEnabled: true,
        defaultWeight: 2,
    }),
    Object.freeze({
        id: "visual-library",
        title: "Visual library",
        group: "Local workflows",
        description: "Search · tagging · scenes · low-light",
        icon: "image-x-generic-symbolic",
        defaultEnabled: true,
        defaultWeight: 2,
    }),
    Object.freeze({
        id: "network-peripherals",
        title: "Network & peripherals",
        group: "Local workflows",
        description: "Wi-Fi · USB anomaly scoring",
        icon: "network-wireless-symbolic",
        defaultEnabled: false,
        defaultWeight: 2,
    }),
    Object.freeze({
        id: "desktop-context",
        title: "Desktop context",
        group: "Local workflows",
        description: "Window-layout suggestions",
        icon: "view-dual-symbolic",
        defaultEnabled: false,
        defaultWeight: 1,
    }),
    Object.freeze({
        id: "document-intelligence",
        title: "Document intelligence",
        group: "Local workflows",
        description: "Categories · duplicates · layout",
        icon: "x-office-document-symbolic",
        defaultEnabled: false,
        defaultWeight: 2,
    }),
]);

const PROFILE_IDS = new Set(PROFILE_DEFINITIONS.map((profile) => profile.id));
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

function clampWeight(value) {
    return boundedInteger(value, MIN_WEIGHT, MAX_WEIGHT, MIN_WEIGHT);
}

function defaultProfileState() {
    const profiles = {};
    for (const definition of PROFILE_DEFINITIONS) {
        profiles[definition.id] = {
            enabled: definition.defaultEnabled,
            weight: definition.defaultWeight,
        };
    }
    return {paused: false, profiles};
}

function sanitizeProfileState(candidate) {
    const defaults = defaultProfileState();
    if (!isPlainObject(candidate)) {
        return defaults;
    }
    const suppliedProfiles = isPlainObject(candidate.profiles) ? candidate.profiles : {};
    for (const definition of PROFILE_DEFINITIONS) {
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
        return {available: false, name: "No TPU detected", kind: "unknown", reason: "Device state is missing"};
    }
    const available = candidate.available === true;
    return {
        available,
        name: safeText(candidate.name, 120, available ? "TPU accelerator" : "No TPU detected"),
        kind: DEVICE_KINDS.has(candidate.kind) ? candidate.kind : "unknown",
        reason: safeText(candidate.reason, 240, available ? "" : "Device unavailable"),
    };
}

function normalizeMetrics(candidate) {
    const source = isPlainObject(candidate) ? candidate : {};
    const load = nullableBoundedNumber(source.load, 0, 100);
    return {
        load,
        queueDepth: boundedInteger(source.queueDepth, 0, MAX_QUEUE_DEPTH, 0),
        runningProfiles: boundedInteger(source.runningProfiles, 0, PROFILE_DEFINITIONS.length, 0),
    };
}

function normalizeAlert(candidate, nowMs) {
    if (!isPlainObject(candidate)) {
        return null;
    }
    const id = safeText(candidate.id, 120);
    const profileId = safeText(candidate.profileId, 80);
    const title = safeText(candidate.title, 160);
    if (!id || !PROFILE_IDS.has(profileId) || !title) {
        return null;
    }
    return {
        id,
        profileId,
        title,
        summary: safeText(candidate.summary, 500),
        severity: ALERT_SEVERITIES.has(candidate.severity) ? candidate.severity : "advisory",
        timestamp: boundedInteger(candidate.timestamp, 0, nowMs + 60000, nowMs),
        confidence: nullableBoundedNumber(candidate.confidence, 0, 1),
        riskScore: nullableBoundedNumber(candidate.riskScore, 0, 1),
        resolved: candidate.resolved === true,
    };
}

function unavailableSnapshot(reason, nowMs, source = "fallback") {
    return {
        version: SNAPSHOT_VERSION,
        generatedAt: nowMs,
        stale: false,
        source,
        device: {
            available: false,
            name: "No TPU detected",
            kind: "unknown",
            reason: safeText(reason, 240, "Device unavailable"),
        },
        metrics: {load: null, queueDepth: 0, runningProfiles: 0},
        profiles: {},
        alerts: [],
    };
}

function probeSnapshot(device, nowMs) {
    const normalizedDevice = normalizeDevice(device);
    return {
        version: SNAPSHOT_VERSION,
        generatedAt: nowMs,
        stale: false,
        source: "probe",
        device: normalizedDevice,
        metrics: {load: null, queueDepth: 0, runningProfiles: 0},
        profiles: {},
        alerts: [],
    };
}

function normalizeSnapshot(candidate, nowMs, staleAfterMs = DEFAULT_STALE_AFTER_MS) {
    if (!isPlainObject(candidate)) {
        return unavailableSnapshot("Runtime snapshot is not an object", nowMs, "invalid");
    }
    if (candidate.version !== SNAPSHOT_VERSION) {
        return unavailableSnapshot("Unsupported runtime snapshot version", nowMs, "invalid");
    }
    if (typeof candidate.generatedAt !== "number"
        || !Number.isFinite(candidate.generatedAt)
        || candidate.generatedAt <= 0
        || candidate.generatedAt > nowMs + 60000) {
        return unavailableSnapshot("Runtime snapshot timestamp is invalid", nowMs, "invalid");
    }
    const generatedAt = Math.trunc(candidate.generatedAt);
    const age = Math.max(0, nowMs - generatedAt);
    if (age > normalizeStaleAfterMs(staleAfterMs)) {
        const snapshot = unavailableSnapshot("Runtime snapshot is stale", generatedAt, "runtime");
        snapshot.stale = true;
        return snapshot;
    }

    const profiles = {};
    const suppliedProfiles = isPlainObject(candidate.profiles) ? candidate.profiles : {};
    for (const definition of PROFILE_DEFINITIONS) {
        if (Object.hasOwn(suppliedProfiles, definition.id)) {
            profiles[definition.id] = normalizeProfileRuntime(suppliedProfiles[definition.id]);
        }
    }

    const alerts = [];
    const suppliedAlerts = Array.isArray(candidate.alerts) ? candidate.alerts : [];
    for (const suppliedAlert of suppliedAlerts.slice(0, MAX_ALERTS)) {
        const alert = normalizeAlert(suppliedAlert, nowMs);
        if (alert !== null) {
            alerts.push(alert);
        }
    }

    return {
        version: SNAPSHOT_VERSION,
        generatedAt,
        stale: false,
        source: "runtime",
        device: normalizeDevice(candidate.device),
        metrics: normalizeMetrics(candidate.metrics),
        profiles,
        alerts,
    };
}

class WorkloadPortfolio {
    constructor(candidate) {
        const state = sanitizeProfileState(candidate);
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
        for (const definition of PROFILE_DEFINITIONS) {
            profiles[definition.id] = {...this._profiles[definition.id]};
        }
        return {paused: this._paused, profiles};
    }

    list(runtimeProfiles = {}) {
        return PROFILE_DEFINITIONS.map((definition) => {
            const configured = this._profiles[definition.id];
            const runtime = normalizeProfileRuntime(runtimeProfiles[definition.id]);
            const status = this._paused || !configured.enabled ? "paused" : runtime.status;
            return {...definition, ...configured, ...runtime, status};
        });
    }

    _assertProfile(id) {
        if (!PROFILE_IDS.has(id)) {
            throw new RangeError(`Unknown workload profile: ${id}`);
        }
    }
}

module.exports = {
    ALERT_SEVERITIES,
    DEFAULT_STALE_AFTER_MS,
    MAX_ALERTS,
    MAX_WEIGHT,
    MIN_WEIGHT,
    PROFILE_DEFINITIONS,
    PROFILE_IDS,
    PROFILE_STATUSES,
    SNAPSHOT_VERSION,
    WorkloadPortfolio,
    boundedInteger,
    boundedNumber,
    clampWeight,
    defaultProfileState,
    finiteNumber,
    isPlainObject,
    normalizeAlert,
    normalizeDevice,
    normalizeMetrics,
    normalizeProfileRuntime,
    normalizeSnapshot,
    normalizeStaleAfterMs,
    nullableBoundedNumber,
    probeSnapshot,
    safeText,
    sanitizeProfileState,
    unavailableSnapshot,
};
