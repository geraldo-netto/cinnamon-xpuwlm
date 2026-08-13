"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const Fixture = require("../helpers/deterministic-action-fixture.js");
const Action = require("../../files/cinnamon-xpuwlm@geraldo-netto/lib/deterministic-action-port.js");

function generator(seed) {
    let state = seed >>> 0;
    return () => {
        state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
        return state / 0x100000000;
    };
}

test("property: finite acyclic JSON remains deterministic under deep freeze", () => {
    const random = generator(0x0103);
    for (let index = 0; index < 1000; index += 1) {
        const value = {
            integer: Math.floor(random() * 1000),
            flag: random() > 0.5,
            text: `value-${Math.floor(random() * 1000)}-שלום`,
            list: [null, random(), `item-${index}`],
        };
        assert.equal(Action.validParameters(value), true);
        const frozen = Action.frozenJson(value);
        assert.deepEqual(frozen, value);
        assert.equal(Object.isFrozen(frozen), true);
        assert.equal(Object.isFrozen(frozen.list), true);
    }
});

test("property: one hostile effect mutation always fails preview validation", () => {
    const current = Fixture.harness();
    const definition = Action.ownedDefinition(current.definition);
    const request = Action.ownedRequest(Fixture.request(), definition);
    const valid = Fixture.effect();
    const mutations = [
        {id: "Bad id"},
        {kind: "delete-file"},
        {target: "other"},
        {summary: ""},
        {beforeSha256: "bad"},
        {afterSha256: null},
        {beforeSha256: Fixture.DIGEST_B},
    ];
    for (let index = 0; index < 1000; index += 1) {
        const fault = mutations[index % mutations.length];
        assert.equal(Action.validEffects([{...valid, ...fault}], definition, request), false);
    }
});

test("property: target uniqueness and declared bounds are exact", () => {
    const random = generator(0x32);
    for (let index = 0; index < 1000; index += 1) {
        const length = Math.floor(random() * (Action.MAX_TARGETS + 3));
        const targets = Array.from({length}, (_value, target) => `target-${target}`);
        assert.equal(Action.validTargets(targets, Action.MAX_TARGETS), length >= 1 && length <= 32);
        if (targets.length > 0) {
            targets.push(targets[0]);
            assert.equal(Action.validTargets(targets, Action.MAX_TARGETS), false);
        }
    }
});
