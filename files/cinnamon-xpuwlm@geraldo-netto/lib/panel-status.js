"use strict";

// What the panel says, from what the snapshot reader saw.
//
// The helper's whole visible surface: an icon status, a label, a tooltip, an
// accessible name, and the handful of lines the popup lists above the button
// that opens the client. Everything that used to render here — workload
// screens, workflow forms, policy controls — moved to the Python client, so
// this file draws the answer to one question: is the accelerator working, and
// is anything waiting.

const I18n = require("./i18n.js");

const {_, N_, format, ngettext} = I18n;

// The five icons the payload ships; anything else falls back to unavailable
// rather than asking Cinnamon for a file that does not exist.
const PANEL_STATUSES = Object.freeze(["online", "attention", "detected", "paused", "unavailable"]);

const BACKEND_LABELS = Object.freeze({
    tpu: N_("TPU"),
    npu: N_("NPU"),
    gpu: N_("GPU"),
});

const RUNTIME_LABELS = Object.freeze({
    connected: N_("Online"),
    absent: N_("Runtime not running"),
    stale: N_("Runtime stale"),
    malformed: N_("Runtime malformed"),
    unreadable: N_("Runtime unreadable"),
});

function backendLabel(state) {
    const label = BACKEND_LABELS[state.backend];
    return label ? _(label) : _("Accel");
}

function runtimeLabel(state) {
    return _(RUNTIME_LABELS[state.runtime] || RUNTIME_LABELS.unreadable);
}

function formatLoad(value) {
    return typeof value === "number" && Number.isFinite(value) ? `${Math.round(value)}%` : "—";
}

function attentionText(count) {
    return format(ngettext("%d item needs review", "%d items need review", count), count);
}

function offlineModel(state) {
    const reason = state.detail || state.reason || runtimeLabel(state);
    return {
        status: "unavailable",
        label: _("Accel Offline"),
        tooltip: format(_("XPU Workload Manager — %s"), reason),
        accessibleName: format(_("XPU Workload Manager, unavailable: %s"), reason),
    };
}

function panelModel(state) {
    if (state.runtime !== "connected") {
        return offlineModel(state);
    }
    if (!state.available) {
        return {
            ...offlineModel(state),
            status: "detected",
            label: _("Accel Detected"),
        };
    }
    const load = formatLoad(state.load);
    if (state.attention > 0) {
        const review = attentionText(state.attention);
        return {
            status: "attention",
            label: `${backendLabel(state)} ${load} · ${review}`,
            tooltip: format(_("XPU Workload Manager — %s"), review),
            accessibleName: format(_("XPU Workload Manager, attention: %s"), review),
        };
    }
    return {
        status: "online",
        label: `${backendLabel(state)} ${load}`,
        tooltip: _("XPU Workload Manager — online"),
        accessibleName: format(_("XPU Workload Manager, online: %s load"), load),
    };
}

// The popup's read-only lines. Deliberately few: anything a person can act on
// belongs in the client, and a panel menu that grows controls is the thing
// this helper exists to stop.
function popupLines(state) {
    if (state.runtime !== "connected") {
        return [
            {label: _("Runtime"), value: runtimeLabel(state)},
            {label: _("Detail"), value: state.detail || _("No further detail")},
        ];
    }
    return [
        {label: _("Runtime"), value: runtimeLabel(state)},
        {
            label: _("Accelerator"),
            value: state.available
                ? format(_("%s at %s"), backendLabel(state), formatLoad(state.load))
                : _("No device available"),
        },
        {label: _("Queued"), value: String(state.queued)},
        {label: _("Running"), value: String(state.running)},
        {label: _("Needs review"), value: attentionText(state.attention)},
    ];
}

function panelIconName(status) {
    const safe = PANEL_STATUSES.includes(status) ? status : "unavailable";
    return `xpuwlm-status-${safe}-symbolic`;
}

module.exports = {
    BACKEND_LABELS,
    PANEL_STATUSES,
    RUNTIME_LABELS,
    attentionText,
    backendLabel,
    formatLoad,
    offlineModel,
    panelIconName,
    panelModel,
    popupLines,
    runtimeLabel,
};
