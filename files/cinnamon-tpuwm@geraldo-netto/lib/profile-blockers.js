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
// The sentences below are the ones the service emits, read from
// `omnitensor/src/omnitensor/service.py` `_profile_status` and from the
// executors it consults (`executors/tpu.py`, `executors/npu.py`,
// `executors/gpu.py`, `executors/vulkan.py`). They are matched as substrings
// because `pick_backend` joins one reason per backend into a single sentence.
// `tests/contract/profile-blocker-reason-contract.test.js` pins them against
// the service sources wherever both checkouts are present, so a reworded
// service reason fails a gate here instead of silently degrading to `unknown`.

const BLOCKER_KINDS = Object.freeze(["model", "runtime", "hardware", "unknown"]);

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

// The live snapshot is preferred over the bundled manifest, because the
// service owns the catalog that decides what actually runs: a manifest shipped
// here can be older than the one the service loaded. The manifest flag is the
// fallback for exactly the cases where the snapshot cannot answer — no runtime
// has published anything for this profile, or the only thing it published is
// the user's own policy decision.
function classifyProfileBlocker(profile) {
    const detail = detailOf(profile);
    const kind = reasonKind(detail);
    if (kind !== null) {
        return {kind, detail};
    }
    if (profile && profile.status === "unavailable") {
        return {kind: "unknown", detail};
    }
    if (detail !== "" && !mentions(detail, POLICY_REASONS)) {
        return null;
    }
    return profile && profile.executable === false ? {kind: "model", detail: ""} : null;
}

module.exports = {
    BLOCKER_KINDS,
    HARDWARE_REASONS,
    MODEL_REASONS,
    POLICY_REASONS,
    REASON_CLASSES,
    RUNTIME_REASONS,
    classifyProfileBlocker,
    detailOf,
    mentions,
    reasonKind,
};
