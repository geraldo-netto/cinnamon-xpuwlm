"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const Fixture = require("../helpers/rehearsal-briefing-fixture.js");
const Briefing = require("../../files/cinnamon-xpuwlm@geraldo-netto/lib/rehearsal-briefing.js");

test("slide alignment preserves timestamps and ordered changes", () => {
    const changes = Fixture.changes();
    assert.equal(Briefing.slideAt(0, changes), 1);
    assert.equal(Briefing.slideAt(2999, changes), 1);
    assert.equal(Briefing.slideAt(3000, changes), 2);
    assert.deepEqual(Briefing.alignedTranscript(Fixture.recording(), changes), [
        {startMs: 500, endMs: 1800, text: "Opening statement", slideNumber: 1},
        {startMs: 3500, endMs: 5200, text: "Decision and action", slideNumber: 2},
    ]);
    assert.deepEqual(Briefing.alignedFrames(Fixture.recording(), changes), [
        {timestampMs: 1000, slideNumber: 1, visibleText: "Intro", description: "Title slide"},
        {timestampMs: 4000, slideNumber: 2, visibleText: "Data", description: "Bar chart"},
    ]);
});

test("timing ends at the next change and recording boundary", () => {
    assert.deepEqual(Briefing.timing(Fixture.changes(), 9000), [
        {slideNumber: 1, startMs: 0, endMs: 3000, durationMs: 3000},
        {slideNumber: 2, startMs: 3000, endMs: 9000, durationMs: 6000},
    ]);
});

test("slide changes require a zero origin, strict order, and known slides", () => {
    assert.equal(Briefing.validSlideChanges(Fixture.changes(), 9000, 2), true);
    const invalid = [
        null, [], [{timestampMs: 1, slideNumber: 1}],
        [{timestampMs: 0, slideNumber: 0}],
        [{timestampMs: 0, slideNumber: 3}],
        [{timestampMs: 0, slideNumber: 1}, {timestampMs: 0, slideNumber: 2}],
        [{timestampMs: 0, slideNumber: 1}, {timestampMs: 1, slideNumber: 1}],
        [{timestampMs: 0, slideNumber: 1}, {timestampMs: 9000, slideNumber: 2}],
        [{timestampMs: 0, slideNumber: 1, extra: true}],
    ];
    for (const value of invalid) {
        assert.equal(Briefing.validSlideChanges(value, 9000, 2), false);
    }
});

test("recording and deck validators fail closed", () => {
    assert.equal(Briefing.validRecording(Fixture.recording()), true);
    assert.equal(Briefing.validDeck(Fixture.deck()), true);
    for (const value of [null, {}, {...Fixture.recording(), speech: null}]) {
        assert.equal(Briefing.validRecording(value), false);
    }
    for (const value of [null, {}, {...Fixture.deck(), editable: false}, {
        ...Fixture.deck(), slides: [{number: 2, editable: true}],
    }]) {
        assert.equal(Briefing.validDeck(value), false);
    }
});

test("evidence indices are bounded, increasing, and non-empty", () => {
    assert.equal(Briefing.validEvidence(Fixture.evidence(), 2, 2), true);
    const invalid = [
        {transcriptIndices: [], frameIndices: []},
        {transcriptIndices: [-1], frameIndices: []},
        {transcriptIndices: [2], frameIndices: []},
        {transcriptIndices: [1, 0], frameIndices: []},
        {transcriptIndices: [0, 0], frameIndices: []},
        {transcriptIndices: [0], frameIndices: [2]},
        {transcriptIndices: [0], frameIndices: [], extra: true},
    ];
    for (const value of invalid) {
        assert.equal(Briefing.validEvidence(value, 2, 2), false);
    }
});

test("candidate validation rejects ungrounded and executable-shaped output", () => {
    const recording = Fixture.recording();
    const transcript = Briefing.alignedTranscript(recording, Fixture.changes());
    const frames = Briefing.alignedFrames(recording, Fixture.changes());
    assert.equal(Briefing.validateCandidate(Fixture.candidate(), recording, transcript, frames), true);
    const badSummary = Fixture.candidate();
    badSummary.summary.evidence = {transcriptIndices: [], frameIndices: []};
    assert.equal(Briefing.validateCandidate(badSummary, recording, transcript, frames), false);
    const badTask = Fixture.candidate();
    badTask.proposedTasks[0].execute = true;
    assert.equal(Briefing.validateCandidate(badTask, recording, transcript, frames), false);
    const badEvent = Fixture.candidate();
    badEvent.proposedEvents[0].endMs = 9001;
    assert.equal(Briefing.validateCandidate(badEvent, recording, transcript, frames), false);
});

test("task assignee suggestions are optional bounded review text", () => {
    const task = Fixture.candidate().proposedTasks[0];
    assert.equal(Briefing.validTasks([{...task, assigneeSuggestion: "Release team"}], 2, 2), true);
    assert.equal(Briefing.validTasks([{...task, assigneeSuggestion: ""}], 2, 2), false);
    assert.equal(Briefing.validTasks([{...task, assigneeSuggestion: 7}], 2, 2), false);
});

test("bounded text rejects empty, null, overlong, and NUL content", () => {
    assert.equal(Briefing.boundedText("x"), true);
    assert.equal(Briefing.boundedText(""), false);
    assert.equal(Briefing.boundedText(null), false);
    assert.equal(Briefing.boundedText("x\0y"), false);
    assert.equal(Briefing.boundedText("x".repeat(Briefing.MAX_TEXT + 1)), false);
});

test("invalid inputs expose stable error codes", () => {
    assert.throws(
        () => Briefing.rehearsalBriefing(Fixture.candidate(), {}, Fixture.deck(), Fixture.changes()),
        (error) => error.code === "source-invalid" && error.name === "RehearsalBriefingError",
    );
    assert.throws(
        () => Briefing.rehearsalBriefing({}, Fixture.recording(), Fixture.deck(), Fixture.changes()),
        (error) => error.code === "result-invalid",
    );
});
