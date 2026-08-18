"use strict";

// What the panel says, from what the snapshot reader saw.
//
// The helper's whole visible surface: an icon status, a tooltip, an accessible
// name, and the handful of lines the popup lists above the button that opens
// the client. No panel text: the icon is the status, and a word beside it in
// the tray repeats what the shape and colour already said. Everything that used to render here — workload
// screens, workflow forms, policy controls — moved to the Python client, so
// this file draws the answer to one question: is the runtime working, and is
// anything waiting.
//
// Deliberately not a load meter. The panel used to carry the accelerator's
// instantaneous busy percentage, which is the least informative number about
// it: one read of a figure that moves constantly says whether the device was
// busy at that instant, not whether it is busy. The client's Health page shows
// the ninetieth percentile over the last minute, which is the honest form of
// that question, and a second, worse copy of it in the tray is not worth the
// pixels or the poll.

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

// A held runtime is connected — it is publishing, and it answers — so the
// hold is what the line reports rather than a sixth runtime word.
const PAUSED_LABEL = N_("Paused");

function runtimeLabel(state) {
    if (state.runtime === "connected" && state.paused) {
        return _(PAUSED_LABEL);
    }
    return _(RUNTIME_LABELS[state.runtime] || RUNTIME_LABELS.unreadable);
}

// Every workload held, which the runtime publishes as policy rather than a
// client keeping its own copy. The backlog goes with it: a hold with work
// waiting behind it is a different fact from a hold with nothing to do.
function pausedText(state) {
    if (state.queued > 0) {
        return format(
            ngettext("paused, %d queued", "paused, %d queued", state.queued),
            state.queued,
        );
    }
    return _("paused");
}

function attentionText(count) {
    return format(ngettext("%d item needs review", "%d items need review", count), count);
}

function workText(state) {
    if (state.running > 0) {
        return format(ngettext("%d running", "%d running", state.running), state.running);
    }
    if (state.queued > 0) {
        return format(ngettext("%d queued", "%d queued", state.queued), state.queued);
    }
    return _("Ready");
}

function offlineModel(state) {
    const reason = state.detail || state.reason || runtimeLabel(state);
    return {
        status: "unavailable",
        tooltip: format(_("XPU Workload Manager — %s"), reason),
        accessibleName: format(_("XPU Workload Manager, unavailable: %s"), reason),
    };
}

function panelModel(state) {
    if (state.runtime !== "connected") {
        return offlineModel(state);
    }
    if (!state.available) {
        return {...offlineModel(state), status: "detected"};
    }
    const work = workText(state);
    if (state.attention > 0) {
        const review = attentionText(state.attention);
        return {
            status: "attention",
            tooltip: format(_("XPU Workload Manager — %s"), review),
            accessibleName: format(_("XPU Workload Manager, attention: %s"), review),
        };
    }
    // Below attention: something waiting for a person outranks a hold the
    // person put there deliberately.
    if (state.paused) {
        const held = pausedText(state);
        return {
            status: "paused",
            tooltip: format(_("XPU Workload Manager — %s"), held),
            accessibleName: format(_("XPU Workload Manager, %s"), held),
        };
    }
    return {
        status: "online",
        tooltip: format(_("XPU Workload Manager — online, %s"), work.toLowerCase()),
        accessibleName: format(_("XPU Workload Manager, online: %s"), work.toLowerCase()),
    };
}

// The most lines any state can produce. The popup's items are built once and
// reused, so the pool is sized from this rather than from a number written out
// again in the applet: a line beyond the pool would be computed, formatted and
// then silently dropped.
const MAX_POPUP_LINES = 5;

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
            value: state.available ? backendLabel(state) : _("No device available"),
        },
        {label: _("Queued"), value: String(state.queued)},
        {label: _("Running"), value: String(state.running)},
        {
            // "Needs review: 0 items need review" says the label twice and the
            // number once; nothing to review is worth one word.
            label: _("Needs review"),
            value: state.attention > 0 ? attentionText(state.attention) : _("Nothing"),
        },
    ];
}

function panelIconName(status) {
    const safe = PANEL_STATUSES.includes(status) ? status : "unavailable";
    return `xpuwlm-status-${safe}-symbolic`;
}

module.exports = {
    BACKEND_LABELS,
    MAX_POPUP_LINES,
    PAUSED_LABEL,
    PANEL_STATUSES,
    RUNTIME_LABELS,
    attentionText,
    backendLabel,
    offlineModel,
    panelIconName,
    panelModel,
    pausedText,
    popupLines,
    runtimeLabel,
    workText,
};
