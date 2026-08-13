"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const Readiness = require(
    "../../files/cinnamon-xpuwlm@geraldo-netto/lib/readiness-acceptance.js"
);
const {valid} = require("../helpers/readiness-acceptance-fixture.js");

test("fuzz: scenario permutations remain complete and accepted", () => {
    for (let iteration = 0; iteration < 1000; iteration += 1) {
        const evidence = valid();
        const offset = iteration % evidence.scenarios.length;
        evidence.scenarios = evidence.scenarios.slice(offset).concat(evidence.scenarios.slice(0, offset));
        assert.equal(Readiness.isReadinessEvidence(evidence), true);
        assert.equal(Readiness.readinessDecision(evidence).ready, true);
    }
});

test("fuzz: one hostile scenario mutation always prevents readiness", () => {
    const mutations = [
        (item) => { item.execution = "simulated"; },
        (item) => { item.clickControlId = "Bad control"; },
        (item) => { item.observedOutcome = "unknown"; },
        (item) => { item.startedAt = 999; },
        (item) => { item.endedAt = 2001; },
        (item) => { item.errors = null; },
    ];
    for (let iteration = 0; iteration < 1000; iteration += 1) {
        const evidence = valid();
        const target = evidence.scenarios[iteration % evidence.scenarios.length];
        mutations[iteration % mutations.length](target);
        assert.equal(Readiness.isReadinessEvidence(evidence), false);
        assert.equal(Readiness.readinessDecision(evidence).ready, false);
    }
});
