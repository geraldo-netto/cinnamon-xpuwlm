"use strict";

const Domain = require("./domain.js");
const I18n = require("./i18n.js");
const Manager = require("./manager.js");
const ProfileBlockers = require("./profile-blockers.js");
const WorkflowViewModel = require("./workflow-view-model.js");

const {_, N_, format, ngettext} = I18n;
const {
    JOB_STATE_LABELS,
    MAX_READING_ROWS,
    MAX_RUN_PICTURES,
    TOOL_SPECS,
    activityModel,
    canServe,
    documentCitationText,
    documentQuestionModel,
    eventCandidateModel,
    eventImportModel,
    evidenceText,
    fileOrganizerModel,
    forecastReadingText,
    jobActivity,
    jobModel,
    mediaResultModel,
    mediaSpeechModel,
    mediaTranscriptionModel,
    mediaVisualModel,
    mediaWorkflowVisible,
    omittedCount,
    organizerEvidenceText,
    progressText,
    readingModel,
    runModel,
    runReason,
    selectedTextModel,
    toolModels,
    usesLegacyPictureReadiness,
    workflowActivity,
} = WorkflowViewModel;

const STATUS_LABELS = Object.freeze({
    healthy: N_("Healthy"),
    running: N_("Running"),
    watching: N_("Watching"),
    idle: N_("Idle"),
    paused: N_("Paused"),
    unavailable: N_("Unavailable"),
});

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

// Specific telemetry and recovery guidance per runtime state. Nothing here
// invents an operational value: what is unknown is presented as unknown.
const RUNTIME_RECOVERY = Object.freeze({
    "not-started": Object.freeze({
        kicker: N_("Starting"),
        title: N_("Monitoring has not started"),
        description: N_("No runtime state has been read yet. Local profile intent is unchanged."),
        steps: Object.freeze([
            Object.freeze(["1", N_("Wait for the first read"), N_("Monitoring starts with the applet and repeats on the refresh interval.")]),
            Object.freeze(["2", N_("Check the runtime path"), N_("Open the settings and confirm the runtime state path.")]),
        ]),
    }),
    absent: Object.freeze({
        kicker: N_("Runtime absent"),
        title: N_("No runtime service is publishing state"),
        description: N_("Device detection still works. Queue, load, and profile telemetry stay unknown until a runtime publishes a snapshot."),
        steps: Object.freeze([
            Object.freeze(["1", N_("Start the workload runtime"), N_("A trusted local service must publish the snapshot document.")]),
            Object.freeze(["2", N_("Check the runtime path"), N_("Confirm the configured runtime state path matches the service.")]),
        ]),
    }),
    stale: Object.freeze({
        kicker: N_("Runtime stale"),
        title: N_("The runtime snapshot stopped updating"),
        description: N_("The last snapshot is older than its freshness deadline, so its values are no longer shown as current."),
        steps: Object.freeze([
            Object.freeze(["1", N_("Check the runtime service"), N_("Confirm the service is running and still writing its snapshot.")]),
            Object.freeze(["2", N_("Check the clock"), N_("A large clock change can also age a snapshot past its deadline.")]),
        ]),
    }),
    malformed: Object.freeze({
        kicker: N_("Runtime malformed"),
        title: N_("The runtime snapshot failed validation"),
        description: N_("The document was read but rejected by the version 1 contract, so none of its values are displayed."),
        steps: Object.freeze([
            Object.freeze(["1", N_("Check the runtime version"), N_("The service must publish the version 1 snapshot contract.")]),
            Object.freeze(["2", N_("Inspect the document"), N_("Validate it against runtime-snapshot.schema.json.")]),
        ]),
    }),
    unreadable: Object.freeze({
        kicker: N_("Runtime unreadable"),
        title: N_("The runtime snapshot could not be read"),
        description: N_("Reading the snapshot failed, so device and workload telemetry are unknown rather than assumed."),
        steps: Object.freeze([
            Object.freeze(["1", N_("Check permissions"), N_("Confirm the current user can read the runtime state path.")]),
            Object.freeze(["2", N_("Check the path"), N_("A missing directory or a replaced path object also fails the read.")]),
        ]),
    }),
    "probe-failed": Object.freeze({
        kicker: N_("Detection failed"),
        title: N_("Accelerator discovery failed"),
        description: N_("Local discovery could not complete, so device presence is unknown rather than reported as absent."),
        steps: Object.freeze([
            Object.freeze(["1", N_("Check device access"), N_("Confirm the current user can read the USB, PCIe, accel, and render device nodes.")]),
            Object.freeze(["2", N_("Retry detection"), N_("Discovery runs again on request.")]),
        ]),
    }),
    connected: Object.freeze({
        kicker: N_("Connection required"),
        title: N_("No accelerator available"),
        description: N_("Profiles remain saved locally. No data, authorization, or backup policy is changed."),
        steps: Object.freeze([
            Object.freeze(["1", N_("Check the connection"), N_("Connect a supported TPU, NPU, or GPU accelerator.")]),
            Object.freeze(["2", N_("Check device access"), N_("Confirm the current user can access the accelerator runtime.")]),
        ]),
    }),
});

