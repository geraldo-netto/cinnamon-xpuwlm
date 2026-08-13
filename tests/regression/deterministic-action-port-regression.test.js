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

test("regression: apply never starts when the pre-apply audit record fails", async () => {
    const current = Fixture.harness({auditErrorAt: 3});
    const port = controller(current);
    const preview = await port.preview(Fixture.request());
    await assert.rejects(port.execute({token: preview.confirmationToken, confirmed: true}), /audit unavailable/u);
    assert.equal(current.events.some((event) => event[0] === "apply"), false);
});

test("regression: failed mutation rolls back automatically when supported", async () => {
    const error = new Action.DeterministicActionError("write-failed", "disk full");
    const current = Fixture.harness({applyError: error});
    const port = controller(current);
    const preview = await port.preview(Fixture.request());
    const result = await port.execute({token: preview.confirmationToken, confirmed: true});
    assert.equal(result.status, "rolled-back");
    assert.equal(result.code, "rolled-back");
    assert.deepEqual(result.rollback.restoredTargets, ["/private/output/report.txt"]);
    assert.equal(current.events.find((event) => event[0] === "rollback").at(-1), "write-failed");
    assert.deepEqual(current.audit.records.slice(-2).map((record) => record.phase), ["apply", "rollback"]);
});

test("regression: no rollback claim is made for an irreversible definition", async () => {
    const current = Fixture.harness({
        applyError: new Error("remote failure"),
        rollbackSupported: false,
    });
    const port = controller(current);
    const preview = await port.preview(Fixture.request());
    const result = await port.execute({token: preview.confirmationToken, confirmed: true});
    assert.equal(result.status, "failed");
    assert.equal(result.code, "action-failed");
    assert.equal(result.rollback, null);
    assert.equal(current.events.some((event) => event[0] === "rollback"), false);
});

test("regression: rollback failure is explicit and never reported as restored", async () => {
    const current = Fixture.harness({
        applyError: new Error("write failed"),
        rollbackError: new Error("rollback failed"),
    });
    const port = controller(current);
    const preview = await port.preview(Fixture.request());
    const result = await port.execute({token: preview.confirmationToken, confirmed: true});
    assert.equal(result.status, "rollback-failed");
    assert.equal(result.code, "rollback-failed");
    assert.equal(result.rollback, null);
    assert.equal(current.audit.records.at(-1).outcome, "failed");
});

test("regression: preview is removed if its audit evidence cannot be stored", async () => {
    const current = Fixture.harness({auditErrorAt: 1});
    const port = controller(current);
    await assert.rejects(port.preview(Fixture.request()), /audit unavailable/u);
    await assert.rejects(
        port.execute({token: "confirmation-token-0001", confirmed: true}),
        /missing or already used/u,
    );
});

test("regression: pending previews are bounded and expired entries are swept", async () => {
    const current = Fixture.harness();
    let next = 0;
    current.confirmation.issue = async () => `confirmation-token-${String(next++).padStart(4, "0")}`;
    const port = controller(current);
    for (let index = 0; index < Action.MAX_PENDING; index += 1) {
        await port.preview({...Fixture.request(), requestId: `request-${index}`});
    }
    await assert.rejects(
        port.preview({...Fixture.request(), requestId: "request-capacity"}),
        /too many action previews/u,
    );
    current.setTime(2001);
    assert.equal(
        (await port.preview({...Fixture.request(), requestId: "request-after-expiry"})).requestId,
        "request-after-expiry",
    );
});
