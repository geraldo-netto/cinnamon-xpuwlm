"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const Fixture = require("../helpers/screenshot-assistant-fixture.js");
const Assistant = require("../../files/cinnamon-xpuwlm@geraldo-netto/screenshot-assistant.js");

test("explicit screenshot produces immutable, evidence-bound review output", () => {
    const result = Assistant.screenshotResult(
        Fixture.candidate(), Fixture.vision(), Fixture.source(),
    );
    assert.equal(result.sourceKind, "screenshot");
    assert.equal(result.reviewOnly, true);
    assert.equal(result.transformations[0].selectedText, "שלום");
    assert.equal(result.transformations[0].reviewOnly, true);
    assert.equal(result.explanation.evidence.source, "visible-text");
    assert.deepEqual(result.measurements, Fixture.measurements());
    assert.equal(Object.isFrozen(result), true);
    assert.equal(Object.isFrozen(result.transformations), true);
});

test("invalid worker or candidate output fails before rendering", () => {
    assert.throws(() => Assistant.screenshotResult(
        Fixture.candidate(), {}, Fixture.source(),
    ), (error) => error.code === "vision-invalid");
    assert.throws(() => Assistant.screenshotResult(
        {}, Fixture.vision(), Fixture.source(),
    ), (error) => error.code === "result-invalid");
});
