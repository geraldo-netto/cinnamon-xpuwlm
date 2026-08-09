"use strict";

const Manager = require("./manager.js");

const STATUS_LABELS = Object.freeze({
    healthy: "Healthy",
    running: "Running",
    watching: "Watching",
    idle: "Idle",
    paused: "Paused",
    unavailable: "Unavailable",
});

const ALERT_SEVERITY_PRIORITY = Object.freeze({
    advisory: 0,
    warning: 1,
    critical: 2,
});

const SEVERITY_LABELS = Object.freeze({
    advisory: "advisory",
    warning: "warning",
    critical: "critical",
});

// Severity is announced as text in the panel and popup summaries; the alert
// card colour is a second cue, never the only one.
function highestActiveSeverity(alerts) {
    let highest = null;
    for (const alert of alerts) {
        const priority = ALERT_SEVERITY_PRIORITY[alert.severity];
        if (alert.resolved === true || priority === undefined) {
            continue;
        }
        if (highest === null || priority > ALERT_SEVERITY_PRIORITY[highest]) {
            highest = alert.severity;
        }
    }
    return highest;
}

function severityText(severity) {
    return severity === null || severity === undefined
        ? "none"
        : SEVERITY_LABELS[severity] || "none";
}

const DEVICE_STATUS_LABELS = Object.freeze({
    present: "Device detected",
    absent: "No device",
    unknown: "Device unknown",
});

const RUNTIME_STATUS_LABELS = Object.freeze({
    connected: "Online",
    "not-started": "Starting",
    absent: "Runtime absent",
    stale: "Runtime stale",
    malformed: "Runtime malformed",
    unreadable: "Runtime unreadable",
    "probe-failed": "Detection failed",
});

// Specific telemetry and recovery guidance per runtime state. Nothing here
// invents an operational value: what is unknown is presented as unknown.
const RUNTIME_RECOVERY = Object.freeze({
    "not-started": Object.freeze({
        kicker: "Starting",
        title: "Monitoring has not started",
        description: "No runtime state has been read yet. Local profile intent is unchanged.",
        steps: Object.freeze([
            Object.freeze(["1", "Wait for the first read", "Monitoring starts with the applet and repeats on the refresh interval."]),
            Object.freeze(["2", "Check the runtime path", "Open the settings and confirm the runtime state path."]),
        ]),
    }),
    absent: Object.freeze({
        kicker: "Runtime absent",
        title: "No runtime service is publishing state",
        description: "Device detection still works. Queue, load, and profile telemetry stay unknown until a runtime publishes a snapshot.",
        steps: Object.freeze([
            Object.freeze(["1", "Start the workload runtime", "A trusted local service must publish the snapshot document."]),
            Object.freeze(["2", "Check the runtime path", "Confirm the configured runtime state path matches the service."]),
        ]),
    }),
    stale: Object.freeze({
        kicker: "Runtime stale",
        title: "The runtime snapshot stopped updating",
        description: "The last snapshot is older than its freshness deadline, so its values are no longer shown as current.",
        steps: Object.freeze([
            Object.freeze(["1", "Check the runtime service", "Confirm the service is running and still writing its snapshot."]),
            Object.freeze(["2", "Check the clock", "A large clock change can also age a snapshot past its deadline."]),
        ]),
    }),
    malformed: Object.freeze({
        kicker: "Runtime malformed",
        title: "The runtime snapshot failed validation",
        description: "The document was read but rejected by the version 1 contract, so none of its values are displayed.",
        steps: Object.freeze([
            Object.freeze(["1", "Check the runtime version", "The service must publish the version 1 snapshot contract."]),
            Object.freeze(["2", "Inspect the document", "Validate it against runtime-snapshot.schema.json."]),
        ]),
    }),
    unreadable: Object.freeze({
        kicker: "Runtime unreadable",
        title: "The runtime snapshot could not be read",
        description: "Reading the snapshot failed, so device and workload telemetry are unknown rather than assumed.",
        steps: Object.freeze([
            Object.freeze(["1", "Check permissions", "Confirm the current user can read the runtime state path."]),
            Object.freeze(["2", "Check the path", "A missing directory or a replaced path object also fails the read."]),
        ]),
    }),
    "probe-failed": Object.freeze({
        kicker: "Detection failed",
        title: "TPU device discovery failed",
        description: "Local discovery could not complete, so device presence is unknown rather than reported as absent.",
        steps: Object.freeze([
            Object.freeze(["1", "Check device access", "Confirm the current user can read the USB and PCIe device nodes."]),
            Object.freeze(["2", "Retry detection", "Discovery runs again on request."]),
        ]),
    }),
    connected: Object.freeze({
        kicker: "Connection required",
        title: "TPU accelerator unavailable",
        description: "Profiles remain saved locally. No data, authorization, backup, or CPU-fallback policy is changed.",
        steps: Object.freeze([
            Object.freeze(["1", "Check the connection", "Reconnect the accelerator directly to a supported USB or PCIe interface."]),
            Object.freeze(["2", "Check device access", "Confirm the current user can access the Edge TPU runtime."]),
        ]),
    }),
});