// Catalog changes are reported as words, in a fixed order, never as a colour
// or a badge alone: the user has to be able to read which plug-ins the applet
// picked up, upgraded, or dropped.
const CATALOG_CHANGE_KINDS = Object.freeze(["installed", "upgraded", "removed"]);

const CATALOG_CHANGE_LABELS = Object.freeze({
    installed: N_("Installed"),
    upgraded: N_("Upgraded"),
    removed: N_("Removed"),
});

function formatCount(value) {
    return Number.isFinite(value) ? `${value}` : "—";
}

// A removed plug-in is no longer in the catalog, so only its identifier
// survives; a present one is named with the title the user already sees.
function catalogEntryName(profiles, id) {
    const profile = profiles.find((candidate) => candidate.id === id);
    return profile ? profile.title : id;
}

function catalogChangeGroups(state) {
    const changes = state.catalogChanges || {};
    const groups = [];
    for (const kind of CATALOG_CHANGE_KINDS) {
        const identifiers = Array.isArray(changes[kind]) ? changes[kind] : [];
        if (identifiers.length > 0) {
            groups.push({
                kind,
                label: _(CATALOG_CHANGE_LABELS[kind]),
                names: identifiers.map((id) => catalogEntryName(state.profiles, id)),
            });
        }
    }
    return groups;
}

// Reconciliation used to compute plug-in installs, upgrades, and removals and
// then discard them. The popup states what changed until the user
// acknowledges it: a catalog that changes silently cannot be audited.
function catalogNoticeModel(state) {
    const groups = catalogChangeGroups(state);
    if (groups.length === 0) {
        return null;
    }
    const count = groups.reduce((total, group) => total + group.names.length, 0);
    const detail = groups
        .map((group) => format(_("%s: %s"), group.label, group.names.join(", ")))
        .join(" · ");
    return {
        title: format(
            ngettext("%d workload plug-in changed", "%d workload plug-ins changed", count),
            count,
        ),
        detail,
        dismissLabel: _("Dismiss"),
        accessibleName: format(_("Workload catalog changed: %s"), detail),
    };
}

// The runtime can publish profiles and alerts for plug-ins this applet does
// not ship. They are dropped, because the applet has no title, icon, or
// description to render them with, but the drop is stated rather than silent:
// a disagreement between the two catalogs is exactly what the user needs to
// know when an expected alert never appears.
function unknownContentNotice(state) {
    const unknown = state.unknownContent || {profiles: 0, alerts: 0};
    const total = unknown.profiles + unknown.alerts;
    if (total === 0) {
        return null;
    }
    const title = format(
        ngettext(
            "%d runtime item names a workload that is not installed here",
            "%d runtime items name workloads that are not installed here",
            total,
        ),
        total,
    );
    const detail = format(
        _("Not shown: %d profile update(s), %d alert(s). Install the missing workload plug-in to see them."),
        unknown.profiles,
        unknown.alerts,
    );
    return {title, detail, accessibleName: `${title}. ${detail}`};
}

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

function recoveryModel(state) {
    const health = healthOf(state);
    const guidance = RUNTIME_RECOVERY[health.runtime] || RUNTIME_RECOVERY.connected;
    const detail = health.detail || state.device.reason;
    return {
        kicker: _(guidance.kicker),
        title: _(guidance.title),
        description: _(guidance.description),
        steps: guidance.steps
            .map(([number, title, description]) => ({
                number,
                title: _(title),
                description: _(description),
            }))
            .concat({
                number: `${guidance.steps.length + 1}`,
                title: _("Retry now"),
                description: detail,
            }),
    };
}

