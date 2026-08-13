"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const Fixture = require("../helpers/deterministic-action-fixture.js");
const Action = require("../../files/cinnamon-xpuwlm@geraldo-netto/lib/deterministic-action-port.js");

function controller(current) {
    return new Action.DeterministicActionPort({
        definitions: [current.definition],
        confirmation: current.confirmation,
        audit: current.audit,
        clock: current.clock,
        confirmationTtlMs: 1000,
    });
}

test("create-new action crosses preview, UI confirmation, conflict, audit, apply ports in order", async () => {
    const current = Fixture.harness();
    const port = controller(current);
    const preview = await port.preview(Fixture.request());
    assert.deepEqual(preview.effects.map((effect) => effect.kind), ["create-file"]);
    const result = await port.execute({token: preview.confirmationToken, confirmed: true});
    assert.equal(result.status, "succeeded");
    assert.equal(current.confirmation.consumed.length, 1);
    assert.deepEqual(current.audit.records.map((record) => [record.phase, record.outcome]), [
        ["preview", "prepared"],
        ["confirmation", "accepted"],
        ["apply", "authorized"],
        ["apply", "succeeded"],
    ]);
});

test("separate definitions cannot cross action or effect allowlists", async () => {
    const current = Fixture.harness();
    const second = Fixture.harness();
    second.definition = {
        ...second.definition,
        id: "calendar-export",
        allowedEffects: ["create-calendar"],
        validate: (parameters) => parameters.mode === "create-new",
    };
    second.actionPort.preview = async () => ({
        revision: "calendar-1",
        effects: [{...Fixture.effect(), kind: "create-file"}],
    });
    const port = new Action.DeterministicActionPort({
        definitions: [current.definition, second.definition],
        confirmation: current.confirmation,
        audit: current.audit,
        clock: current.clock,
        confirmationTtlMs: 1000,
    });
    await assert.rejects(port.preview({
        ...Fixture.request(), actionId: "calendar-export",
    }), /action preview is invalid/u);
});
