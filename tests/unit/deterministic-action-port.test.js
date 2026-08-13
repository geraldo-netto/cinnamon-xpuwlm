"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const Fixture = require("../helpers/deterministic-action-fixture.js");
const Action = require("../../files/cinnamon-xpuwlm@geraldo-netto/lib/deterministic-action-port.js");

function controller(current, overrides = {}) {
    return new Action.DeterministicActionPort({
        definitions: [current.definition],
        confirmation: current.confirmation,
        audit: current.audit,
        clock: current.clock,
        confirmationTtlMs: 1000,
        ...overrides,
    });
}

async function prepared(current) {
    const port = controller(current);
    const preview = await port.preview(Fixture.request());
    return {port, preview};
}

test("definition allowlist owns bounds, effect kinds, rollback capability, and ports", () => {
    const current = Fixture.harness();
    const owned = Action.ownedDefinition(current.definition);
    assert.equal(Object.isFrozen(owned), true);
    assert.equal(Object.isFrozen(owned.allowedEffects), true);
    assert.deepEqual([...Action.ownedDefinitions([current.definition]).keys()], ["publish-file"]);
    const invalid = [
        null,
        {...current.definition, extra: true},
        {...current.definition, id: "Bad action"},
        {...current.definition, maxTargets: 0},
        {...current.definition, maxTargets: Action.MAX_TARGETS + 1},
        {...current.definition, maxEffects: 0},
        {...current.definition, maxEffects: Action.MAX_EFFECTS + 1},
        {...current.definition, rollbackSupported: "yes"},
        {...current.definition, validate: null},
        {...current.definition, allowedEffects: []},
        {...current.definition, allowedEffects: ["create-file", "create-file"]},
        {...current.definition, allowedEffects: ["Bad effect"]},
        {...current.definition, port: null},
        {...current.definition, port: {preview() {}, conflicts() {}, apply() {}}},
    ];
    for (const definition of invalid) {
        assert.throws(() => Action.ownedDefinition(definition), Action.DeterministicActionError);
    }
    const noRollback = {...current.definition, rollbackSupported: false};
    assert.equal(Action.ownedDefinition(noRollback).rollbackSupported, false);
    for (const definitions of [null, [], Array.from({length: Action.MAX_ACTIONS + 1}, () => current.definition)]) {
        assert.throws(() => Action.ownedDefinitions(definitions), /allowlist/u);
    }
    assert.throws(
        () => Action.ownedDefinitions([current.definition, {...current.definition}]),
        /duplicates/u,
    );
});

test("request boundary rejects unknown action, unsafe JSON, excess bytes, and targets", async () => {
    const current = Fixture.harness();
    const port = controller(current);
    const circular = {};
    circular.self = circular;
    const deep = {};
    let node = deep;
    for (let index = 0; index < Action.MAX_JSON_DEPTH + 1; index += 1) {
        node.next = {};
        node = node.next;
    }
    const tooMany = Object.fromEntries(
        Array.from({length: Action.MAX_JSON_COLLECTION + 1}, (_value, index) => [`k${index}`, index]),
    );
    const tooManyNodes = {items: Array.from({length: Action.MAX_JSON_COLLECTION}, () => (
        Array.from({length: Action.MAX_JSON_COLLECTION}, () => 1)
    ))};
    const faults = [
        null,
        {...Fixture.request(), extra: true},
        {...Fixture.request(), requestId: "bad!request"},
        {...Fixture.request(), actionId: "not-allowed"},
        {...Fixture.request(), sourceResultSha256: "bad"},
        {...Fixture.request(), targets: []},
        {...Fixture.request(), targets: ["same", "same"]},
        {...Fixture.request(), targets: ["/".repeat(4097)]},
        {...Fixture.request(), targets: Array.from({length: 5}, (_value, index) => `target-${index}`)},
        {...Fixture.request(), parameters: null},
        {...Fixture.request(), parameters: {value: Number.NaN}},
        {...Fixture.request(), parameters: {value: undefined}},
        {...Fixture.request(), parameters: {"": true}},
        {...Fixture.request(), parameters: {value: "x".repeat(4097)}},
        {...Fixture.request(), parameters: circular},
        {...Fixture.request(), parameters: deep},
        {...Fixture.request(), parameters: tooMany},
        {...Fixture.request(), parameters: tooManyNodes},
        {...Fixture.request(), parameters: {value: "שלום".repeat(9000)}},
    ];
    for (const fault of faults) {
        await assert.rejects(port.preview(fault), Action.DeterministicActionError);
    }
    assert.equal(Action.utf8ByteLength("Aשלום😀"), 13);
    assert.equal(Action.validParameters({ok: true, value: null, list: [1, false, "x"]}), true);
    assert.equal(Action.validParameters({value: Symbol("x")}), false);
});

