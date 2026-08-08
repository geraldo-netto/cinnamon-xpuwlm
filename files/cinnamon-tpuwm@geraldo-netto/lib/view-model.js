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

function panelModel(state) {
    if (!state.device.available) {
        return {
            accessibleName: `TPU Workload Manager, unavailable: ${state.device.reason}`,
            label: "TPU Offline",
            status: "unavailable",
            severity: null,
            tooltip: `TPU Workload Manager — ${state.device.reason}`,
        };
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
    const load = formatLoad(state.metrics.load);
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
        {label: "TPU load", value: state.paused ? "0%" : formatLoad(state.metrics.load)},
        {label: "Queue", value: `${state.metrics.queueDepth}`, suffix: state.paused ? "held" : "jobs"},
        {label: "Running", value: state.paused ? "0" : `${state.metrics.runningProfiles}`, suffix: "profiles"},
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
    const deviceStatus = state.device.available
        ? (state.source === "probe" ? "Device detected" : "Online")
        : "Unavailable";
    return {
        screen,
        policyPaused: state.paused === true,
        selectedTab: Manager.sanitizeTab(state.selectedTab),
        showTabs: Manager.TABS.includes(screen),
        device: {...state.device, status: deviceStatus},
        headerSubtitle: state.device.available
            ? `${state.device.name} · ${state.source === "probe" ? "Device-only monitoring" : "Runtime connected"} · Updated ${formatRelativeTime(state.generatedAt, nowMs)}`
            : `${state.device.reason} · Last update ${formatRelativeTime(state.generatedAt, nowMs)}`,
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
        bodyKey: JSON.stringify({
            screen,
            profiles: state.profiles,
            alerts: activeAlerts.concat(resolvedAlerts),
            device: state.device,
            paused: state.paused,
        }),
    };
}

module.exports = {
    ALERT_SEVERITY_PRIORITY,
    SEVERITY_LABELS,
    STATUS_LABELS,
    alertModel,
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
};