// Diagnostics setup detail is organised by remedy, not by profile, because one package or
// one artifact usually unblocks several profiles at once. A missing declared
// artifact, a supported local training recipe, and a profile with no qualified
// model are different states: only the first two have honest commands. Every
// string here is the applet's own; the runtime's words are repeated per profile
// beside them.
// Consent first: it is the only one a person can act on in seconds, and it
// needs no install, no hardware, and no download.
const LOCAL_FORECAST_PROFILE = "resource-scheduler";
const SETUP_KIND_ORDER = Object.freeze([
    "consent", "runtime", "forecast", "model", "model-design", "hardware", "unknown",
]);

const SETUP_SECTIONS = Object.freeze({
    runtime: Object.freeze({
        title: N_("Install the accelerator runtime"),
        description: N_("The accelerator is present, but the Python package that drives it cannot be imported, so the runtime has no lane to run these profiles on. Install the matching extra and restart the service."),
        command: N_("pip install 'omnitensor[gpu]'"),
        note: N_("Which extra depends on the accelerator: see the Dependencies table in the OmniTensor installation guide."),
    }),
    model: Object.freeze({
        title: N_("Repair the declared model installation"),
        description: N_("These profiles declare a model, but its artifact is missing or its format cannot run on the selected accelerator. Restore the exact declared artifact, or qualify a compatible variant without changing its meaning."),
        command: N_("omnitensor-prepare-artifact <model> --id <id> --version <v> --format <declared-format> --install-root ~/.local/share/omnitensor/artifacts"),
        note: N_("Preparing an exact declared artifact repairs artifact-unavailable. A format-unsupported profile needs a qualified compatible variant and matching manifest contract; arbitrary weights are never a remedy."),
    }),
    forecast: Object.freeze({
        title: N_("Train a local Resource Scheduler forecast"),
        description: N_("Resource Scheduler has no bundled weights, but OmniTensor supports one opt-in self-supervised forecast recipe for it. Record representative real queue history first; never substitute synthetic samples."),
        command: N_("omnitensor-record-runtime-snapshot --profile resource-scheduler --selector queueDepth --selector runningProfiles"),
        note: N_("After enough history, use omnitensor-train-model with queueDepth first, install the restricted binding with omnitensor-install-trained-model, restart omnitensor.service, then run omnitensor-run-forecast. Follow “Local model training” in OmniTensor; no recorder timer is enabled automatically."),
    }),
    "model-design": Object.freeze({
        title: N_("No qualified model is available"),
        description: N_("These profiles do not declare a model or a supported training recipe. No generic install command can invent their task semantics, representative data, metrics, preprocessing, output consumer, or acceptance evidence."),
        command: "",
        note: N_("Track each profile's model work in OmniTensor. Do not attach arbitrary weights or reuse Resource Scheduler's scalar forecast recipe for a different task."),
    }),
    consent: Object.freeze({
        title: N_("Grant the permission these profiles ask for"),
        description: N_("These profiles declare a permission that has not been granted, so the runtime refuses every job they submit. Nothing is missing and nothing is broken \u2014 a person has to say yes. The profile's status line names the permission it is waiting on."),
        command: N_("omnitensor-grant grant <profile> <permission> --reason \"why you are allowing it\""),
        note: N_("Consent is granted from a terminal rather than from this popup: every peer on the session bus runs as the same user, so the runtime could not tell a request made here from one made by anything else able to talk to it. Withdraw it again with omnitensor-grant revoke."),
    }),
    hardware: Object.freeze({
        title: N_("Connect supported hardware"),
        description: N_("No accelerator these profiles can use is attached to this machine. There is nothing to install: they stay unavailable until supported hardware is present."),
        command: "",
        note: "",
    }),
    unknown: Object.freeze({
        title: N_("Reported by the runtime"),
        description: N_("The runtime refused these profiles for a reason this applet does not recognise, so its own words are repeated below without interpretation."),
        command: "",
        note: "",
    }),
});

function setupSection(kind, members) {
    const copy = SETUP_SECTIONS[kind] || SETUP_SECTIONS.unknown;
    return {
        kind,
        title: _(copy.title),
        description: _(copy.description),
        command: copy.command === "" ? "" : _(copy.command),
        note: copy.note === "" ? "" : _(copy.note),
        profiles: members.map((profile) => ({
            id: profile.id,
            title: profile.title,
            reason: profile.blocker.reason,
        })),
    };
}

