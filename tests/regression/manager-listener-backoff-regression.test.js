"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const Domain = require("../../files/cinnamon-tpuwm@geraldo-netto/lib/domain.js");
const FailureBackoff = require("../../files/cinnamon-tpuwm@geraldo-netto/lib/failure-log-backoff.js");
const Manager = require("../../files/cinnamon-tpuwm@geraldo-netto/lib/manager.js");

test("regression: a persistent render failure cannot log on every refresh", () => {
    let nowMs = 0;
    const errors = [];
    const logger = {warn() {}, error: (message) => errors.push(message)};
    const manager = new Manager.WorkloadManager({
        repository: {load: () => ({}), save() {}},
        runtimeGateway: {
            read: (options, callback) => callback(Domain.probeSnapshot({available: true, name: "TPU", kind: "usb"}, nowMs)),
        },
        clock: {now: () => nowMs},
        errorReporter: new FailureBackoff.FailureErrorBackoff({logger}),
        logger,
    });
    let healthyDeliveries = 0;
    manager.subscribe(() => { throw new Error("persistent render failure"); });
    manager.subscribe(() => { healthyDeliveries += 1; });
    manager.start();

    for (let poll = 0; poll < 500; poll += 1) {
        nowMs += 1000;
        manager.refresh();
    }

    assert.equal(healthyDeliveries, 501);
    assert.equal(errors.length, 5);
    assert.equal(errors.every((message) => message.includes("State listener failed")), true);
});

test("regression: dispose releases every failure channel holding listener identities", () => {
    const retainedKeys = new Set();
    const errorReporter = {
        report(key) {
            retainedKeys.add(key);
            return true;
        },
        recover(key) {
            return retainedKeys.delete(key);
        },
    };
    const manager = new Manager.WorkloadManager({
        repository: {load: () => ({}), save() { throw new Error("readonly"); }},
        runtimeGateway: {read() { throw new Error("offline"); }},
        clock: {now: () => 0},
        errorReporter,
        logger: {warn() {}, error() {}},
    });
    manager.subscribe(() => { throw new Error("render failure"); });
    manager.start();
    manager.selectTab("profiles");
    assert.equal(retainedKeys.size, 3);

    assert.equal(manager.dispose(), true);
    assert.equal(retainedKeys.size, 0);
    assert.equal(manager.dispose(), false);
});
