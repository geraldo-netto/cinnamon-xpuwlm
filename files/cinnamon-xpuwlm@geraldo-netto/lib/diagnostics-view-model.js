"use strict";

const I18n = require("./i18n.js");
const Panel = require("./panel-view-model.js");

const {_, format, ngettext} = I18n;
const {backendLabel, deviceStatusText, healthOf, runtimeStatusText} = Panel;

function formatRelativeTime(timestamp, nowMs) {
    if (!Number.isFinite(timestamp) || timestamp <= 0) {
        return _("unknown");
    }
    const seconds = Math.max(0, Math.floor((nowMs - timestamp) / 1000));
    if (seconds < 5) {
        return _("just now");
    }
    if (seconds < 60) {
        return format(_("%ds ago"), seconds);
    }
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) {
        return format(_("%dm ago"), minutes);
    }
    const hours = Math.floor(minutes / 60);
    return format(_("%dh ago"), hours);
}

function workloadServiceStatus(control) {
    if (control.available === true) {
        return {status: _("Ready"), tone: "healthy", detail: _("Runtime controls are available")};
    }
    if (control.available === false) {
        return {status: _("Unavailable"), tone: "unavailable", detail: _("Runtime controls are unavailable")};
    }
    return {status: _("Unknown"), tone: "watching", detail: _("Runtime control state is not known")};
}

function diagnosticsReport(state, tools, activity, setup, control, nowMs) {
    const service = workloadServiceStatus(control);
    const setupCount = tools.filter((tool) => !tool.available).length
        + setup.sections.reduce((count, section) => count + section.profiles.length, 0);
    return [
        _("XPU Workload Manager diagnostics"),
        `${_("Generated")}: ${new Date(nowMs).toISOString()}`,
        `${_("Device")}: ${deviceStatusText(state)} — ${state.device.name || state.device.reason || _("Unknown")}`,
        `${_("Runtime")}: ${runtimeStatusText(state)} — ${healthOf(state).detail || _("No additional detail")}`,
        `${_("Workload service")}: ${service.status} — ${service.detail}`,
        `${_("Ready tools")}: ${tools.filter((tool) => tool.available).length}/${tools.length}`,
        `${_("Active jobs")}: ${activity.activeCount}`,
        `${_("Needs setup")}: ${setupCount}`,
        `${_("Recent issues")}: ${state.attentionCount}`,
        // A report that omits the local record cannot answer "was anything
        // being kept?", which is the first question asked of one.
        `${_("Local load record")}: ${telemetryHealth(state.telemetry).status}`,
        `${_("Last update")}: ${formatRelativeTime(state.generatedAt, nowMs)}`,
    ].join("\n");
}

// The local load record is off until the user turns it on, so its row states
// what is kept rather than only whether it is running: a record nobody asked
// for is the thing worth being explicit about.
function telemetryHealth(telemetry) {
    const summary = telemetry && typeof telemetry === "object"
        ? telemetry
        : {consented: false, samples: 0, gaps: 0, retentionMs: 0};
    if (summary.consented !== true) {
        return {
            id: "telemetry",
            icon: "utilities-system-monitor-symbolic",
            title: _("Local load record"),
            detail: _("Off. No load figures are being kept."),
            status: _("Off"),
            tone: "healthy",
        };
    }
    const minutes = Math.round(summary.retentionMs / 60000);
    return {
        id: "telemetry",
        icon: "utilities-system-monitor-symbolic",
        title: _("Local load record"),
        detail: format(
            ngettext(
                "Load, queue depth, and running profiles, kept in memory for %d minute.",
                "Load, queue depth, and running profiles, kept in memory for %d minutes.",
                minutes,
            ),
            minutes,
        ),
        status: format(
            ngettext("%d reading", "%d readings", summary.samples),
            summary.samples,
        ),
        tone: summary.gaps > 0 ? "attention" : "healthy",
    };
}

function diagnosticsModel(state, tools, activity, setup, activeAlerts, control, nowMs) {
    const service = workloadServiceStatus(control);
    const toolSetup = tools.filter((tool) => !tool.available).map((tool) => ({
        id: tool.id,
        title: tool.title,
        detail: tool.setupDetail || _("Required service or input is unavailable"),
        status: _("Unavailable"),
        tone: "unavailable",
    }));
    const profileSetupCount = setup.sections.reduce(
        (count, section) => count + section.profiles.length,
        0,
    );
    const setupCount = toolSetup.length + profileSetupCount;
    return {
        health: [
            {
                id: "device",
                icon: "xpuwlm-device-symbolic",
                title: _("Device"),
                detail: state.device.name || state.device.reason || _("No device detail"),
                status: deviceStatusText(state),
                tone: state.device.available ? "healthy" : "unavailable",
            },
            {
                id: "runtime",
                icon: "drive-multidisk-symbolic",
                title: _("Local runtime"),
                detail: healthOf(state).detail || _("Snapshot contract is readable"),
                status: runtimeStatusText(state),
                tone: healthOf(state).runtime === "connected" ? "healthy" : "unavailable",
            },
            {
                id: "service",
                icon: "system-run-symbolic",
                title: _("Workload service"),
                detail: service.detail,
                status: service.status,
                tone: service.tone,
            },
            telemetryHealth(state.telemetry),
        ],
        toolSetup,
        profileSetupCount,
        setupCount,
        setupStatus: setupCount === 0 ? _("Ready") : format(_("%d needs setup"), setupCount),
        setupSummary: setupCount === 0
            ? _("Tools and workload profiles are ready")
            : format(
                ngettext("%d tool or profile needs attention", "%d tools or profiles need attention", setupCount),
                setupCount,
            ),
        current: [
            {label: _("Ready tools"), value: `${tools.filter((tool) => tool.available).length}`},
            {label: _("Active jobs"), value: `${activity.activeCount}`},
            {label: _("Last update"), value: formatRelativeTime(state.generatedAt, nowMs)},
        ],
        issues: activeAlerts,
        report: diagnosticsReport(state, tools, activity, setup, control, nowMs),
    };
}

function systemDeviceStatus(state) {
    if (state.device.available) {
        return {
            detail: _("Ready for workloads"),
            status: _("Ready"),
            tone: "healthy",
        };
    }
    return {
        detail: state.device.reason || format(_("%s accelerator"), backendLabel(state.device)),
        status: deviceStatusText(state),
        tone: "unavailable",
    };
}

function systemRuntimeStatus(state) {
    const health = healthOf(state);
    if (health.runtime === "connected") {
        return {
            detail: _("Models and services available"),
            status: _("Ready"),
            tone: "healthy",
        };
    }
    return {
        detail: health.detail || _("Runtime snapshot monitoring"),
        status: runtimeStatusText(state),
        tone: "unavailable",
    };
}

function systemModel(state) {
    return {
        statuses: [
            {
                id: "device",
                icon: "xpuwlm-device-symbolic",
                title: state.device.name || _("Accelerator"),
                ...systemDeviceStatus(state),
            },
            {
                id: "runtime",
                icon: "drive-multidisk-symbolic",
                title: _("Local runtime"),
                ...systemRuntimeStatus(state),
            },
        ],
    };
}

module.exports = {
    diagnosticsModel,
    telemetryHealth,
    diagnosticsReport,
    formatRelativeTime,
    systemModel,
    workloadServiceStatus,
};
