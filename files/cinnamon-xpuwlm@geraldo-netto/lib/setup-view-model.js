"use strict";

const I18n = require("./i18n.js");
const ProfileBlockers = require("./profile-blockers.js");

const {_, N_, format, ngettext} = I18n;

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
        description: N_("These profiles declare a permission that has not been granted, so the runtime refuses every job they submit. Nothing is missing and nothing is broken — a person has to say yes. The profile's status line names the permission it is waiting on."),
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

module.exports = {
    LOCAL_FORECAST_PROFILE,
    SETUP_KIND_ORDER,
    SETUP_SECTIONS,
    setupKind,
    setupModel,
    setupSection,
    setupSummary,
};