function setupKind(profile) {
    if (profile.blocker.kind !== "model") {
        return profile.blocker.kind;
    }
    const detail = typeof profile.blocker.detail === "string" ? profile.blocker.detail : "";
    const noReasonCode = typeof profile.reason !== "string" || profile.reason === "";
    const modelIsUndeclared = profile.reason === "no-model"
        || (noReasonCode && ProfileBlockers.mentions(detail, ProfileBlockers.MODEL_REASONS));
    if (!modelIsUndeclared) {
        return "model";
    }
    return profile.id === LOCAL_FORECAST_PROFILE ? "forecast" : "model-design";
}

function setupSummary(total, runnable) {
    if (total === 0) {
        return _("No workload profiles are installed.");
    }
    return format(
        ngettext(
            "%d of %d workload profile can run on this machine",
            "%d of %d workload profiles can run on this machine",
            total,
        ),
        runnable,
        total,
    );
}

// Useful when nothing is wrong, too: a screen that renders empty on a healthy
// host reads as broken rather than as finished.
function setupModel(profiles) {
    const blocked = profiles.filter((profile) => profile.blocker !== null);
    const sections = SETUP_KIND_ORDER
        .map((kind) => [kind, blocked.filter((profile) => setupKind(profile) === kind)])
        .filter(([, members]) => members.length > 0)
        .map(([kind, members]) => setupSection(kind, members));
    return {
        resolved: blocked.length === 0,
        title: blocked.length === 0 ? _("Nothing is missing") : _("What these profiles need"),
        summary: setupSummary(profiles.length, profiles.length - blocked.length),
        sections,
    };
}

// The run surface: which profiles a picture can be prepared for, which
// pictures the runtime is allowed to read, and what happened to the last job.
// Everything it needs is already published — the roots come from the runtime's
// own snapshot and the contracts from the manifests — so nothing here guesses
// a path or a normalisation.

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
        `${_("Last update")}: ${formatRelativeTime(state.generatedAt, nowMs)}`,
    ].join("\n");
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

// Everything the runtime holds that this surface is not showing: what the
// catalog left out, plus what this projection itself trims.

function formatLoad(value) {
    return typeof value === "number" && Number.isFinite(value)
        ? `${Math.round(value)}%`
        : "—";
}

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

function formatFraction(value) {
    return typeof value === "number" && Number.isFinite(value)
        ? `${Math.round(value * 100)}%`
        : "—";
}

// Most of the bundled workloads cannot run, but not for the same reason and
// not with the same remedy: one needs an artifact installed, one needs a Python
// package, and one needs hardware that cannot be installed at all. A single
// sentence for all three sent the user looking for a fix that, in the hardware
// case, does not exist. Each profile therefore names its own reason in words,
// and every reason points at Diagnostics where the remedy is written out.
const BLOCKER_REASONS = Object.freeze({
    model: N_("No model installed"),
    runtime: N_("Accelerator runtime not installed"),
    hardware: N_("No supported accelerator present"),
    unknown: N_("The runtime cannot run this profile"),
});

// A reason this applet does not recognise is repeated exactly as the runtime
// published it. Guessing a category for it would be worse than quoting it.
const NO_BLOCKER_DETAIL_TEXT = N_("the runtime gave no reason");

const NEEDS_SETUP_TITLE = N_("Needs setup");

function blockerReasonText(blocker) {
    if (blocker.kind !== "unknown") {
        return _(BLOCKER_REASONS[blocker.kind] || BLOCKER_REASONS.unknown);
    }
    return blocker.detail || _(NO_BLOCKER_DETAIL_TEXT);
}

function blockerModel(blocker) {
    if (blocker === null) {
        return null;
    }
    const reason = blockerReasonText(blocker);
    return {
        kind: blocker.kind,
        detail: blocker.detail,
        reason,
        text: format(_("%s · see Diagnostics"), reason),
    };
}

function profileModel(profile) {
    const blocker = blockerModel(ProfileBlockers.classifyProfileBlocker(profile));
    return {
        ...profile,
        executable: blocker === null,
        blocker,
        executableText: blocker === null ? "" : blocker.text,
    };
}

function groupModels(models) {
    const groups = [];
    const byName = new Map();
    for (const model of models) {
        if (!byName.has(model.group)) {
            const group = {name: model.group, profiles: []};
            groups.push(group);
            byName.set(model.group, group);
        }
        byName.get(model.group).profiles.push(model);
    }
    return groups;
}

