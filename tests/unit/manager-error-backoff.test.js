"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const Domain = require("../../files/cinnamon-xpuwlm@geraldo-netto/lib/domain.js");
const BuiltIns = require("../helpers/built-in-workloads.js");
const FailureBackoff = require("../../files/cinnamon-xpuwlm@geraldo-netto/lib/failure-log-backoff.js");
const Manager = require("../../files/cinnamon-xpuwlm@geraldo-netto/lib/manager.js");

const NOW = 1_700_000_000_000;

function availableSnapshot(nowMs = NOW) {
    return Domain.probeSnapshot({available: true, name: "TPU", kind: "usb"}, nowMs);
}

function createManager({repository, runtimeGateway, clock, errors}) {
    const logger = {warn() {}, error: (message) => errors.push(message)};
    return new Manager.WorkloadManager({
        workloadRegistry: BuiltIns.coreRegistry(),
        repository: repository || {load: () => ({}), save() {}},
        runtimeGateway: runtimeGateway || {read: (options, callback) => callback(availableSnapshot(clock.now()))},
        clock,
        errorReporter: new FailureBackoff.FailureErrorBackoff({logger}),
        logger,
    });
}

test("manager error backoff validates and normalizes its configuration", () => {
    assert.equal(FailureBackoff.FAILURE_INITIAL_DELAY_MS, 30_000);
    assert.equal(FailureBackoff.FAILURE_MAX_DELAY_MS, 900_000);
    assert.throws(() => new FailureBackoff.FailureErrorBackoff({logger: null}), /logger/);
    assert.throws(() => new FailureBackoff.FailureErrorBackoff({logger: {}}), /logger/);
    assert.equal(FailureBackoff.normalizeDelay("5.9", 20), 5);
    assert.equal(FailureBackoff.normalizeDelay(-4, 20), 1);
    for (const value of [0, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
        assert.equal(FailureBackoff.normalizeDelay(value, 20), 20);
    }
});

test("manager error backoff is channel-isolated, exponential, capped, and recoverable", () => {
    const errors = [];
    const firstListener = () => {};
    const secondListener = () => {};
    const backoff = new FailureBackoff.FailureErrorBackoff({
        logger: {error: (message) => errors.push(message)},
        initialDelayMs: 10,
        maximumDelayMs: 25,
    });

    assert.equal(backoff.error(firstListener, "first-1", 0), true);
    assert.equal(backoff.error(firstListener, "suppressed", 9), false);
    assert.equal(backoff.error(secondListener, "second-1", 9), true);
    assert.equal(backoff.error(firstListener, "first-2", 10), true);
    assert.equal(backoff.error(firstListener, "suppressed", 29), false);
    assert.equal(backoff.error(firstListener, "first-3", 30), true);
    assert.equal(backoff.error(firstListener, "suppressed", 54), false);
    assert.equal(backoff.error(firstListener, "first-4", 55), true);
    assert.deepEqual(errors, ["first-1", "second-1", "first-2", "first-3", "first-4"]);
    assert.equal(backoff.recover("missing"), false);
    assert.equal(backoff.recover(firstListener), true);
    assert.equal(backoff.error(firstListener, "after-recovery", 55), true);
});

test("manager error backoff restarts safely after rollback or invalid time", () => {
    const errors = [];
    const backoff = new FailureBackoff.FailureErrorBackoff({
        logger: {error: (message) => errors.push(message)},
        initialDelayMs: 10,
        maximumDelayMs: 20,
    });

    assert.equal(backoff.error("read", "first", 100), true);
    assert.equal(backoff.error("read", "suppressed", 105), false);
    assert.equal(backoff.error("read", "rollback", 90), true);
    assert.equal(backoff.error("read", "rollback-suppressed", 99), false);
    assert.equal(backoff.error("read", "rollback-due", 100), true);
    assert.equal(backoff.error("invalid", "invalid-first", Number.POSITIVE_INFINITY), true);
    assert.equal(backoff.error("invalid", "invalid-suppressed", Number.NaN), false);
    assert.equal(backoff.error("invalid", "invalid-due", 10), true);
    assert.deepEqual(errors, [
        "first",
        "rollback",
        "rollback-due",
        "invalid-first",
        "invalid-due",
    ]);
});

test("manager bounds runtime failures and resets the channel after recovery", () => {
    let nowMs = NOW;
    const errors = [];
    const failingGateway = {read() { throw new Error("offline"); }};
    const manager = createManager({
        runtimeGateway: failingGateway,
        clock: {now: () => nowMs},
        errors,
    });

    manager.start();
    nowMs += FailureBackoff.FAILURE_INITIAL_DELAY_MS - 1;
    manager.refresh();
    assert.equal(errors.length, 1);
    nowMs += 1;
    manager.refresh();
    assert.equal(errors.length, 2);
    manager.replaceRuntimeGateway({read: (options, callback) => callback(availableSnapshot(nowMs))});
    manager.replaceRuntimeGateway(failingGateway);
    assert.equal(errors.length, 3);
    assert.match(errors.at(-1), /Could not read runtime state/);
});

test("manager isolates, bounds, and recovers listener failures", () => {
    const nowMs = NOW;
    let shouldFail = true;
    let healthyDeliveries = 0;
    const errors = [];
    const manager = createManager({clock: {now: () => nowMs}, errors});
    manager.start();
    const failingListener = () => {
        if (shouldFail) {
            throw new Error("render failed");
        }
    };
    const unsubscribe = manager.subscribe(failingListener);
    manager.subscribe(() => { healthyDeliveries += 1; });

    manager.refresh();
    assert.equal(errors.length, 1);
    assert.equal(healthyDeliveries, 2);
    shouldFail = false;
    manager.refresh();
    shouldFail = true;
    manager.refresh();
    assert.equal(errors.length, 2);
    assert.equal(unsubscribe(), true);
    assert.equal(unsubscribe(), false);
    manager.subscribe(failingListener);
    assert.equal(errors.length, 3);
});

test("manager bounds save errors and resets the channel after a successful save", () => {
    let failSave = true;
    const errors = [];
    const repository = {
        load: () => ({selectedTab: "alerts"}),
        save() {
            if (failSave) {
                throw new Error("readonly");
            }
        },
    };
    const manager = createManager({repository, clock: {now: () => NOW}, errors});
    manager.start();

    manager.selectTab("profiles");
    manager.selectTab("overview");
    assert.equal(errors.length, 1);
    failSave = false;
    manager.selectTab("alerts");
    failSave = true;
    manager.selectTab("profiles");
    assert.equal(errors.length, 2);
    assert.match(errors.at(-1), /Could not save applet state/);
});
