"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const Fixture = require("../helpers/rehearsal-briefing-fixture.js");
const Briefing = require("../../files/cinnamon-xpuwlm@geraldo-netto/lib/rehearsal-briefing.js");

test("regression: briefing output cannot carry task, calendar, or UI commands", () => {
    const candidate = Fixture.candidate();
    candidate.proposedEvents[0].calendarId = "default";
    assert.throws(() => Briefing.rehearsalBriefing(
        candidate, Fixture.recording(), Fixture.deck(), Fixture.changes(),
    ), (error) => error.code === "result-invalid");
    const exports = Object.keys(Briefing);
    assert.equal(exports.some((name) => /create|execute|calendar|activate/iu.test(name)), false);
});

test("regression: source timestamps and words are not regenerated", () => {
    const recording = Fixture.recording();
    recording.speech.segments[0].text = "שלום – Привет – English";
    const result = Briefing.rehearsalBriefing(
        Fixture.candidate(), recording, Fixture.deck(), Fixture.changes(),
    );
    assert.deepEqual(result.transcript[0], {
        startMs: 500, endMs: 1800, text: "שלום – Привет – English", slideNumber: 1,
    });
});