function groupProfiles(profiles) {
    return groupModels(profiles.map(profileModel));
}

function inexecutableCount(profiles) {
    return profiles.filter(
        (profile) => ProfileBlockers.classifyProfileBlocker(profile) !== null,
    ).length;
}

// One collapsed group, not one per reason: the group exists to get profiles
// that cannot run out of the way, and it shrinks by itself as models and
// runtimes are installed. Its own count is derived, never assumed, so a host
// where more or fewer profiles run describes itself correctly.
function blockedGroupModel(blocked) {
    const count = blocked.length;
    if (count === 0) {
        return null;
    }
    return {
        count,
        title: _(NEEDS_SETUP_TITLE),
        label: format(_("%s (%d)"), _(NEEDS_SETUP_TITLE), count),
        summary: format(
            ngettext("%d profile cannot run yet", "%d profiles cannot run yet", count),
            count,
        ),
        collapsedName: format(
            ngettext(
                "Needs setup, %d profile, collapsed",
                "Needs setup, %d profiles, collapsed",
                count,
            ),
            count,
        ),
        expandedName: format(
            ngettext(
                "Needs setup, %d profile, expanded",
                "Needs setup, %d profiles, expanded",
                count,
            ),
            count,
        ),
    };
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
        {label: format(_("%s load"), backendLabel(state.device)), value: state.paused ? "0%" : formatLoad(state.device.load)},
        {label: _("Queue"), value: formatCount(state.metrics.queueDepth), suffix: state.paused ? _("held") : _("jobs")},
        {label: _("Running"), value: state.paused ? "0" : formatCount(state.metrics.runningProfiles), suffix: _("profiles")},
        state.paused
            ? {label: _("State"), value: _("Paused"), tone: "attention"}
            : {
                label: _("Attention"),
                value: `${state.attentionCount}`,
                suffix: state.attentionCount > 0
                    ? `${ngettext("item", "items", state.attentionCount)} · ${severityText(highestActiveSeverity(state.alerts))}`
                    : _("items"),
                tone: state.attentionCount > 0 ? "attention" : "normal",
            },
    ];
}

function compareDevices(rank, left, right) {
    const byBackend = (rank.get(left.backend) ?? rank.size) - (rank.get(right.backend) ?? rank.size);
    if (byBackend !== 0) {
        return byBackend;
    }
    return left.id < right.id ? -1 : 1;
}

function deviceModels(state) {
    const devices = Array.isArray(state.devices) ? state.devices : [];
    const rank = new Map(Domain.BACKENDS.map((backend, index) => [backend, index]));
    return [...devices]
        .sort((left, right) => compareDevices(rank, left, right))
        .map((device) => ({
            id: device.id,
            name: device.name,
            backendText: backendLabel(device),
            statusText: device.available ? _("Available") : _("Absent"),
            loadText: device.available ? formatLoad(device.load) : "—",
            available: device.available === true,
            vendor: device.vendor || "",
        }));
}

