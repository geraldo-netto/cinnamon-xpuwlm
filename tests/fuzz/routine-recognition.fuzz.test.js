"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const Fixture = require("../helpers/routine-recognition-fixture.js");
const Routine = require("../../files/cinnamon-xpuwlm@geraldo-netto/lib/routine-recognition.js");

test("property: exact sample bounds admit only content-free scalar categories", () => {
    for (let minuteBucket = -1; minuteBucket <= 1440; minuteBucket += 1) {
        const value = Fixture.sample(1, {minuteBucket});
        assert.equal(Routine.validSample(value), minuteBucket >= 0 && minuteBucket <= 1439);
    }
});

test("fuzz: hostile shallow leaves never escape routine predicates", () => {
    const input = Fixture.plan().inputs[0];
    const values = [null, undefined, true, false, 0, 1, "", [], {}, Symbol("x")];
    for (let iteration = 0; iteration < 1000; iteration += 1) {
        const value = values[iteration % values.length];
        assert.doesNotThrow(() => Routine.validSample(value));
        assert.doesNotThrow(() => Routine.validInput(value));
        assert.doesNotThrow(() => Routine.validCandidate(value));
        assert.doesNotThrow(() => Routine.validSuggestion(value, input));
    }
});
