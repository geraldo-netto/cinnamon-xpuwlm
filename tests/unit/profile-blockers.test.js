"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const Blockers = require("../../files/cinnamon-tpuwm@geraldo-netto/lib/profile-blockers.js");

function profile(overrides = {}) {
    return {id: "workload", status: "idle", detail: "", executable: true, ...overrides};
}

test("the three blocker classes stay closed and distinct", () => {
    assert.deepEqual(Blockers.BLOCKER_KINDS, ["model", "runtime", "hardware", "unknown"]);
    assert.deepEqual(
        Blockers.REASON_CLASSES.map(([kind]) => kind),
        ["model", "runtime", "hardware"],
    );
    const phrases = Blockers.REASON_CLASSES.flatMap(([, values]) => values);
    assert.equal(new Set(phrases).size, phrases.length, "one phrase may only mean one thing");
    for (const phrase of phrases) {
        assert.equal(Blockers.POLICY_REASONS.includes(phrase), false, phrase);
    }
});

test("each service sentence is classified by the remedy it implies", () => {
    const cases = [
        ["Ready on gpu; no model bundled", "idle", "model"],
        ["gpu: ncnn is not installed", "unavailable", "runtime"],
        ["gpu: onnxruntime is not installed", "unavailable", "runtime"],
        ["npu: openvino is not installed", "unavailable", "runtime"],
        ["tpu: tflite-runtime is not installed", "unavailable", "runtime"],
        ["tpu: No Coral Edge TPU device detected", "unavailable", "hardware"],
        ["npu: No /dev/accel NPU device detected", "unavailable", "hardware"],
        ["gpu: No GPU render node detected", "unavailable", "hardware"],
    ];
    for (const [detail, status, kind] of cases) {
        const blocker = Blockers.classifyProfileBlocker(profile({detail, status}));
        assert.equal(blocker.kind, kind, detail);
        assert.equal(blocker.detail, detail, detail);
    }
});

test("a joined reason is classified by the most actionable remedy in it", () => {
    // pick_backend joins one reason per backend. Missing hardware cannot be
    // installed, so a missing package in the same sentence is what the user
    // can act on and what the popup must name.
    const joined = "tpu: No Coral Edge TPU device detected; "
        + "npu: No /dev/accel NPU device detected; gpu: ncnn is not installed";
    assert.equal(
        Blockers.classifyProfileBlocker(profile({detail: joined, status: "unavailable"})).kind,
        "runtime",
    );
    // A profile with no model is stopped by that whatever else is missing.
    assert.equal(
        Blockers.classifyProfileBlocker(profile({
            detail: "Ready on gpu; no model bundled",
            status: "idle",
            executable: false,
        })).kind,
        "model",
    );
});

test("an unrecognised refusal is reported verbatim rather than relabelled", () => {
    const detail = "gpu: Vulkan device enumeration failed: libvulkan.so.1 missing";
    const blocker = Blockers.classifyProfileBlocker(profile({detail, status: "unavailable"}));
    assert.deepEqual(blocker, {kind: "unknown", detail});

    // Even with nothing to quote, an unavailable profile is never dropped.
    assert.deepEqual(
        Blockers.classifyProfileBlocker(profile({detail: "", status: "unavailable"})),
        {kind: "unknown", detail: ""},
    );
});

test("a profile the runtime is serving is never blocked by a stale manifest", () => {
    // The service owns the catalog that decides what runs, so its sentence
    // outranks a manifest shipped here that is older than the one it loaded.
    for (const status of ["watching", "running", "healthy"]) {
        assert.equal(
            Blockers.classifyProfileBlocker(profile({
                detail: "Serving on gpu",
                status,
                executable: false,
            })),
            null,
            status,
        );
    }
});

test("a policy statement says nothing about executability, so the manifest answers", () => {
    for (const detail of Blockers.POLICY_REASONS) {
        assert.equal(
            Blockers.classifyProfileBlocker(profile({detail, status: "paused"})),
            null,
            detail,
        );
        assert.deepEqual(
            Blockers.classifyProfileBlocker(profile({detail, status: "paused", executable: false})),
            {kind: "model", detail: ""},
            detail,
        );
    }
});

test("no runtime text at all falls back to what the bundled manifest declares", () => {
    assert.equal(Blockers.classifyProfileBlocker(profile()), null);
    assert.deepEqual(
        Blockers.classifyProfileBlocker(profile({executable: false})),
        {kind: "model", detail: ""},
    );
    // A projection built before the field existed must not be called unrunnable.
    assert.equal(Blockers.classifyProfileBlocker({id: "legacy", status: "idle"}), null);
});

test("the helpers tolerate absent, malformed, and non-object input", () => {
    assert.equal(Blockers.detailOf(null), "");
    assert.equal(Blockers.detailOf(undefined), "");
    assert.equal(Blockers.detailOf({detail: 42}), "");
    assert.equal(Blockers.detailOf({detail: "text"}), "text");
    assert.equal(Blockers.mentions("", ["a"]), false);
    assert.equal(Blockers.mentions("xax", ["a"]), true);
    assert.equal(Blockers.reasonKind("nothing familiar"), null);
    assert.equal(Blockers.classifyProfileBlocker(null), null);
    assert.equal(Blockers.classifyProfileBlocker(undefined), null);
});