test("definition parameter validator receives immutable owned JSON and fails closed", () => {
    const source = Fixture.request().parameters;
    let observed;
    const current = Fixture.harness({validate(parameters) { observed = parameters; return true; }});
    const owned = Action.ownedRequest(Fixture.request(), Action.ownedDefinition(current.definition));
    assert.equal(Object.isFrozen(owned), true);
    assert.equal(Object.isFrozen(owned.targets), true);
    assert.equal(Object.isFrozen(owned.parameters), true);
    assert.notEqual(owned.parameters, source);
    assert.equal(observed, owned.parameters);
    const nested = Action.frozenJson({list: [{value: 1}]});
    assert.equal(Object.isFrozen(nested.list), true);
    assert.equal(Object.isFrozen(nested.list[0]), true);
    source.mode = "overwrite";
    assert.equal(owned.parameters.mode, "create-new");
    for (const validate of [() => false, () => { throw new Error("bad"); }]) {
        const refusing = Fixture.harness({validate});
        assert.throws(
            () => Action.ownedRequest(Fixture.request(), Action.ownedDefinition(refusing.definition)),
            /parameters were refused/u,
        );
    }
});

test("preview validates exact effects and issues a bounded UI confirmation", async () => {
    const current = Fixture.harness();
    const port = controller(current);
    const preview = await port.preview(Fixture.request());
    assert.equal(preview.version, 1);
    assert.equal(preview.confirmationToken, "confirmation-token-0001");
    assert.equal(preview.expiresAt, 2000);
    assert.equal(preview.revision, "revision-1");
    assert.equal(Object.isFrozen(preview), true);
    assert.equal(Object.isFrozen(preview.effects), true);
    assert.equal(Object.isFrozen(preview.effects[0]), true);
    assert.equal(current.confirmation.issued.length, 1);
    assert.equal(current.audit.records[0].phase, "preview");
    assert.equal(current.audit.records[0].outcome, "prepared");
    assert.equal(current.audit.records[0].code, "confirmation-required");
});

test("preview rejects invalid effects, output transitions, and confirmations", async () => {
    const base = Fixture.effect();
    const previews = [
        null,
        {revision: "revision-1", effects: [base], extra: true},
        {revision: "", effects: [base]},
        {revision: "revision-1", effects: []},
        {revision: "revision-1", effects: [{...base, extra: true}]},
        {revision: "revision-1", effects: [{...base, id: "Bad id"}]},
        {revision: "revision-1", effects: [{...base, kind: "delete-file"}]},
        {revision: "revision-1", effects: [{...base, target: "other"}]},
        {revision: "revision-1", effects: [{...base, summary: ""}]},
        {revision: "revision-1", effects: [{...base, beforeSha256: "bad"}]},
        {revision: "revision-1", effects: [{...base, afterSha256: null}]},
        {revision: "revision-1", effects: [{...base, beforeSha256: Fixture.DIGEST_B}]},
        {revision: "revision-1", effects: [base, {...base}]},
    ];
    for (const preview of previews) {
        const current = Fixture.harness({preview});
        await assert.rejects(controller(current).preview(Fixture.request()), Action.DeterministicActionError);
    }
    for (const token of ["short", "x".repeat(257), "confirmation-token-0001"]) {
        const current = Fixture.harness({token});
        const port = controller(current);
        if (token === "confirmation-token-0001") {
            await port.preview(Fixture.request());
        }
        await assert.rejects(port.preview({...Fixture.request(), requestId: "action-request-2"}), /confirmation token/u);
    }
});

test("execute consumes explicit confirmation once, checks conflicts, audits, then applies", async () => {
    const current = Fixture.harness();
    const {port, preview} = await prepared(current);
    const result = await port.execute({token: preview.confirmationToken, confirmed: true});
    assert.equal(result.status, "succeeded");
    assert.equal(result.code, "applied");
    assert.equal(result.receipt.revision, "revision-2");
    assert.deepEqual(result.receipt.changedTargets, ["/private/output/report.txt"]);
    assert.equal(result.rollback, null);
    assert.equal(Object.isFrozen(result), true);
    assert.deepEqual(current.events.map((event) => event[0]), [
        "preview", "issue", "audit", "consume", "audit", "conflicts", "audit", "apply", "audit",
    ]);
    assert.deepEqual(result.audit.map((item) => item.sequence), [2, 3, 4]);
    await assert.rejects(
        port.execute({token: preview.confirmationToken, confirmed: true}),
        /missing or already used/u,
    );
});

