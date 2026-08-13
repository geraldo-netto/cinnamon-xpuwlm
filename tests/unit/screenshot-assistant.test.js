"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const Fixture = require("../helpers/screenshot-assistant-fixture.js");
const Assistant = require("../../files/cinnamon-xpuwlm@geraldo-netto/lib/screenshot-assistant.js");

test("explicit screenshot and image-file sources are accepted and frozen", () => {
    for (const kind of ["screenshot", "file"]) {
        assert.equal(Assistant.validExplicitSource(Fixture.source(kind)), true);
        assert.deepEqual(Assistant.selectedSource(Fixture.source(kind)), Fixture.source(kind));
        assert.equal(Object.isFrozen(Assistant.selectedSource(Fixture.source(kind))), true);
    }
});

test("source validation rejects implicit, mistimed, unsafe, or non-image input", () => {
    const valid = Fixture.source();
    const invalid = [
        null,
        {...valid, explicit: false},
        {...valid, kind: "screen"},
        {...valid, captureStartedMs: null},
        {...valid, captureStartedMs: -1},
        {...valid, path: "/tmp/capture.pdf"},
        {...valid, name: "dir/capture.png"},
        {...valid, name: "dir\\capture.png"},
        {...valid, size: 0},
        {...valid, regular: false},
        {...valid, symlink: true},
        {...valid, extra: true},
        {...Fixture.source("file"), captureStartedMs: 1},
    ];
    for (const value of invalid) {
        assert.equal(Assistant.validExplicitSource(value), false);
        assert.throws(() => Assistant.selectedSource(value), (error) => error.code === "source-invalid");
    }
});

test("vision request reuses the ready media vision workload", () => {
    assert.deepEqual(Assistant.visionRequest("screen-1", Fixture.source()), {
        version: 1,
        requestId: "screen-1",
        workloadId: "media-transcription",
        payload: {sources: ["/tmp/capture.png"]},
    });
    assert.throws(() => Assistant.visionRequest("bad id", Fixture.source()), (error) => (
        error.code === "request-invalid"
    ));
});

test("vision evidence is exactly one grounded image", () => {
    assert.equal(Assistant.validVisionEvidence(Fixture.vision()), true);
    const invalid = [
        null, {},
        {...Fixture.vision(), source: {...Fixture.vision().source, modality: "video"}},
        {...Fixture.vision(), source: {...Fixture.vision().source, sourceSha256: "bad"}},
        {...Fixture.vision(), visuals: []},
        {...Fixture.vision(), visuals: [...Fixture.vision().visuals, Fixture.vision().visuals[0]]},
        {...Fixture.vision(), visuals: [{...Fixture.vision().visuals[0], description: ""}]},
    ];
    for (const value of invalid) {
        assert.equal(Assistant.validVisionEvidence(value), false);
    }
});

test("explanations cite visible text or scene descriptions", () => {
    const text = Fixture.candidate().visibleText;
    const scene = Fixture.candidate().sceneDescription;
    assert.equal(Assistant.validExplanation(Fixture.candidate().explanation, text, scene), true);
    assert.equal(Assistant.validExplanation({
        kind: "chart", text: "Chart explanation", evidence: {
            source: "scene-description", start: 0, end: [...scene].length,
        },
    }, text, scene), true);
    const invalid = [
        {...Fixture.candidate().explanation, kind: "action"},
        {...Fixture.candidate().explanation, text: ""},
        {...Fixture.candidate().explanation, evidence: {source: "screen", start: 0, end: 1}},
        {...Fixture.candidate().explanation, evidence: {source: "visible-text", start: 1, end: 1}},
        {...Fixture.candidate().explanation, evidence: {source: "visible-text", start: -1, end: 1}},
        {...Fixture.candidate().explanation, evidence: {source: "visible-text", start: 0, end: 999}},
    ];
    for (const value of invalid) {
        assert.equal(Assistant.validExplanation(value, text, scene), false);
    }
});

test("transformations are bounded to selected visible-text spans", () => {
    const text = Fixture.candidate().visibleText;
    const valid = Fixture.candidate().transformations[0];
    assert.equal(Assistant.validTransformation(valid, text), true);
    const invalid = [
        {...valid, kind: "click"},
        {...valid, start: -1},
        {...valid, end: valid.start},
        {...valid, end: 999},
        {...valid, result: ""},
        {...valid, execute: true},
    ];
    for (const value of invalid) {
        assert.equal(Assistant.validTransformation(value, text), false);
    }
    assert.equal(Assistant.validTransformations([], text), true);
    assert.equal(Assistant.validTransformations(null, text), false);
});

test("measurements cover capture through result and distinguish file input", () => {
    assert.equal(Assistant.validMeasurements(Fixture.measurements(), "screenshot"), true);
    assert.equal(Assistant.validMeasurements(Fixture.measurements("file"), "file"), true);
    const invalid = [
        [null, "file"],
        [{...Fixture.measurements(), captureMs: 0}, "screenshot"],
        [{...Fixture.measurements("file"), captureMs: 1}, "file"],
        [{...Fixture.measurements(), inferenceMs: -1}, "screenshot"],
        [{...Fixture.measurements(), postprocessingMs: Infinity}, "screenshot"],
        [{...Fixture.measurements(), totalMs: 49}, "screenshot"],
        [{...Fixture.measurements(), extra: 1}, "screenshot"],
    ];
    for (const [value, kind] of invalid) {
        assert.equal(Assistant.validMeasurements(value, kind), false);
    }
});

test("candidate must reproduce worker evidence exactly", () => {
    assert.equal(Assistant.validCandidate(Fixture.candidate(), Fixture.vision(), Fixture.source()), true);
    const invalid = [
        {...Fixture.candidate(), visibleText: "invented"},
        {...Fixture.candidate(), sceneDescription: "invented"},
        {...Fixture.candidate(), sourceSha256: "e".repeat(64)},
        {...Fixture.candidate(), version: 2},
        {...Fixture.candidate(), activate: true},
    ];
    for (const value of invalid) {
        assert.equal(Assistant.validCandidate(value, Fixture.vision(), Fixture.source()), false);
    }
});

test("bounded text accepts empty OCR but rejects NUL and oversize content", () => {
    assert.equal(Assistant.boundedText(""), true);
    assert.equal(Assistant.boundedText("x", 1), true);
    assert.equal(Assistant.boundedText("", 1), false);
    assert.equal(Assistant.boundedText("x\0y"), false);
    assert.equal(Assistant.boundedText("x".repeat(Assistant.MAX_TEXT + 1)), false);
});