function formatCount(value) {
    return Number.isFinite(value) ? `${value}` : "—";
}

function healthOf(state) {
    return state.health || {device: "unknown", runtime: "unreadable", detail: ""};
}

function deviceStatusText(state) {
    const health = healthOf(state);
    return health.runtime === "connected" && health.device === "present"
        ? RUNTIME_STATUS_LABELS.connected
        : DEVICE_STATUS_LABELS[health.device] || DEVICE_STATUS_LABELS.unknown;
}

function runtimeStatusText(state) {
    const health = healthOf(state);
    return RUNTIME_STATUS_LABELS[health.runtime] || RUNTIME_STATUS_LABELS.unreadable;
}

function recoveryModel(state) {
    const health = healthOf(state);
    const guidance = RUNTIME_RECOVERY[health.runtime] || RUNTIME_RECOVERY.connected;
    const detail = health.detail || state.device.reason;
    return {
        kicker: guidance.kicker,
        title: guidance.title,
        description: guidance.description,
        steps: guidance.steps
            .map(([number, title, description]) => ({number, title, description}))
            .concat({
                number: `${guidance.steps.length + 1}`,
                title: "Retry now",
                description: detail,
            }),
    };
}

function formatLoad(value) {
    return typeof value === "number" && Number.isFinite(value)
        ? `${Math.round(value)}%`
        : "—";
}

function formatRelativeTime(timestamp, nowMs) {
    if (!Number.isFinite(timestamp) || timestamp <= 0) {
        return "unknown";
    }
    const seconds = Math.max(0, Math.floor((nowMs - timestamp) / 1000));
    if (seconds < 5) {
        return "just now";
    }
    if (seconds < 60) {
        return `${seconds}s ago`;
    }
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) {
        return `${minutes}m ago`;
    }
    const hours = Math.floor(minutes / 60);
    return `${hours}h ago`;
}

function formatFraction(value) {
    return typeof value === "number" && Number.isFinite(value)
        ? `${Math.round(value * 100)}%`
        : "—";
}

function groupProfiles(profiles) {
    const groups = [];
    const byName = new Map();
    for (const profile of profiles) {
        if (!byName.has(profile.group)) {
            const group = {name: profile.group, profiles: []};
            groups.push(group);
            byName.set(profile.group, group);
        }
        byName.get(profile.group).profiles.push({...profile});
    }
    return groups;
}

function attentionReviewText(count) {
    return count === 1 ? "1 item needs review" : `${count} items need review`;
}

function unavailablePanel(state) {
    const unknown = healthOf(state).device === "unknown";
    const reason = unknown
        ? `${runtimeStatusText(state).toLowerCase()}; device state unknown`
        : state.device.reason;
    return {
        accessibleName: `TPU Workload Manager, ${unknown ? "unknown" : "unavailable"}: ${reason}`,
        label: unknown ? "TPU Unknown" : "TPU Offline",
        status: "unavailable",
        severity: null,
        tooltip: `TPU Workload Manager — ${reason}`,
    };
}

function panelModel(state) {
    if (!state.device.available) {
        return unavailablePanel(state);
    }
    if (state.paused) {
        return {
            accessibleName: "TPU Workload Manager, paused: all workloads paused",
            label: "TPU Paused",
            status: "paused",
            severity: null,
            tooltip: "TPU Workload Manager — all workloads paused",
        };
    }
    if (state.source === "probe") {
        return {
            accessibleName: "TPU Workload Manager, detected: hardware detected; runtime not connected",
            label: "TPU Detected",
            status: "detected",
            severity: null,
            tooltip: "TPU Workload Manager — hardware detected; runtime not connected",
        };
    }
    const load = formatLoad(state.device.load);
    const attention = state.attentionCount > 0;
    const reviewText = attentionReviewText(state.attentionCount);
    const severity = highestActiveSeverity(state.alerts);
    const attentionText = `${reviewText}, highest severity ${severityText(severity)}`;
    return {
        accessibleName: attention
            ? `TPU Workload Manager, attention: ${attentionText}`
            : `TPU Workload Manager, online: ${load} load`,
        label: attention ? `TPU ${load} · ${severityText(severity)}` : `TPU ${load}`,
        status: attention ? "attention" : "online",
        severity,
        tooltip: attention
            ? `TPU Workload Manager — ${attentionText}`
            : "TPU Workload Manager — online",
    };
}

