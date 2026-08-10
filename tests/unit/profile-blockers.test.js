"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const Blockers = require("../../files/cinnamon-tpuwm@geraldo-netto/lib/profile-blockers.js");

function profile(overrides = {}) {
    return {id: "workload", status: "idle", detail: "", executable: true, ...overrides};
}

test("the blocker classes stay closed and distinct", () => {
    assert.deepEqual(
        Blockers.BLOCKER_KINDS,
        ["consent", "model", "runtime", "hardware", "unknown"],
    );
    // Sentence matching is the fallback for a snapshot carrying no code, so it
    // covers only the classes a runtime published before codes existed.
    // `consent` is code-only and deliberately absent here: no runtime ever
    // described it in prose, so there is no sentence to match.
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

test("the reason code decides the remedy, and the sentence is not consulted", () => {
    // The whole point: a reworded, translated, or simply wrong sentence must
    // not change the remedy once the service has published a code.
    const misleading = "tpu: No Coral Edge TPU device detected";
    const blocker = Blockers.classifyProfileBlocker(profile({
        detail: misleading,
        status: "unavailable",
        reason: "runtime-missing",
    }));
    assert.deepEqual(blocker, {kind: "runtime", detail: misleading});
});

test("every code the snapshot schema allows is classified", () => {
    const schema = require("../../files/cinnamon-tpuwm@geraldo-netto/runtime-snapshot.schema.json");
    const published = schema.properties.profiles.additionalProperties.properties.reason.enum;
    for (const code of published) {
        const known = Object.prototype.hasOwnProperty.call(Blockers.REASON_CODE_KINDS, code)
            || Blockers.NON_BLOCKING_REASON_CODES.includes(code);
        assert.equal(known, true, `${code} is publishable but unclassified`);
    }
    for (const code of Object.keys(Blockers.REASON_CODE_KINDS)) {
        assert.equal(published.includes(code), true, `${code} is classified but unpublishable`);
        assert.equal(
            Blockers.BLOCKER_KINDS.includes(Blockers.REASON_CODE_KINDS[code]),
            true,
            code,
        );
    }
});

test("each code maps to the remedy its name implies", () => {
    const cases = [
        ["no-model", "model"],
        ["artifact-unavailable", "model"],
        ["format-unsupported", "model"],
        ["runtime-missing", "runtime"],
        ["runtime-unusable", "runtime"],
        ["device-absent", "hardware"],
        ["no-executor", "hardware"],
        ["no-preference", "hardware"],
    ];
    for (const [reason, kind] of cases) {
        assert.equal(
            Blockers.classifyProfileBlocker(profile({reason, status: "unavailable"})).kind,
            kind,
            reason,
        );
    }
});

test("a serving code clears the profile even where the manifest disagrees", () => {
    assert.equal(
        Blockers.classifyProfileBlocker(profile({
            reason: "serving",
            status: "watching",
            detail: "Serving on gpu",
            executable: false,
        })),
        null,
    );
});

test("a policy code still lets the bundled manifest answer", () => {
    // Pausing a profile says nothing about whether it could run if enabled,
    // so the one thing the manifest does know is still worth reporting.
    for (const reason of ["paused-by-policy", "profile-disabled"]) {
        assert.equal(
            Blockers.classifyProfileBlocker(profile({reason, status: "paused"})),
            null,
            reason,
        );
        assert.deepEqual(
            Blockers.classifyProfileBlocker(profile({reason, status: "paused", executable: false})),
            {kind: "model", detail: ""},
            reason,
        );
    }
});

test("a code this build does not know stays unknown rather than guessing", () => {
    // A newer service naming a state this applet has never heard of must not
    // be silently mapped onto whichever remedy happens to be nearest.
    const detail = "gpu: something this build predates";
    assert.deepEqual(
        Blockers.classifyProfileBlocker(profile({
            reason: "thermally-throttled",
            status: "unavailable",
            detail,
        })),
        {kind: "unknown", detail},
    );
});

test("a snapshot with no code at all still classifies by sentence", () => {
    // Older services, and replayed snapshots, publish no code.
    assert.equal(Blockers.reasonCodeOf({reason: 42}), "");
    assert.equal(Blockers.reasonCodeKind({}), null);
    assert.equal(
        Blockers.classifyProfileBlocker(profile({
            detail: "gpu: ncnn is not installed",
            status: "unavailable",
        })).kind,
        "runtime",
    );
});

test("a profile waiting on consent asks a person, not an installer", () => {
    // Nothing is missing and nothing is broken: the runtime refuses every job
    // this profile submits until somebody says yes, and the remedy is a
    // command rather than a download.
    const blocker = Blockers.classifyProfileBlocker(
        {status: "unavailable", reason: "consent-missing", detail: "needs consent for files:read"},
        {executable: true},
    );

    assert.equal(blocker.kind, "consent");
    assert.match(blocker.detail, /files:read/u);
});
