"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const Gateway = require(
    "../../files/cinnamon-xpuwlm@geraldo-netto/lib/runtime-contract-gateway.js",
);

const description = {
    version: 1,
    methods: ["ApplyCommand", "DescribeContract"],
    schemas: {
        "runtime-command": 2,
        "runtime-acknowledgement": 2,
        "runtime-refusal": 1,
        "runtime-snapshot": 1,
    },
};

function collecting() {
    const outcomes = [];
    let complete = null;
    const gateway = new Gateway.RuntimeContractGateway({
        sendText: (_options, callback) => {
            complete = callback;
        },
    });
    return {
        gateway,
        outcomes,
        answer: (error, text) => complete(error, text),
        record: (error, contract) => outcomes.push([error, contract]),
    };
}

test("the gateway validates its transport and its callback", () => {
    assert.throws(() => new Gateway.RuntimeContractGateway({sendText: null}), /transport/u);
    const gateway = new Gateway.RuntimeContractGateway({sendText() {}});
    assert.throws(() => gateway.describe(null), /callback/u);
});

test("a well-formed description arrives as a contract, not a document", () => {
    const {gateway, outcomes, answer, record} = collecting();

    gateway.describe(record);
    answer(null, JSON.stringify(description));

    const [error, contract] = outcomes[0];
    assert.equal(error, null);
    assert.equal(contract.known, true);
    assert.equal(contract.supports("DescribeContract"), true);
});

test("a refusal is reported as a refusal, not as a malformed description", () => {
    const refusal = {
        version: 1,
        status: "rejected",
        code: "rate-limit-exceeded",
        message: "DescribeContract allows 20 calls per 10s",
        method: "DescribeContract",
    };

    assert.throws(() => Gateway.parseContract(JSON.stringify(refusal)), (error) => {
        assert.equal(error.name, "RuntimeRefusedError");
        assert.deepEqual(error.refusal, refusal);
        return true;
    });
});

test("an unreadable reply is a contract violation the caller can classify", () => {
    assert.throws(() => Gateway.parseContract(null), /not text/u);
    assert.throws(() => Gateway.parseContract("{"), /invalid JSON/u);
    assert.throws(() => Gateway.parseContract("{}"), /version 1 contract/u);
    assert.throws(() => Gateway.parseContract("{}"), (error) => {
        assert.equal(error.controlContractViolation, true);
        return true;
    });
});

test("a transport error reaches the caller unchanged", () => {
    const {gateway, outcomes, answer, record} = collecting();
    const failure = new Error("no such name");

    gateway.describe(record);
    answer(failure, null);

    assert.deepEqual(outcomes, [[failure, null]]);
});

test("a transport that throws synchronously still answers exactly once", () => {
    const outcomes = [];
    const gateway = new Gateway.RuntimeContractGateway({
        sendText: () => {
            throw new Error("bus is gone");
        },
    });

    gateway.describe((error, contract) => outcomes.push([error.message, contract]));

    assert.deepEqual(outcomes, [["bus is gone", null]]);
});

test("a superseded answer is dropped rather than delivered late", () => {
    // The handshake is reissued when the service name changes owner, and the
    // previous owner's answer describes a service that is no longer there.
    const outcomes = [];
    const callbacks = [];
    const gateway = new Gateway.RuntimeContractGateway({
        sendText: (_options, callback) => callbacks.push(callback),
    });

    gateway.describe((error, contract) => outcomes.push(["first", error, contract]));
    gateway.describe((error, contract) => outcomes.push(["second", error, contract]));
    callbacks[0](null, JSON.stringify(description));

    assert.deepEqual(outcomes, []);
    callbacks[1](null, JSON.stringify(description));
    assert.equal(outcomes.length, 1);
    assert.equal(outcomes[0][0], "second");
});

test("cancelling cancels the outstanding call and answers nothing", () => {
    const cancelled = [];
    const callbacks = [];
    const gateway = new Gateway.RuntimeContractGateway({
        cancellableFactory: () => ({cancel: () => cancelled.push(true)}),
        sendText: (_options, callback) => callbacks.push(callback),
    });
    const outcomes = [];

    assert.equal(gateway.cancel(), false);
    gateway.describe((error, contract) => outcomes.push([error, contract]));
    assert.equal(gateway.cancel(), true);
    callbacks[0](null, JSON.stringify(description));

    assert.deepEqual(cancelled, [true]);
    assert.deepEqual(outcomes, []);
});

test("an environment with no cancellable support still completes", () => {
    const {gateway, outcomes, answer, record} = collecting();
    assert.equal(typeof gateway.cancel, "function");

    gateway.describe(record);
    answer(null, JSON.stringify(description));

    assert.equal(outcomes[0][1].known, true);
});

test("a non-function cancellable factory is replaced rather than called", () => {
    const gateway = new Gateway.RuntimeContractGateway({
        sendText() {},
        cancellableFactory: null,
    });

    assert.equal(gateway.describe(() => {}), true);
    assert.equal(gateway.cancel(), true);
});

test("the port requirement is exported so a caller can check its own wiring", () => {
    assert.throws(() => Gateway.requirePorts(null), /transport/u);
    assert.equal(Gateway.requirePorts(() => {}), undefined);
});

test("an unreadable answer reaches the caller as an error, not a throw", () => {
    const {gateway, outcomes, answer, record} = collecting();

    gateway.describe(record);
    answer(null, "not a description");

    assert.equal(outcomes.length, 1);
    assert.equal(outcomes[0][1], null);
    assert.equal(outcomes[0][0].controlContractViolation, true);
});
