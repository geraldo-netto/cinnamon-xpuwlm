"use strict";

const I18n = require("./i18n.js");

const {_, N_, format, ngettext} = I18n;

const ALERT_SEVERITY_PRIORITY = Object.freeze({
    advisory: 0,
    warning: 1,
    critical: 2,
});

const SEVERITY_LABELS = Object.freeze({
    advisory: N_("advisory"),
    warning: N_("warning"),
    critical: N_("critical"),
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
        ? _("none")
        : _(SEVERITY_LABELS[severity] || "none");
}

const BACKEND_LABELS = Object.freeze({
    tpu: N_("TPU"),
    npu: N_("NPU"),
    gpu: N_("GPU"),
});

function backendLabel(device) {
    const label = device && BACKEND_LABELS[device.backend];
    return label ? _(label) : _("Accel");
}

const DEVICE_STATUS_LABELS = Object.freeze({
    present: N_("Device detected"),
    absent: N_("No device"),
    unknown: N_("Device unknown"),
});

const RUNTIME_STATUS_LABELS = Object.freeze({
    connected: N_("Online"),
    "not-started": N_("Starting"),
    absent: N_("Runtime absent"),
    stale: N_("Runtime stale"),
    malformed: N_("Runtime malformed"),
    unreadable: N_("Runtime unreadable"),
    "probe-failed": N_("Detection failed"),
});

function healthOf(state) {
    return state.health || {device: "unknown", runtime: "unreadable", detail: ""};
}

function deviceStatusText(state) {
    const health = healthOf(state);
    return health.runtime === "connected" && health.device === "present"
        ? _(RUNTIME_STATUS_LABELS.connected)
        : _(DEVICE_STATUS_LABELS[health.device] || DEVICE_STATUS_LABELS.unknown);
}

function runtimeStatusText(state) {
    const health = healthOf(state);
    return _(RUNTIME_STATUS_LABELS[health.runtime] || RUNTIME_STATUS_LABELS.unreadable);
}

function formatLoad(value) {
    return typeof value === "number" && Number.isFinite(value)
        ? `${Math.round(value)}%`
        : "—";
}

function attentionReviewText(count) {
    return format(ngettext("%d item needs review", "%d items need review", count), count);
}

function unavailablePanel(state) {
    const unknown = healthOf(state).device === "unknown";
    const reason = unknown
        ? format(_("%s; device state unknown"), runtimeStatusText(state).toLowerCase())
        : state.device.reason;
    return {
        accessibleName: unknown
            ? format(_("XPU Workload Manager, unknown: %s"), reason)
            : format(_("XPU Workload Manager, unavailable: %s"), reason),
        label: unknown ? _("Accel Unknown") : _("Accel Offline"),
        status: "unavailable",
        severity: null,
        tooltip: format(_("XPU Workload Manager — %s"), reason),
    };
}

function panelModel(state) {
    if (!state.device.available) {
        return unavailablePanel(state);
    }
    if (state.paused) {
        return {
            accessibleName: _("XPU Workload Manager, paused: all workloads paused"),
            label: _("Accel Paused"),
            status: "paused",
            severity: null,
            tooltip: _("XPU Workload Manager — all workloads paused"),
        };
    }
    if (state.source === "probe") {
        return {
            accessibleName: _("XPU Workload Manager, detected: hardware detected; runtime not connected"),
            label: format(_("%s Detected"), backendLabel(state.device)),
            status: "detected",
            severity: null,
            tooltip: _("XPU Workload Manager — hardware detected; runtime not connected"),
        };
    }
    const load = formatLoad(state.device.load);
    const attention = state.attentionCount > 0;
    const reviewText = attentionReviewText(state.attentionCount);
    const severity = highestActiveSeverity(state.alerts);
    const attentionText = format(_("%s, highest severity %s"), reviewText, severityText(severity));
    return {
        accessibleName: attention
            ? format(_("XPU Workload Manager, attention: %s"), attentionText)
            : format(_("XPU Workload Manager, online: %s load"), load),
        label: attention
            ? `${backendLabel(state.device)} ${load} · ${severityText(severity)}`
            : `${backendLabel(state.device)} ${load}`,
        status: attention ? "attention" : "online",
        severity,
        tooltip: attention
            ? format(_("XPU Workload Manager — %s"), attentionText)
            : _("XPU Workload Manager — online"),
    };
}

module.exports = {
    ALERT_SEVERITY_PRIORITY,
    BACKEND_LABELS,
    DEVICE_STATUS_LABELS,
    RUNTIME_STATUS_LABELS,
    SEVERITY_LABELS,
    attentionReviewText,
    backendLabel,
    deviceStatusText,
    formatLoad,
    healthOf,
    highestActiveSeverity,
    panelModel,
    runtimeStatusText,
    severityText,
    unavailablePanel,
};
