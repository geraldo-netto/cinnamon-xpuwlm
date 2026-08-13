"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const Fixture = require("../helpers/file-categorization-fixture.js");
const Categorization = require("../../files/cinnamon-xpuwlm@geraldo-netto/lib/file-categorization.js");

test("property: every category remains valid across tag permutations", () => {
    const input = Fixture.plan().inputs[0];
    for (const category of Categorization.CATEGORIES) {
        const predictions = [Fixture.prediction("scan-1", category, ["scan", "invoice"])];
        assert.equal(Categorization.validPredictions(predictions, input), true);
        assert.equal(Categorization.validPredictions([
            {...predictions[0], tags: ["invoice", "scan"]},
        ], input), true);
    }
});

test("fuzz: hostile shallow leaves never escape public predicates", () => {
    const values = [null, undefined, true, false, 0, 1, "", [], {}, Symbol("x")];
    for (let iteration = 0; iteration < 1000; iteration += 1) {
        const value = values[iteration % values.length];
        assert.doesNotThrow(() => Categorization.validCategory(value));
        assert.doesNotThrow(() => Categorization.validFile(value));
        assert.doesNotThrow(() => Categorization.validInput(value));
        assert.doesNotThrow(() => Categorization.validCandidate(value));
    }
});
