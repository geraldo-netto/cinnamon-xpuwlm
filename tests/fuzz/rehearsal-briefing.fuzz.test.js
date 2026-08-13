"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const Fixture = require("../helpers/rehearsal-briefing-fixture.js");
const Briefing = require("../../files/cinnamon-xpuwlm@geraldo-netto/lib/rehearsal-briefing.js");

test("property: slide alignment is the last change at or before the timestamp", () => {
    const changes = Fixture.changes();
    for (let timestamp = 0; timestamp < 9000; timestamp += 17) {
        assert.equal(Briefing.slideAt(timestamp, changes), timestamp < 3000 ? 1 : 2);
    }
});

test("fuzz: shallow hostile values never escape briefing validators", () => {
    const values = [null, undefined, true, false, 0, 1, "", [], {}, Symbol("x")];
    for (let index = 0; index < 1000; index += 1) {
        const value = values[index % values.length];
        assert.doesNotThrow(() => Briefing.validRecording(value));
        assert.doesNotThrow(() => Briefing.validDeck(value));
        assert.doesNotThrow(() => Briefing.validSlideChanges(value, 9000, 2));
        assert.doesNotThrow(() => Briefing.validEvidence(value, 2, 2));
    }
});
