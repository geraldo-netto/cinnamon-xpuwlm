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

function panelModel(state) {
    if (!state.device.available) {
        return {
            label: "TPU Offline",
            status: "unavailable",
            tooltip: `TPU Workload Manager — ${state.device.reason}`,
        };
    }
    if (state.paused) {
        return {
            label: "TPU Paused",
            status: "paused",
            tooltip: "TPU Workload Manager — all workloads paused",
        };
    }
    const load = formatLoad(state.metrics.load);
    return {
        label: `TPU ${load}`,
        status: state.attentionCount > 0 ? "attention" : "online",
        tooltip: state.attentionCount > 0
            ? `TPU Workload Manager — ${state.attentionCount} item needs review`
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
            : {label: "Attention", value: `${state.attentionCount}`, suffix: state.attentionCount === 1 ? "item" : "items", tone: state.attentionCount > 0 ? "attention" : "normal"},
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

function toViewModel(state, nowMs = Date.now()) {
    const screen = effectiveScreen(state);
    const enabledProfiles = state.profiles.filter((profile) => profile.enabled);
    const pausedProfiles = state.profiles.filter((profile) => !profile.enabled);
    const activeAlerts = state.alerts
        .filter((alert) => !alert.resolved)
        .map((alert) => alertModel(alert, state.profiles, nowMs));
    const resolvedAlerts = state.alerts
        .filter((alert) => alert.resolved)
        .map((alert) => alertModel(alert, state.profiles, nowMs));
    const deviceStatus = state.device.available ? "Online" : "Unavailable";
    return {
        screen,
        selectedTab: Manager.sanitizeTab(state.selectedTab),
        showTabs: screen !== "unavailable",
        device: {...state.device, status: deviceStatus},
        headerSubtitle: state.device.available
            ? `${state.device.name} · Balanced · Updated ${formatRelativeTime(state.generatedAt, nowMs)}`
            : `${state.device.reason} · Last update ${formatRelativeTime(state.generatedAt, nowMs)}`,
        panel: panelModel(state),
        metrics: metricModels(state),
        enabledGroups: groupProfiles(enabledProfiles),
        allGroups: groupProfiles(state.profiles),
        pausedProfiles,
        activeAlerts,
        resolvedAlerts,
        attentionCount: state.attentionCount,
        stale: state.stale,
        source: state.source,
        bodyKey: JSON.stringify({
            screen,
            profiles: state.profiles,
            alerts: state.alerts,
            device: state.device,
            paused: state.paused,
        }),
    };
}

module.exports = {
    STATUS_LABELS,
    alertModel,
    effectiveScreen,
    formatFraction,
    formatLoad,
    formatRelativeTime,
    groupProfiles,
    metricModels,
    panelModel,
    toViewModel,
};
