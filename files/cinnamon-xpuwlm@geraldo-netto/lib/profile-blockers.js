"use strict";

// Why a profile cannot run, classified from what the runtime service actually
// published about it.
//
// "Cannot run" is not one problem. The service refuses for three reasons with
// three different remedies: a workload that declares no model needs an
// artifact installed, a workload whose accelerator lane has no importable
// Python runtime needs a package, and a workload with no supported device
// needs hardware nobody can install. Presenting them identically told the user
// to go looking for a fix that, in one of the three cases, does not exist.
//
// The service publishes a machine-readable `reason` beside the sentence, and
// that is what is read first. The sentence stays useful — it names which
// device or which package — but it is prose, and prose gets reworded and
// localised. Classifying on it was a coupling to wording that no gate on
// either side could have caught at the moment it broke.
//
// The sentences below remain as the fallback for a snapshot with no code: one
// written by a service older than the contract, or replayed from before it.
// They are read from `omnitensor/src/omnitensor/service.py` `_profile_status`
// and the executors it consults, matched as substrings because
// `select_backend` joins one reason per backend into a single sentence.
// `tests/contract/profile-blocker-reason-contract.test.js` pins both halves
// against the service sources wherever both checkouts are present.

const BLOCKER_KINDS = Object.freeze(["consent", "model", "runtime", "hardware", "unknown"]);

// service.py `_profile_status` and scheduler.py `select_backend`, grouped by
// the remedy each implies rather than by which module emits it.
const REASON_CODE_KINDS = Object.freeze({
    // An artifact is missing, or the one declared cannot run on this lane.
    "no-model": "model",
    "artifact-unavailable": "model",
    "format-unsupported": "model",
    // The accelerator is there; the software that drives it is not usable.
    "runtime-missing": "runtime",
    "runtime-unusable": "runtime",
    // The plugin declares a permission nobody has granted. Nothing is missing
    // and nothing is broken: a person has to say yes, and the runtime refuses
    // every job for the profile until they do.
    "consent-missing": "consent",
    // No device at all. Nothing installable changes this.
    "device-absent": "hardware",
    "no-executor": "hardware",
    "no-preference": "hardware",
});

// Not blockers: the profile is serving, or the user's own policy is why it is
// not. Listed rather than defaulted so an unrecognised code stays `unknown`.
const NON_BLOCKING_REASON_CODES = Object.freeze([
    "serving",
    "paused-by-policy",
    "profile-disabled",
]);

// service.py: `f"Ready on {backend}; no model bundled"`.
const MODEL_REASONS = Object.freeze(["no model bundled"]);

// The accelerator exists; the Python runtime that drives it is not importable.
const RUNTIME_REASONS = Object.freeze([
    "ncnn is not installed",
    "onnxruntime is not installed",
    "openvino is not installed",
    "tflite-runtime is not installed",
]);

// No device at all. Nothing can be installed to change this.
const HARDWARE_REASONS = Object.freeze([
    "No Coral Edge TPU device detected",
    "No /dev/accel",
    "No GPU render node detected",
]);

// Policy states, not blockers: the service reports them before it ever looks
// at a backend, so they say nothing about whether the profile could run.
const POLICY_REASONS = Object.freeze([
    "Runtime paused by policy",
    "Profile disabled by policy",
]);

// Ordered by how the remedy differs, most specific first: a profile with no
// model is stopped by that whatever else is missing, and a missing package is
// a remedy the user can act on where missing hardware is not.
const REASON_CLASSES = Object.freeze([
    Object.freeze(["model", MODEL_REASONS]),
    Object.freeze(["runtime", RUNTIME_REASONS]),
    Object.freeze(["hardware", HARDWARE_REASONS]),
]);

function mentions(detail, phrases) {
    return phrases.some((phrase) => detail.includes(phrase));
}

function reasonKind(detail) {
    for (const [kind, phrases] of REASON_CLASSES) {
        if (mentions(detail, phrases)) {
            return kind;
        }
    }
    return null;
}

function detailOf(profile) {
    return profile && typeof profile.detail === "string" ? profile.detail : "";
}

function reasonCodeOf(profile) {
    return profile && typeof profile.reason === "string" ? profile.reason : "";
}

// `null` means "this code says nothing about a blocker" — either because the
// profile is not blocked or because the snapshot carries no code at all. It is
// deliberately distinct from `"unknown"`, which means the service did say
// something and this build does not recognise it.
function reasonCodeKind(profile) {
    const code = reasonCodeOf(profile);
    if (code === "" || NON_BLOCKING_REASON_CODES.includes(code)) {
        return null;
    }
    return Object.hasOwn(REASON_CODE_KINDS, code)
        ? REASON_CODE_KINDS[code]
        : "unknown";
}

// The live snapshot is preferred over the bundled manifest, because the
// service owns the catalog that decides what actually runs: a manifest shipped
// here can be older than the one the service loaded. The manifest flag is the
// fallback only when the runtime published no reason. Policy reasons are
// explicitly non-blocking: falling back to a stale manifest after Disable can
// move a dynamically bound profile into the inert setup group and make its
// Enable button impossible to press.
function codedBlocker(profile, code, detail) {
    if (NON_BLOCKING_REASON_CODES.includes(code)) {
        return null;
    }
    const kind = reasonCodeKind(profile);
    return kind === null ? manifestBlocker(profile) : {kind, detail};
}

function classifyProfileBlocker(profile) {
    const detail = detailOf(profile);
    const code = reasonCodeOf(profile);
    if (code !== "") {
        return codedBlocker(profile, code, detail);
    }
    const kind = reasonKind(detail);
    if (kind !== null) {
        return {kind, detail};
    }
    if (profile && profile.status === "unavailable") {
        return {kind: "unknown", detail};
    }
    if (detail !== "") {
        return null;
    }
    return manifestBlocker(profile);
}

// The last resort: what the bundled manifest says, used only where the
// snapshot cannot answer. A profile the shipped manifest calls inexecutable
// needs an artifact, and that is the one thing the manifest does know.
function manifestBlocker(profile) {
    return profile && profile.executable === false ? {kind: "model", detail: ""} : null;
}

module.exports = {
    BLOCKER_KINDS,
    HARDWARE_REASONS,
    NON_BLOCKING_REASON_CODES,
    REASON_CODE_KINDS,
    MODEL_REASONS,
    POLICY_REASONS,
    REASON_CLASSES,
    RUNTIME_REASONS,
    classifyProfileBlocker,
    codedBlocker,
    detailOf,
    manifestBlocker,
    reasonCodeKind,
    reasonCodeOf,
    mentions,
    reasonKind,
};