test("execute refuses malformed, expired, and port-refused confirmations", async () => {
    for (const confirmation of [
        null,
        {token: "confirmation-token-0001", confirmed: false},
        {token: "short", confirmed: true},
        {token: "confirmation-token-0001", confirmed: true, extra: true},
    ]) {
        const current = Fixture.harness();
        const {port} = await prepared(current);
        await assert.rejects(port.execute(confirmation), /confirmation/u);
    }
    const expired = Fixture.harness();
    const expiredPrepared = await prepared(expired);
    expired.setTime(2001);
    await assert.rejects(
        expiredPrepared.port.execute({token: expiredPrepared.preview.confirmationToken, confirmed: true}),
        /expired/u,
    );
    assert.equal(expired.audit.records.at(-1).outcome, "refused");

    const refused = Fixture.harness({confirmationAccepted: false});
    const refusedPrepared = await prepared(refused);
    await assert.rejects(
        refusedPrepared.port.execute({token: refusedPrepared.preview.confirmationToken, confirmed: true}),
        /was refused/u,
    );
    assert.equal(refused.audit.records.at(-1).code, "confirmation-invalid");
});

test("fresh conflict evidence prevents apply and is returned for review", async () => {
    const conflicts = [{
        target: "/private/output/report.txt",
        code: "target-exists",
        detail: "Another process created the report",
        observedRevision: "revision-2",
    }];
    const current = Fixture.harness({conflicts});
    const {port, preview} = await prepared(current);
    const result = await port.execute({token: preview.confirmationToken, confirmed: true});
    assert.equal(result.status, "conflict");
    assert.deepEqual(result.conflicts, conflicts);
    assert.equal(Object.isFrozen(result.conflicts[0]), true);
    assert.equal(current.events.some((event) => event[0] === "apply"), false);
    assert.equal(current.audit.records.at(-1).phase, "conflict-check");

    for (const invalid of [
        null,
        [{...conflicts[0], extra: true}],
        [{...conflicts[0], target: "other"}],
        [{...conflicts[0], code: "Bad code"}],
        [{...conflicts[0], detail: ""}],
        [{...conflicts[0], observedRevision: ""}],
        [conflicts[0], {...conflicts[0]}],
    ]) {
        const broken = Fixture.harness({conflicts: invalid});
        const preparedBroken = await prepared(broken);
        await assert.rejects(
            preparedBroken.port.execute({token: preparedBroken.preview.confirmationToken, confirmed: true}),
            /conflicts are invalid/u,
        );
    }
});

test("invalid receipts fail into rollback and rollback receipts remain exact", async () => {
    const invalidReceipts = [
        null,
        {revision: "revision-2", changedTargets: ["other"], detail: "changed"},
        {revision: "revision-2", changedTargets: ["/private/output/report.txt"], detail: ""},
    ];
    for (const receipt of invalidReceipts) {
        const current = Fixture.harness({receipt});
        const {port, preview} = await prepared(current);
        const result = await port.execute({token: preview.confirmationToken, confirmed: true});
        assert.equal(result.status, "rolled-back");
    }
    const invalidRollbacks = [
        null,
        {restoredTargets: ["other"], detail: "restored"},
        {restoredTargets: ["/private/output/report.txt"], detail: ""},
    ];
    for (const rollback of invalidRollbacks) {
        const current = Fixture.harness({applyError: new Error("failed"), rollback});
        const {port, preview} = await prepared(current);
        const result = await port.execute({token: preview.confirmationToken, confirmed: true});
        assert.equal(result.status, "rollback-failed");
        assert.equal(result.rollback, null);
    }
});

test("constructor rejects invalid clocks, TTLs, confirmation, and audit ports", () => {
    const current = Fixture.harness();
    for (const override of [
        {confirmationTtlMs: 999},
        {confirmationTtlMs: Action.MAX_CONFIRMATION_TTL_MS + 1},
        {clock: null},
        {clock: {}},
        {confirmation: null},
        {confirmation: {issue() {}}},
        {audit: null},
        {audit: {}},
    ]) {
        assert.throws(() => controller(current, override), Action.DeterministicActionError);
    }
    const invalidClock = Fixture.harness();
    invalidClock.clock.now = () => -1;
    assert.rejects(controller(invalidClock).preview(Fixture.request()), /clock returned invalid/u);
});

test("audit evidence must be durable, exact, and digest-bound", () => {
    const valid = {sequence: 1, recordedAt: 0, digest: Fixture.DIGEST_A};
    assert.equal(Action.validAuditEvidence(valid), true);
    assert.equal(Object.isFrozen(Action.ownedAuditEvidence(valid)), true);
    for (const fault of [
        null,
        {...valid, extra: true},
        {...valid, sequence: 0},
        {...valid, recordedAt: -1},
        {...valid, digest: "bad"},
    ]) {
        assert.equal(Action.validAuditEvidence(fault), false);
        assert.throws(() => Action.ownedAuditEvidence(fault), /audit evidence is invalid/u);
    }
});
