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

// Every claim in a briefing has to cite evidence that actually exists. That is
// the whole promise of a review-only result: a citation pointing past the end
// of the transcript shows the reviewer something that was never said.
test("evidence must cite real, ordered, distinct indices and cite at least one", () => {
    const evidence = (overrides = {}) => ({transcriptIndices: [0], frameIndices: [], ...overrides});

    assert.equal(Briefing.validEvidence(evidence(), 2, 2), true);
    assert.equal(Briefing.validEvidence(evidence({frameIndices: [1]}), 2, 2), true);
    assert.equal(
        Briefing.validEvidence(evidence({transcriptIndices: [0, 1]}), 2, 2),
        true,
        "several ascending indices",
    );

    // A claim with no citation at all is the thing this exists to refuse.
    assert.equal(
        Briefing.validEvidence(evidence({transcriptIndices: [], frameIndices: []}), 2, 2),
        false,
        "nothing cited",
    );

    // Past the end of what was transcribed or captured.
    assert.equal(Briefing.validEvidence(evidence({transcriptIndices: [2]}), 2, 2), false);
    assert.equal(
        Briefing.validEvidence(evidence({transcriptIndices: [], frameIndices: [2]}), 2, 2),
        false,
    );
    assert.equal(Briefing.validEvidence(evidence({transcriptIndices: [-1]}), 2, 2), false);
    assert.equal(Briefing.validEvidence(evidence({transcriptIndices: [0.5]}), 2, 2), false);

    // Strictly ascending: a repeated or out-of-order index cites the same
    // moment twice and makes the evidence count meaningless.
    assert.equal(Briefing.validEvidence(evidence({transcriptIndices: [0, 0]}), 2, 2), false);
    assert.equal(Briefing.validEvidence(evidence({transcriptIndices: [1, 0]}), 2, 2), false);

    assert.equal(Briefing.validEvidence({transcriptIndices: [0]}, 2, 2), false, "closed record");
    assert.equal(Briefing.validEvidence(evidence({extra: true}), 2, 2), false, "closed record");
});

test("an event is bounded by the recording it claims to describe", () => {
    const event = (overrides = {}) => ({
        title: "Proposal discussed",
        startMs: 0,
        endMs: 3000,
        evidence: {transcriptIndices: [0], frameIndices: []},
        ...overrides,
    });
    const valid = (value) => Briefing.validEvents(value, 2, 2, 9000);

    assert.equal(valid([event()]), true);
    assert.equal(valid([]), true, "no events is a valid answer");
    assert.equal(valid([event({endMs: 9000})]), true, "ending exactly at the end");

    // An event cannot end after the recording did, or start after it ended.
    assert.equal(valid([event({endMs: 9001})]), false, "past the recording");
    assert.equal(valid([event({startMs: 3000, endMs: 3000})]), false, "zero length");
    assert.equal(valid([event({startMs: 4000, endMs: 3000})]), false, "backwards");
    assert.equal(valid([event({startMs: -1})]), false, "before the recording");
    assert.equal(valid([event({startMs: 0.5})]), false, "fractional milliseconds");

    assert.equal(valid([event({title: ""})]), false, "an untitled event says nothing");
    assert.equal(valid([event({extra: true})]), false, "closed record");
    assert.equal(
        valid([event({evidence: {transcriptIndices: [], frameIndices: []}})]),
        false,
        "an event with no evidence",
    );

    assert.equal(valid("events"), false);
    assert.equal(valid(new Array(Briefing.MAX_ITEMS + 1).fill(event())), false, "bounded");
});
