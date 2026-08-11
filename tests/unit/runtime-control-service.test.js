"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const Service = require("../../files/cinnamon-xpuwlm@geraldo-netto/lib/runtime-control-service.js");
const BuiltIns = require("../helpers/built-in-workloads.js");

const NOW = 1_700_000_000_000;

function command(overrides = {}) {
    return {
        version: 1,
        id: "command-1",
        issuedAt: NOW,
        expectedRevision: 0,
        operation: "set-profile-enabled",
        profileId: "hardware-health",
        value: false,
        ...overrides,
    };
}

function batch(changes, expectedRevision = 0, id = "b-1") {
    return {
        version: 1,
        id,
        issuedAt: NOW,
        expectedRevision,
        operation: "apply-profiles",
        profileId: null,
        value: null,
        changes,
    };
}

function harness(overrides = {}) {
    const saves = [];
    const repository = overrides.repository || {
        load: () => ({revision: 0, portfolio: null}),
        save: (state) => saves.push(structuredClone(state)),
    };
    const service = new Service.RuntimeControlService({
        repository,
        catalog: BuiltIns.coreCatalog(),
        clock: overrides.clock || {now: () => NOW},
    });
    return {repository, saves, service};
}

test("runtime service validates collaborators and loaded revision", () => {
    const base = {repository: {load: () => null, save() {}}, catalog: BuiltIns.coreCatalog()};
    assert.throws(() => new Service.RuntimeControlService({...base, repository: null}), /repository/u);
    assert.throws(() => new Service.RuntimeControlService({...base, catalog: {}}), /catalog/u);
    assert.throws(() => new Service.RuntimeControlService({...base, clock: {}}), /clock/u);
    const service = new Service.RuntimeControlService({
        ...base,
        repository: {load: () => ({revision: -1}), save() {}},
    });
    assert.equal(service.state().revision, 0);
    assert.equal(Service.normalizeRevision(3), 3);
    assert.equal(Service.normalizeRevision(-1), 0);
});

test("runtime service acknowledges enabled, weight, and pause commands", () => {
    const {service, saves} = harness();
    const enabled = service.handle(command());
    assert.equal(enabled.status, "applied");
    assert.equal(enabled.revision, 1);
    assert.equal(enabled.portfolio.profiles["hardware-health"].enabled, false);
    assert.equal(service.handle(command({
        id: "command-2",
        expectedRevision: 1,
        operation: "set-profile-weight",
        value: 5,
    })).portfolio.profiles["hardware-health"].weight, 5);
    const paused = service.handle(command({
        id: "command-3",
        expectedRevision: 2,
        operation: "set-paused",
        profileId: null,
        value: true,
    }));
    assert.equal(paused.portfolio.paused, true);
    assert.equal(paused.revision, 3);
    assert.equal(saves.length, 3);
    assert.deepEqual(service.state(), saves.at(-1));
});

test("runtime service rejects revision conflicts and rolls back failures", () => {
    const {service, saves} = harness();
    const conflict = service.handle(command({expectedRevision: 9}));
    assert.equal(conflict.status, "rejected");
    assert.equal(conflict.revision, 0);
    assert.match(conflict.message, /refresh and retry/u);
    assert.equal(saves.length, 0);

    const unknown = service.handle(command({profileId: "unknown"}));
    assert.equal(unknown.status, "rejected");
    assert.equal(unknown.portfolio.profiles["hardware-health"].enabled, true);
    assert.equal(service.state().revision, 0);

    const failing = harness({
        repository: {load: () => null, save() { throw new Error("disk full"); }},
    }).service;
    const rejected = failing.handle(command());
    assert.equal(rejected.status, "rejected");
    assert.match(rejected.message, /disk full/u);
    assert.equal(failing.state().portfolio.profiles["hardware-health"].enabled, true);
});

test("runtime service rejects malformed commands before policy access", () => {
    const {service} = harness();
    assert.throws(() => service.handle({}), /version 1 contract/u);
    const portfolio = service.state().portfolio;
    assert.equal(Service.applyCommand({pauseAll: () => true}, {
        operation: "future",
    }), false);
    const rejected = Service.rejection(
        {id: "command"},
        0,
        portfolio,
        NOW,
        4,
    );
    assert.equal(rejected.message, "Runtime rejected the command");
});

test("a batch is one call, one revision, and all-or-nothing", () => {
    const {service} = harness();

    const applied = service.handle(batch([
        {profileId: "visual-library", enabled: true, weight: 5},
        {profileId: "hardware-health", enabled: false},
    ]));

    assert.equal(applied.status, "applied");
    assert.equal(applied.revision, 1);
    assert.deepEqual(applied.portfolio.profiles["visual-library"], {enabled: true, weight: 5});
    assert.equal(applied.portfolio.profiles["hardware-health"].enabled, false);

    const refused = service.handle(batch(
        [{profileId: "visual-library", enabled: false}, {profileId: "no-such", enabled: true}],
        1,
        "b-2",
    ));

    assert.equal(refused.status, "rejected");
    assert.equal(refused.revision, 1, "a refused batch spends no revision");
    assert.deepEqual(
        refused.portfolio.profiles["visual-library"],
        {enabled: true, weight: 5},
        "the change before the unknown profile was never applied",
    );
});

test("the contract refuses a batch the service should never see", () => {
    const Contract = require("../../files/cinnamon-xpuwlm@geraldo-netto/lib/runtime-control-contract.js");
    const envelope = {version: 1, id: "b-1", issuedAt: 1, expectedRevision: 0};

    assert.equal(Contract.isRuntimeCommand({
        ...envelope, operation: "apply-profiles", profileId: null, value: null,
        changes: [{profileId: "a", enabled: true}],
    }), true);

    for (const changes of [
        [],
        [{profileId: "a"}],
        [{profileId: "a", weight: 9}],
        [{profileId: "a", enabled: "yes"}],
        [{weight: 1}],
        [{profileId: "a", enabled: true, extra: 1}],
        new Array(Contract.MAX_CHANGES + 1).fill({profileId: "a", enabled: true}),
    ]) {
        assert.equal(Contract.isRuntimeCommand({
            ...envelope, operation: "apply-profiles", profileId: null, value: null, changes,
        }), false, JSON.stringify(changes).slice(0, 60));
    }

    assert.equal(Contract.isRuntimeCommand({
        ...envelope, operation: "apply-profiles", profileId: "a", value: null,
        changes: [{profileId: "a", enabled: true}],
    }), false, "a batch names no single profile");
    assert.equal(Contract.isRuntimeCommand({
        ...envelope, operation: "set-paused", profileId: null, value: true,
        changes: [{profileId: "a", enabled: true}],
    }), false, "changes belong to the batch operation alone");
});
