"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const Surface = require(
    "../../files/cinnamon-xpuwlm@geraldo-netto/lib/generic-workflow-surface.js"
);
const {definition, state} = require("../helpers/generic-workflow-fixture.js");

test("fuzz: lifecycle combinations preserve action and review-only invariants", () => {
    for (let iteration = 0; iteration < 5000; iteration += 1) {
        const phase = Surface.PHASES[iteration % Surface.PHASES.length];
        const consent = Surface.CONSENT_STATES[iteration % Surface.CONSENT_STATES.length];
        const available = iteration % 3 !== 0;
        const input = state({phase, consent, available});
        const model = Surface.createSurfaceModel(definition(), input);
        const actions = new Map(model.actions.map((action) => [action.id, action]));
        const active = Surface.ACTIVE_PHASES.has(phase);
        const allowed = Surface.consentAllowsRun(consent);
        assert.equal(actions.get("run-now").enabled, available && allowed && !active);
        assert.equal(actions.has("cancel"), active);
        assert.equal(model.reviewOnly, true);
    }
});

test("fuzz: hostile shallow records never throw from definition or state predicates", () => {
    const values = [null, true, false, -1, 0, 1.5, "", "value", [], {}];
    for (let iteration = 0; iteration < 1000; iteration += 1) {
        const candidateDefinition = definition();
        const definitionKeys = Object.keys(candidateDefinition);
        candidateDefinition[definitionKeys[iteration % definitionKeys.length]] =
            values[iteration % values.length];
        const candidateState = state();
        const stateKeys = Object.keys(candidateState);
        candidateState[stateKeys[iteration % stateKeys.length]] =
            values[(iteration + 3) % values.length];
        assert.doesNotThrow(() => Surface.isDefinition(candidateDefinition));
        assert.doesNotThrow(() => Surface.isState(candidateState));
    }
});