function alertModel(alert, profiles, nowMs) {
    const profile = profiles.find((candidate) => candidate.id === alert.profileId);
    return {
        ...alert,
        profileTitle: profile ? profile.title : _("Unknown profile"),
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
    const profiles = state.profiles.map(profileModel);
    const blocked = profiles.filter((profile) => profile.blocker !== null);
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
    const workflows = {
        eventImport: eventImportModel(state),
        documentQuestion: documentQuestionModel(state),
        selectedText: selectedTextModel(state),
        fileOrganizer: fileOrganizerModel(state),
        mediaTranscription: mediaTranscriptionModel(state),
    };
    const run = runModel(state);
    const tools = toolModels(state, workflows, run);
    const activity = activityModel(state, workflows, run);
    const setup = setupModel(profiles);
    const diagnostics = diagnosticsModel(
        state, tools, activity, setup, activeAlerts, control, nowMs,
    );
    return {
        screen,
        policyPaused: state.paused === true,
        controlPending: control.pending === true,
        controlMessage: control.message || "",
        selectedTab: Manager.sanitizeTab(state.selectedTab),
        showTabs: Manager.TABS.includes(screen),
        device: {...state.device, status: deviceStatus},
        devices: deviceModels(state),
        headerSubtitle: state.device.available
            ? [
                state.device.name,
                healthOf(state).runtime === "connected" ? "" : runtimeStatusText(state),
                format(
                    ngettext("%d tool ready", "%d tools ready", tools.filter((tool) => tool.available).length),
                    tools.filter((tool) => tool.available).length,
                ),
                activity.activeCount === 0
                    ? _("No active jobs")
                    : format(ngettext("%d active job", "%d active jobs", activity.activeCount), activity.activeCount),
            ].filter(Boolean).join(" · ")
            : `${runtimeStatusText(state)} · ${healthOf(state).detail || state.device.reason} · ${format(_("Last update %s"), formatRelativeTime(state.generatedAt, nowMs))}`,
        panel: panelModel(state),
        catalogNotice: catalogNoticeModel(state),
        unknownContent: unknownContentNotice(state),
        metrics: metricModels(state),
        enabledGroups: groupProfiles(enabledProfiles),
        allGroups: groupModels(profiles),
        runnableGroups: groupModels(profiles.filter((profile) => profile.blocker === null)),
        blockedProfiles: blocked,
        blockedGroup: blockedGroupModel(blocked),
        setup,
        run,
        eventImport: workflows.eventImport,
        documentQuestion: workflows.documentQuestion,
        selectedText: workflows.selectedText,
        fileOrganizer: workflows.fileOrganizer,
        mediaTranscription: workflows.mediaTranscription,
        tools,
        activity,
        system: systemModel(state),
        diagnostics,
        inexecutableCount: blocked.length,
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
            unknownContent: state.unknownContent,
            profiles: state.profiles,
            alerts: activeAlerts.concat(resolvedAlerts),
            device: state.device,
            devices: state.devices,
            health: healthOf(state),
            metrics: state.metrics,
            generatedAt: state.generatedAt,
            paused: state.paused,
            control,
            // The run surface changes without the snapshot changing: a job
            // acknowledgement and a newly listed picture are both invisible to
            // every other key here, so a body keyed without them would show the
            // outcome of the click before last.
            job: state.job,
            inputs: state.inputs,
            eventImport: state.eventImport,
            documentQuestion: state.documentQuestion,
            selectedText: state.selectedText,
            fileOrganizer: state.fileOrganizer,
            mediaTranscription: state.mediaTranscription,
        }),
    };
}

module.exports = {
    ALERT_SEVERITY_PRIORITY,
    BLOCKER_REASONS,
    CATALOG_CHANGE_KINDS,
    CATALOG_CHANGE_LABELS,
    DEVICE_STATUS_LABELS,
    NEEDS_SETUP_TITLE,
    NO_BLOCKER_DETAIL_TEXT,
    RUNTIME_RECOVERY,
    RUNTIME_STATUS_LABELS,
    SETUP_KIND_ORDER,
    SETUP_SECTIONS,
    LOCAL_FORECAST_PROFILE,
    JOB_STATE_LABELS,
    MAX_READING_ROWS,
    MAX_RUN_PICTURES,
    SEVERITY_LABELS,
    STATUS_LABELS,
    TOOL_SPECS,
    BACKEND_LABELS,
    alertModel,
    activityModel,
    backendLabel,
    blockedGroupModel,
    blockerModel,
    blockerReasonText,
    catalogChangeGroups,
    catalogEntryName,
    catalogNoticeModel,
    deviceModels,
    deviceStatusText,
    diagnosticsModel,
    diagnosticsReport,
    formatCount,
    recoveryModel,
    runtimeStatusText,
    attentionReviewText,
    compareActiveAlerts,
    effectiveScreen,
    eventCandidateModel,
    eventImportModel,
    documentCitationText,
    documentQuestionModel,
    fileOrganizerModel,
    mediaTranscriptionModel,
    mediaResultModel,
    mediaSpeechModel,
    mediaVisualModel,
    mediaWorkflowVisible,
    organizerEvidenceText,
    selectedTextModel,
    evidenceText,
    formatFraction,
    formatLoad,
    formatRelativeTime,
    forecastReadingText,
    groupModels,
    groupProfiles,
    highestActiveSeverity,
    inexecutableCount,
    metricModels,
    profileModel,
    panelModel,
    setupModel,
    setupKind,
    setupSection,
    setupSummary,
    systemModel,
    severityText,
    canServe,
    jobModel,
    omittedCount,
    progressText,
    readingModel,
    runModel,
    runReason,
    toViewModel,
    toolModels,
    unavailablePanel,
    unknownContentNotice,
    usesLegacyPictureReadiness,
    workloadServiceStatus,
    workflowActivity,
    jobActivity,
};
