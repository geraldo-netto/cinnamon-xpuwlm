"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const Readiness = require(
    "../../files/cinnamon-xpuwlm@geraldo-netto/lib/readiness-acceptance.js"
);
const {valid} = require("../helpers/readiness-acceptance-fixture.js");

test("recorded scenario matrix links exact generic controls to all lifecycle outcomes", () => {
    const evidence = Readiness.createReadinessEvidence(valid());
    assert.deepEqual(evidence.scenarios.map((scenario) => scenario.id), Readiness.SCENARIOS);
    assert.equal(evidence.scenarios.every(
        (scenario) => scenario.clickControlId.startsWith("generic-health-"),
    ), true);
    assert.deepEqual(
        evidence.scenarios.map((scenario) => scenario.observedOutcome),
        Readiness.SCENARIOS.map((id) => Readiness.EXPECTED_OUTCOMES[id]),
    );
});
