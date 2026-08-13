"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const Readiness = require(
    "../../files/cinnamon-xpuwlm@geraldo-netto/lib/readiness-acceptance.js"
);
const {valid} = require("../helpers/readiness-acceptance-fixture.js");

test("regression: unit, headless, and simulated clicks can never report hardware ready", () => {
    for (const execution of ["unit", "headless", "simulated", "real-hardware-no-click"]) {
        const evidence = valid();
        evidence.scenarios[0].execution = execution;
        assert.equal(Readiness.isReadinessEvidence(evidence), false);
        assert.equal(Readiness.readinessDecision(evidence).ready, false);
    }
});

test("regression: one missing loss or recovery scenario blocks readiness", () => {
    for (const id of ["source-loss", "device-loss", "recovery", "restart", "pressure", "cancellation"]) {
        const evidence = valid();
        evidence.scenarios = evidence.scenarios.filter((scenario) => scenario.id !== id);
        assert.equal(Readiness.readinessDecision(evidence).ready, false);
    }
});
