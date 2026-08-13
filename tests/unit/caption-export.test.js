"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const Fixture = require("../helpers/caption-export-fixture.js");
const Captions = require("../../files/cinnamon-xpuwlm@geraldo-netto/lib/caption-export.js");

test("document preserves separate non-overlapping speech and visual tracks", () => {
    const document = Captions.captionDocument(Fixture.transcription());
    assert.deepEqual(document.speech, [
        {startMs: 0, endMs: 1200, text: "Hello"},
        {startMs: 1500, endMs: 3000, text: "World"},
    ]);
    assert.deepEqual(document.visual, [
        {startMs: 0, endMs: 2500, text: "Opening frame\nVisible text: Title"},
        {startMs: 2500, endMs: 5000, text: "Chart frame"},
    ]);
    assert.equal(document.sourceSha256, Fixture.DIGEST);
    assert.equal(Object.isFrozen(document.visual[0]), true);
});

test("audio documents have an immutable empty visual track", () => {
    const document = Captions.captionDocument(Fixture.transcription("audio"));
    assert.deepEqual(document.visual, []);
    assert.equal(Object.isFrozen(document.visual), true);
});

test("SRT and WebVTT rendering are deterministic", () => {
    const cues = [{startMs: 0, endMs: 1234, text: "שלום"}];
    assert.equal(Captions.renderSrt(cues), "1\n00:00:00,000 --> 00:00:01,234\nשלום\n");
    assert.equal(Captions.renderWebVtt(cues), "WEBVTT\n\n00:00:00.000 --> 00:00:01.234\nשלום\n");
    assert.equal(Captions.timestamp(3_661_007, "."), "01:01:01.007");
});

test("cue validation rejects overlap, gaps are allowed, and bounds are inclusive", () => {
    assert.equal(Captions.validCueSequence([
        {startMs: 0, endMs: 1, text: "a"},
        {startMs: 1, endMs: 5000, text: "b"},
    ], 5000), true);
    const invalid = [
        null,
        [{startMs: 1, endMs: 1, text: "a"}],
        [{startMs: -1, endMs: 1, text: "a"}],
        [{startMs: 0, endMs: 5001, text: "a"}],
        [{startMs: 0, endMs: 2, text: "a"}, {startMs: 1, endMs: 3, text: "b"}],
        [{startMs: 0, endMs: 1, text: ""}],
        [{startMs: 0, endMs: 1, text: "a", extra: true}],
    ];
    for (const value of invalid) {
        assert.equal(Captions.validCueSequence(value, 5000), false);
    }
});

test("equal frame times and a frame at the duration fail closed", () => {
    for (const timestamp of [0, 5000]) {
        const source = Fixture.transcription();
        source.visuals[1].timestampMs = timestamp;
        assert.throws(() => Captions.captionDocument(source), (error) => (
            error.code === "visual-timing-invalid"
        ));
    }
});

test("invalid source and overlapping speech expose stable errors", () => {
    assert.throws(() => Captions.captionDocument({}), (error) => error.code === "source-invalid");
    const source = Fixture.transcription();
    source.speech.segments[1].startMs = 1000;
    assert.throws(() => Captions.captionDocument(source), (error) => error.code === "source-invalid");
});

test("rendering validates format, track, cues, and maximum size", () => {
    const document = Captions.captionDocument(Fixture.transcription());
    assert.match(Captions.renderTrack(document, "srt", "visual"), /Visible text: Title/u);
    assert.match(Captions.renderTrack(document, "vtt", "speech"), /^WEBVTT/u);
    for (const args of [[{}, "vtt", "speech"], [document, "txt", "speech"], [document, "vtt", "both"]]) {
        assert.throws(() => Captions.renderTrack(...args), (error) => error.code === "render-invalid");
    }
    const invalid = {...document, speech: [{startMs: 2, endMs: 1, text: "x"}]};
    assert.throws(() => Captions.renderTrack(invalid, "vtt", "speech"), (error) => (
        error.code === "render-invalid"
    ));
    const huge = {...document, speech: [{
        startMs: 0, endMs: 1, text: "x".repeat(Captions.MAX_RENDERED_CHARACTERS),
    }]};
    assert.throws(() => Captions.renderTrack(huge, "srt", "speech"), (error) => (
        error.code === "render-invalid"
    ));
});

test("full-stage measurements require every finite nonnegative stage", () => {
    assert.deepEqual(Captions.fullStageMeasurements(Fixture.measurements()), Fixture.measurements());
    assert.equal(Object.isFrozen(Captions.fullStageMeasurements(Fixture.measurements())), true);
    const invalid = [
        null,
        {...Fixture.measurements(), decodeMs: -1},
        {...Fixture.measurements(), inferenceMs: Infinity},
        {...Fixture.measurements(), totalMs: 79},
        {...Fixture.measurements(), extra: 1},
    ];
    for (const value of invalid) {
        assert.equal(Captions.validMeasurements(value), false);
        assert.throws(() => Captions.fullStageMeasurements(value), (error) => (
            error.code === "measurements-invalid"
        ));
    }
});

test("destination and export input reject traversal or mismatched formats", () => {
    assert.equal(Captions.validDestination("/tmp/a.srt", "srt"), true);
    const exact = `/${"a".repeat(4091)}.srt`;
    assert.equal(Captions.validDestination(exact, "srt"), true);
    for (const path of [
        `${exact}x`, "a.srt", "/tmp/../a.srt", "/tmp/..", "/tmp/a.vtt", "/tmp/a\0.srt", "",
    ]) {
        assert.equal(Captions.validDestination(path, "srt"), false);
    }
    assert.equal(Captions.validDestination("/tmp/a.txt", "txt"), false);
    assert.equal(Captions.validExport(Fixture.exportRequest()), true);
    assert.equal(Captions.validExport({...Fixture.exportRequest(), requestId: "bad id"}), false);
});
