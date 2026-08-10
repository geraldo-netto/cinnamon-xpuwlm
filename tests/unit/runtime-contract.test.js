"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const Contract = require("../../files/cinnamon-tpuwm@geraldo-netto/lib/runtime-contract.js");

function document(overrides = {}) {
    return {
        version: 1,
        methods: ["ApplyCommand", "DescribeContract"],
        schemas: {
            "runtime-command": 1,
            "runtime-acknowledgement": 1,
            "runtime-refusal": 1,
            "runtime-snapshot": 1,
        },
        ...overrides,
    };
}

test("a well-formed description is accepted and reported back whole", () => {
    const contract = new Contract.RuntimeContract(document());

    assert.equal(contract.known, true);
    assert.equal(contract.compatible, true);
    assert.equal(contract.supports("ApplyCommand"), true);
    assert.equal(contract.supports("SubmitJob"), false);
    assert.equal(contract.speaks("runtime-command", 1), true);
    assert.equal(contract.speaks("runtime-command", 2), false);
});

test("not knowing is never reported as a mismatch", () => {
    // Before the service has answered, the applet knows nothing — telling a
    // user their versions disagree would be inventing a fault.
    const unknown = Contract.RuntimeContract.unknown();

    assert.equal(unknown.known, false);
    assert.equal(unknown.compatible, true);
    assert.deepEqual(unknown.incompatibilities(), []);
    assert.deepEqual(unknown.methods, []);
    assert.deepEqual(unknown.schemas, {});
    assert.equal(unknown.supports("ApplyCommand"), false);
});

test("a malformed description leaves the applet knowing nothing", () => {
    for (const broken of [
        null,
        undefined,
        42,
        "{}",
        [],
        document({version: 2}),
        document({methods: []}),
        document({methods: ["ApplyCommand", "ApplyCommand"]}),
        document({methods: ["not a method"]}),
        document({methods: ["A".repeat(65)]}),
        document({methods: "ApplyCommand"}),
        document({schemas: null}),
        document({schemas: {"Runtime-Command": 1}}),
        document({schemas: {"runtime-command": 0}}),
        document({schemas: {"runtime-command": 1.5}}),
        document({schemas: {"runtime-command": 70000}}),
        {...document(), extra: true},
    ]) {
        assert.equal(new Contract.RuntimeContract(broken).known, false, JSON.stringify(broken));
    }
});

test("a method this build calls and the service does not export is named", () => {
    const contract = new Contract.RuntimeContract(document({methods: ["DescribeContract"]}));

    assert.deepEqual(contract.incompatibilities(), [
        {kind: "method-missing", name: "ApplyCommand", required: null, offered: null},
    ]);
    assert.equal(contract.compatible, false);
});

test("each version disagreement is reported with its direction", () => {
    // Which side is older decides who has to update, so the two are not
    // collapsed into one "mismatch".
    const newer = new Contract.RuntimeContract(document({
        schemas: {...document().schemas, "runtime-command": 2},
    }));
    assert.deepEqual(newer.incompatibilities(), [
        {kind: "contract-newer", name: "runtime-command", required: 1, offered: 2},
    ]);

    const absent = document();
    delete absent.schemas["runtime-snapshot"];
    assert.deepEqual(new Contract.RuntimeContract(absent).incompatibilities(), [
        {kind: "contract-missing", name: "runtime-snapshot", required: 1, offered: null},
    ]);

    assert.deepEqual(
        Contract.contractIncompatibility("runtime-command", 2, 1),
        {kind: "contract-older", name: "runtime-command", required: 2, offered: 1},
    );
    assert.equal(Contract.contractIncompatibility("runtime-command", 1, 1), null);
});

test("a contract this build never sends is not compared at all", () => {
    // The service speaking a newer job submission costs nothing to an applet
    // that submits no jobs; reporting it would be a mismatch with no remedy.
    const contract = new Contract.RuntimeContract(document({
        schemas: {...document().schemas, "runtime-job-submit": 9},
    }));

    assert.equal(contract.compatible, true);
});

test("every incompatibility kind is one the module declares", () => {
    const contract = new Contract.RuntimeContract(document({
        methods: ["DescribeContract"],
        schemas: {"runtime-command": 2, "runtime-acknowledgement": 1},
    }));

    for (const found of contract.incompatibilities()) {
        assert.equal(Contract.INCOMPATIBILITY_KINDS.includes(found.kind), true, found.kind);
    }
    assert.equal(contract.incompatibilities().length, 4);
});

test("the projection is frozen so a view cannot edit what the service said", () => {
    const described = new Contract.RuntimeContract(document()).describe();

    assert.deepEqual(Object.keys(described), [
        "known", "compatible", "methods", "schemas", "incompatibilities",
    ]);
    assert.throws(() => {
        described.methods.push("Injected");
    }, TypeError);
    assert.equal(Object.isFrozen(described), true);
});

test("what this build requires is declared, not inferred from the answer", () => {
    // A handshake that asks for whatever it happens to find compares nothing.
    assert.deepEqual(Contract.REQUIRED_METHODS, ["ApplyCommand"]);
    for (const version of Object.values(Contract.REQUIRED_CONTRACTS)) {
        assert.equal(Contract.isContractVersion(version), true);
    }
    assert.equal(Contract.isContractVersion(true), false);
    assert.equal(Contract.isMethodList(["Ok"]), true);
    assert.equal(Contract.isContractMap({}), true);
    assert.equal(Contract.isContractMap([]), false);
});

test("the shipped schema mirror and the required contracts stay in step", () => {
    // Every document this build declares it speaks must be one it can also
    // validate, or the version check passes and the parse still fails.
    const mirrored = new Set([
        "runtime-command",
        "runtime-acknowledgement",
        "runtime-refusal",
        "runtime-snapshot",
    ]);
    for (const name of Object.keys(Contract.REQUIRED_CONTRACTS)) {
        assert.equal(mirrored.has(name), true, `${name} has no mirrored schema in this applet`);
    }
});
