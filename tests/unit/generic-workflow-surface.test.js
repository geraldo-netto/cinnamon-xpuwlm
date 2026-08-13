"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const Surface = require(
    "../../files/cinnamon-xpuwlm@geraldo-netto/lib/generic-workflow-surface.js"
);
const {definition, state, validResult} = require("../helpers/generic-workflow-fixture.js");

test("closed definitions and states preserve every generic safety surface", () => {
    const model = Surface.createSurfaceModel(definition(), state({
        phase: "running",
        progress: {fraction: 0.425, detail: "batch 2"},
        warning: "Pressure delayed this run",
        retainedCount: 3,
        result: validResult("risk-score"),
    }));

    assert.deepEqual(model.status, {label: "Working", tone: "running"});
    assert.deepEqual(model.unavailable, {visible: false, detail: ""});
    assert.deepEqual(model.consent, {
        visible: true,
        purpose: "Allow bounded queue telemetry for this workload",
        state: "granted",
    });
    assert.deepEqual(model.background, {visible: true, enabled: false});
    assert.deepEqual(model.progress, {visible: true, text: "43% · batch 2"});
    assert.equal(model.warning, "Pressure delayed this run");
    assert.deepEqual(model.retention, {
        text: "Keeps four redacted results until cleared", count: 3,
    });
    assert.equal(model.reviewOnly, true);
    assert.equal(Object.isFrozen(model), true);
});

test("definition contract rejects open, malformed, unsafe, and unbounded records", () => {
    const base = definition();
    const invalid = [
        null, [], {}, {...base, extra: true}, {...base, version: 2},
        {...base, id: "Bad id"}, {...base, id: "a".repeat(121)},
        {...base, title: ""}, {...base, title: "a".repeat(161)},
        {...base, description: ""}, {...base, description: "a".repeat(501)},
        {...base, consentPurpose: 7}, {...base, consentPurpose: "a".repeat(501)},
        {...base, supportsBackground: "yes"}, {...base, retentionText: ""},
        {...base, retentionText: "a".repeat(501)}, {...base, reviewOnly: false},
    ];
    for (const candidate of invalid) {
        assert.equal(Surface.isDefinition(candidate), false);
        assert.throws(
            () => Surface.createSurfaceModel(candidate, state()),
            Surface.SurfaceError,
        );
    }
    assert.equal(Surface.isDefinition(definition({id: "a", title: "a"})), true);
    assert.equal(Surface.isDefinition(definition({
        id: "a".repeat(120), title: "a".repeat(160),
        description: "a".repeat(500), consentPurpose: "a".repeat(500),
        retentionText: "a".repeat(500),
    })), true);
});

test("state contract rejects malformed lifecycle, progress, retention, and results", () => {
    const base = state();
    const invalid = [
        null, [], {}, {...base, extra: true}, {...base, available: 1},
        {...base, unavailableReason: 1}, {...base, unavailableReason: "a".repeat(501)},
        {...base, consent: "implicit"}, {...base, backgroundEnabled: 1},
        {...base, phase: "finished"}, {...base, progress: {}},
        {...base, progress: {fraction: -0.1, detail: ""}},
        {...base, progress: {fraction: 1.1, detail: ""}},
        {...base, progress: {fraction: 0.5, detail: 7}},
        {...base, progress: {fraction: 0.5, detail: "a".repeat(241)}},
        {...base, warning: 7}, {...base, warning: "a".repeat(501)},
        {...base, retainedCount: -1}, {...base, retainedCount: 1.5},
        {...base, result: {}},
    ];
    for (const candidate of invalid) {
        assert.equal(Surface.isState(candidate), false);
        assert.throws(
            () => Surface.createSurfaceModel(definition(), candidate),
            Surface.SurfaceError,
        );
    }
    assert.equal(Surface.isState(state({
        unavailableReason: "a".repeat(500), warning: "a".repeat(500),
        progress: {fraction: 1, detail: "a".repeat(240)},
    })), true);
});

test("actions derive from consent, availability, background, progress, and retention", () => {
    const cases = [
        [state({consent: "required"}), [
            ["grant-consent", true], ["run-now", false], ["toggle-background", false],
        ]],
        [state({consent: "denied"}), [
            ["grant-consent", true], ["run-now", false], ["toggle-background", false],
        ]],
        [state({consent: "granted", backgroundEnabled: true}), [
            ["revoke-consent", true], ["run-now", true], ["toggle-background", true],
        ]],
        [state({available: false}), [
            ["revoke-consent", true], ["run-now", false], ["toggle-background", false],
        ]],
        [state({phase: "running", retainedCount: 1}), [
            ["revoke-consent", false], ["run-now", false], ["toggle-background", false],
            ["cancel", true], ["clear", false],
        ]],
        [state({phase: "cancelling"}), [
            ["revoke-consent", false], ["run-now", false], ["toggle-background", false],
            ["cancel", false],
        ]],
    ];
    for (const [input, expected] of cases) {
        assert.deepEqual(
            Surface.actionModels(definition(), input).map((item) => [item.id, item.enabled]),
            expected,
        );
    }
    assert.deepEqual(Surface.actionModels(
        definition({consentPurpose: "", supportsBackground: false}),
        state({consent: "not-required", result: validResult("labels")}),
    ).map((item) => item.id), ["run-now", "clear"]);
});

test("every typed result becomes bounded review evidence without raw vectors", () => {
    const expected = {
        "risk-score": "elevated",
        forecast: "Offset 1 requests",
        ranking: "Rank 1 · test-a",
        detection: "person · 0.900",
        mask: "4 × 4 mask",
        embedding: "3 embedding values",
        labels: "rock",
        "media-evidence": "0–1000 ms · speech",
    };
    for (const [kind, title] of Object.entries(expected)) {
        const model = Surface.resultModel(validResult(kind));
        assert.equal(model.kind, kind);
        assert.equal(model.rows[0].title, title);
        assert.equal(model.rows.length <= Surface.MAX_EVIDENCE_ROWS, true);
    }
    const embedding = Surface.resultModel(validResult("embedding"));
    assert.equal(JSON.stringify(embedding).includes("0.1"), false);
    const risk = validResult("risk-score");
    risk.payload.evidenceIds = [];
    assert.match(Surface.resultModel(risk).rows[0].detail, /No evidence references/u);
    assert.equal(Surface.resultModel(null), null);
});

test("status and progress wording cover unavailable, error, idle, and empty detail", () => {
    const cases = [
        [state({available: false}), {label: "Unavailable", tone: "unavailable"}],
        [state({phase: "error"}), {label: "Needs attention", tone: "attention"}],
        [state(), {label: "Ready", tone: "healthy"}],
    ];
    for (const [input, expected] of cases) {
        assert.deepEqual(Surface.createSurfaceModel(definition(), input).status, expected);
    }
    assert.equal(Surface.createSurfaceModel(definition(), state({
        phase: "queued", progress: {fraction: 0, detail: ""},
    })).progress.text, "0%");
});
