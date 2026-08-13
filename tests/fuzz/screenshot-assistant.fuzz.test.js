"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const Fixture = require("../helpers/screenshot-assistant-fixture.js");
const Assistant = require("../../files/cinnamon-xpuwlm@geraldo-netto/lib/screenshot-assistant.js");

test("property: every valid selected span is returned exactly", () => {
    const text = Fixture.candidate().visibleText;
    for (let start = 0; start < [...text].length; start += 1) {
        for (let end = start + 1; end <= [...text].length; end += 1) {
            const candidate = Fixture.candidate();
            candidate.transformations = [{kind: "explain", start, end, result: "review"}];
            const result = Assistant.screenshotResult(candidate, Fixture.vision(), Fixture.source());
            assert.equal(result.transformations[0].selectedText, [...text].slice(start, end).join(""));
        }
    }
});

test("fuzz: shallow hostile values never escape public validators", () => {
    const values = [null, undefined, true, false, 0, 1, "", [], {}, Symbol("x")];
    for (let index = 0; index < 1000; index += 1) {
        const value = values[index % values.length];
        assert.doesNotThrow(() => Assistant.validExplicitSource(value));
        assert.doesNotThrow(() => Assistant.validVisionEvidence(value));
        assert.doesNotThrow(() => Assistant.validMeasurements(value, "file"));
        assert.doesNotThrow(() => Assistant.validTransformations(value, "text"));
    }
});
