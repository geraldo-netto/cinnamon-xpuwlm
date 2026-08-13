"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const Fixture = require("../helpers/rehearsal-briefing-fixture.js");
const Briefing = require("../../files/cinnamon-xpuwlm@geraldo-netto/rehearsal-briefing.js");

test("validated recording and deck produce an immutable review-only briefing", () => {
    const result = Briefing.rehearsalBriefing(
        Fixture.candidate(), Fixture.recording(), Fixture.deck(), Fixture.changes(),
    );
    assert.equal(result.reviewOnly, true);
    assert.equal(result.proposedTasks[0].status, "proposed");
    assert.equal(result.proposedEvents[0].status, "proposed");
    assert.deepEqual(result.decisions[0].evidence, {transcriptIndices: [1], frameIndices: [1]});
    assert.equal(result.transcript[1].slideNumber, 2);
    assert.equal(result.frames[1].slideNumber, 2);
    assert.equal(Object.isFrozen(result), true);
    assert.equal(Object.isFrozen(result.proposedTasks), true);
    assert.equal(Object.isFrozen(result.summary.evidence.transcriptIndices), true);
});
