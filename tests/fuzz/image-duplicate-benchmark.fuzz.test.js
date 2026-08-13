"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const Fixture = require("../helpers/image-duplicate-fixture.js");
const Duplicate = require("../../files/cinnamon-xpuwlm@geraldo-netto/lib/image-duplicate-benchmark.js");

test("property: byte identity agrees with complete digest equality", () => {
    const input = Fixture.plan().inputs[1];
    for (let iteration = 0; iteration < 1000; iteration += 1) {
        const pair = input.pairs[iteration % input.pairs.length];
        const decision = Fixture.decision(input, pair);
        assert.equal(decision.byteIdentical, decision.leftSha256 === decision.rightSha256);
        assert.equal(Duplicate.validDecision(decision, input), true);
    }
});

test("fuzz: hostile shallow values never escape duplicate predicates", () => {
    const input = Fixture.plan().inputs[0];
    const values = [null, undefined, true, false, 0, 1, "", [], {}, Symbol("x")];
    for (let iteration = 0; iteration < 1000; iteration += 1) {
        const value = values[iteration % values.length];
        assert.doesNotThrow(() => Duplicate.validImage(value));
        assert.doesNotThrow(() => Duplicate.validInput(value));
        assert.doesNotThrow(() => Duplicate.validCandidate(value));
        assert.doesNotThrow(() => Duplicate.validDecision(value, input));
    }
});
