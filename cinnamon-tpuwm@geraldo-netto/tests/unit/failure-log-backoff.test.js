"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const Backoff = require("../../lib/failure-log-backoff.js");

test("failure log backoff validates and normalizes configuration", () => {
    assert.equal(Backoff.FAILURE_INITIAL_DELAY_MS, 30_000);
    assert.equal(Backoff.FAILURE_MAX_DELAY_MS, 900_000);
    assert.throws(() => new Backoff.FailureLogBackoff({}), /emitter/);
    assert.equal(Backoff.normalizeDelay("5.9", 20), 5);
    assert.equal(Backoff.normalizeDelay(-4, 20), 1);
    for (const value of [0, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
        assert.equal(Backoff.normalizeDelay(value, 20), 20);
    }
});

test("failure log backoff preserves key identity, caps delays, and recovers", () => {
    const messages = [];
    const firstKey = {};
    const secondKey = {};
    const backoff = new Backoff.FailureLogBackoff({
        emit: (message) => messages.push(message),
        initialDelayMs: 10,
        maximumDelayMs: 25,
    });

    assert.equal(backoff.report(firstKey, "first-1", 0), true);
    assert.equal(backoff.report(firstKey, "suppressed", 9), false);
    assert.equal(backoff.report(secondKey, "second-1", 9), true);
    assert.equal(backoff.report(firstKey, "first-2", 10), true);
    assert.equal(backoff.report(firstKey, "suppressed", 29), false);
    assert.equal(backoff.report(firstKey, "first-3", 30), true);
    assert.equal(backoff.report(firstKey, "suppressed", 54), false);
    assert.equal(backoff.report(firstKey, "first-4", 55), true);
    assert.deepEqual(messages, ["first-1", "second-1", "first-2", "first-3", "first-4"]);
    assert.equal(backoff.recover("missing"), false);
    assert.equal(backoff.recover(firstKey), true);
    assert.equal(backoff.report(firstKey, "after-recovery", 55), true);
});

test("failure log backoff resets after backward or invalid time", () => {
    const messages = [];
    const backoff = new Backoff.FailureLogBackoff({
        emit: (message) => messages.push(message),
        initialDelayMs: 10,
        maximumDelayMs: 20,
    });

    assert.equal(backoff.report("read", "first", 100), true);
    assert.equal(backoff.report("read", "suppressed", 105), false);
    assert.equal(backoff.report("read", "rollback", 90), true);
    assert.equal(backoff.report("read", "rollback-suppressed", 99), false);
    assert.equal(backoff.report("read", "rollback-due", 100), true);
    assert.equal(backoff.report("invalid", "invalid-first", Number.POSITIVE_INFINITY), true);
    assert.equal(backoff.report("invalid", "invalid-suppressed", Number.NaN), false);
    assert.equal(backoff.report("invalid", "invalid-due", 10), true);
    assert.deepEqual(messages, [
        "first",
        "rollback",
        "rollback-due",
        "invalid-first",
        "invalid-due",
    ]);
});
