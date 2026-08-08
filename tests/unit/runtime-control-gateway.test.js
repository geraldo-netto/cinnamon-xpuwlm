"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const Gateway = require("../../files/cinnamon-tpuwm@geraldo-netto/lib/runtime-control-gateway.js");

const command = {
    version: 1,
    id: "command-1",
    issuedAt: 1_700_000_000_000,
    expectedRevision: 0,
    operation: "set-paused",
    profileId: null,
    value: true,
};
const acknowledgement = {
    version: 1,
    commandId: "command-1",
    status: "applied",
    revision: 1,
    appliedAt: 1_700_000_000_001,
    message: "",
    portfolio: {paused: true, profiles: {}},
};

test("control gateway validates ports, commands, callbacks, and acknowledgements", () => {
    assert.throws(() => new Gateway.RuntimeControlGateway({sendText: null}), /transport/u);
    assert.throws(
        () => new Gateway.RuntimeControlGateway({sendText() {}, cancellableFactory: null}),
        /cancellable/u,
    );
    const gateway = new Gateway.RuntimeControlGateway({sendText() {}});
    assert.throws(() => gateway.send({}, () => {}), /command/u);
    assert.throws(() => gateway.send(command, null), /callback/u);
    assert.deepEqual(Gateway.parseAcknowledgement(JSON.stringify(acknowledgement)), acknowledgement);
    assert.throws(() => Gateway.parseAcknowledgement(null), /not text/u);
    assert.throws(() => Gateway.parseAcknowledgement("{"), /invalid JSON/u);
    assert.throws(() => Gateway.parseAcknowledgement("{}"), /version 1 contract/u);
});

test("control gateway sends one sequenced cancellable command", () => {
    const requests = [];
    const cancellables = [];
    const gateway = new Gateway.RuntimeControlGateway({
        cancellableFactory: () => {
            const cancellable = {cancelled: false, cancel() { this.cancelled = true; }};
            cancellables.push(cancellable);
            return cancellable;
        },
        sendText: (text, options, callback) => requests.push({text, options, callback}),
    });
    const completions = [];
    assert.equal(gateway.send(command, (...values) => completions.push(values)), true);
    assert.deepEqual(JSON.parse(requests[0].text), command);
    assert.equal(requests[0].options.cancellable, cancellables[0]);
    assert.equal(gateway.send({...command, id: "command-2"}, (...values) => completions.push(values)), true);
    assert.equal(cancellables[0].cancelled, true);
    requests[0].callback(null, JSON.stringify(acknowledgement));
    assert.equal(completions.length, 0);
    requests[1].callback(null, JSON.stringify({...acknowledgement, commandId: "command-2"}));
    assert.equal(completions.length, 1);
    assert.equal(completions[0][0], null);
    assert.equal(completions[0][1].commandId, "command-2");
    assert.equal(gateway.cancel(), false);
});

test("control gateway reports transport and contract failures once", () => {
    const outcomes = [];
    let callback;
    const gateway = new Gateway.RuntimeControlGateway({
        sendText: (_text, _options, complete) => { callback = complete; },
    });
    gateway.send(command, (...values) => outcomes.push(values));
    callback(new Error("service unavailable"), null);
    callback(null, JSON.stringify(acknowledgement));
    assert.equal(outcomes.length, 1);
    assert.match(String(outcomes[0][0]), /service unavailable/u);

    gateway.send(command, (...values) => outcomes.push(values));
    callback(null, "{}");
    assert.match(String(outcomes[1][0]), /version 1 contract/u);

    gateway.send(command, (...values) => outcomes.push(values));
    callback(null, JSON.stringify({...acknowledgement, commandId: "another-command"}));
    assert.match(String(outcomes[2][0]), /does not match request/u);

    const throwing = new Gateway.RuntimeControlGateway({
        sendText() { throw new Error("transport failed"); },
    });
    throwing.send(command, (...values) => outcomes.push(values));
    assert.match(String(outcomes[3][0]), /transport failed/u);
});

test("control gateway cancellation works without a cancellable object", () => {
    const gateway = new Gateway.RuntimeControlGateway({sendText() {}});
    gateway.send(command, () => {});
    assert.equal(gateway.cancel(), true);
    assert.equal(gateway.cancel(), false);
});