function effectiveScreen(state) {
    if (!state.device.available) {
        return "unavailable";
    }
    if (state.paused) {
        return "paused";
    }
    return Manager.sanitizeTab(state.selectedTab);
}

function metricModels(state) {
    return [
        {label: "TPU load", value: state.paused ? "0%" : formatLoad(state.device.load)},
        {label: "Queue", value: formatCount(state.metrics.queueDepth), suffix: state.paused ? "held" : "jobs"},
        {label: "Running", value: state.paused ? "0" : formatCount(state.metrics.runningProfiles), suffix: "profiles"},
        state.paused
            ? {label: "State", value: "Paused", tone: "attention"}
            : {
                label: "Attention",
                value: `${state.attentionCount}`,
                suffix: state.attentionCount > 0
                    ? `${state.attentionCount === 1 ? "item" : "items"} · ${severityText(highestActiveSeverity(state.alerts))}`
                    : "items",
                tone: state.attentionCount > 0 ? "attention" : "normal",
            },
    ];
}

function alertModel(alert, profiles, nowMs) {
    const profile = profiles.find((candidate) => candidate.id === alert.profileId);
    return {
        ...alert,
        profileTitle: profile ? profile.title : "Unknown profile",
        age: formatRelativeTime(alert.timestamp, nowMs),
        confidenceText: formatFraction(alert.confidence),
        riskText: formatFraction(alert.riskScore),
    };
}

function compareActiveAlerts(left, right) {
    const severityDifference = ALERT_SEVERITY_PRIORITY[right.severity]
        - ALERT_SEVERITY_PRIORITY[left.severity];
    if (severityDifference !== 0) {
        return severityDifference;
    }
    const timestampDifference = right.timestamp - left.timestamp;
    if (timestampDifference !== 0) {
        return timestampDifference;
    }
    if (left.id < right.id) {
        return -1;
    }
    if (left.id > right.id) {
        return 1;
    }
    return 0;
}

function toViewModel(state, nowMs = Date.now()) {
    const screen = effectiveScreen(state);
    const enabledProfiles = state.profiles.filter((profile) => profile.enabled);
    const pausedProfiles = state.profiles.filter((profile) => !profile.enabled);
    const activeAlerts = state.alerts
        .filter((alert) => !alert.resolved)
        .sort(compareActiveAlerts)
        .map((alert) => alertModel(alert, state.profiles, nowMs));
    const resolvedAlerts = state.alerts
        .filter((alert) => alert.resolved)
        .map((alert) => alertModel(alert, state.profiles, nowMs));
    const deviceStatus = deviceStatusText(state);
    const control = state.control || {pending: false, message: ""};
    return {
        screen,
        policyPaused: state.paused === true,
        controlPending: control.pending === true,
        controlMessage: control.message || "",
        selectedTab: Manager.sanitizeTab(state.selectedTab),
        showTabs: Manager.TABS.includes(screen),
        device: {...state.device, status: deviceStatus},
        headerSubtitle: state.device.available
            ? `${state.device.name} · ${runtimeStatusText(state)} · Updated ${formatRelativeTime(state.generatedAt, nowMs)}`
            : `${runtimeStatusText(state)} · ${healthOf(state).detail || state.device.reason} · Last update ${formatRelativeTime(state.generatedAt, nowMs)}`,
        panel: panelModel(state),
        metrics: metricModels(state),
        enabledGroups: groupProfiles(enabledProfiles),
        allGroups: groupProfiles(state.profiles),
        pausedProfiles,
        activeAlerts,
        resolvedAlerts,
        attentionCount: state.attentionCount,
        highestSeverity: highestActiveSeverity(state.alerts),
        highestSeverityText: severityText(highestActiveSeverity(state.alerts)),
        stale: state.stale,
        source: state.source,
        health: {...healthOf(state)},
        runtimeStatus: runtimeStatusText(state),
        recovery: recoveryModel(state),
        bodyKey: JSON.stringify({
            screen,
            profiles: state.profiles,
            alerts: activeAlerts.concat(resolvedAlerts),
            device: state.device,
            health: healthOf(state),
            paused: state.paused,
            control,
        }),
    };
}

module.exports = {
    ALERT_SEVERITY_PRIORITY,
    DEVICE_STATUS_LABELS,
    RUNTIME_RECOVERY,
    RUNTIME_STATUS_LABELS,
    SEVERITY_LABELS,
    STATUS_LABELS,
    alertModel,
    deviceStatusText,
    formatCount,
    recoveryModel,
    runtimeStatusText,
    attentionReviewText,
    compareActiveAlerts,
    effectiveScreen,
    formatFraction,
    formatLoad,
    formatRelativeTime,
    groupProfiles,
    highestActiveSeverity,
    metricModels,
    panelModel,
    severityText,
    toViewModel,
    unavailablePanel,
};
