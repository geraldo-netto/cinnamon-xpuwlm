"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const Backoff = require("../../files/cinnamon-xpuwlm@geraldo-netto/lib/failure-log-backoff.js");

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

// The two named subclasses are what production actually constructs: the applet
// hands one a Cinnamon logger and expects a missing method to be a
// construction error, not a crash on the first failure it tries to report.
test("the error and warning backoffs each require the method they emit through", () => {
    for (const [Subject, method, pattern] of [
        [Backoff.FailureErrorBackoff, "error", /error logger is required/u],
        [Backoff.FailureWarningBackoff, "warn", /warning logger is required/u],
    ]) {
        for (const logger of [null, undefined, {}, {[method]: true}, {other() {}}]) {
            assert.throws(() => new Subject({logger}), pattern, JSON.stringify(logger));
        }
        // A logger carrying the method is enough; the other one is not read.
        assert.doesNotThrow(() => new Subject({logger: {[method]: () => {}}}));
    }
});

test("each backoff emits through its own logger method and honours the same window", () => {
    const errors = [];
    const warnings = [];
    const failure = new Backoff.FailureErrorBackoff({
        logger: {error: (message) => errors.push(message), warn: () => {
            throw new Error("the error backoff must not warn");
        }},
        initialDelayMs: 1000,
        maximumDelayMs: 4000,
    });
    const warning = new Backoff.FailureWarningBackoff({
        logger: {warn: (message) => warnings.push(message), error: () => {
            throw new Error("the warning backoff must not error");
        }},
        initialDelayMs: 1000,
        maximumDelayMs: 4000,
    });

    assert.equal(failure.error("runtime", "runtime is gone", 0), true);
    assert.equal(failure.error("runtime", "runtime is gone", 500), false, "inside the window");
    assert.equal(failure.error("runtime", "runtime is gone", 1000), true);
    assert.deepEqual(errors, ["runtime is gone", "runtime is gone"]);

    assert.equal(warning.warn("inputs", "input root is gone", 0), true);
    assert.equal(warning.warn("inputs", "input root is gone", 500), false);
    assert.deepEqual(warnings, ["input root is gone"]);

    // Recovery forgets the key, so the next failure is reported immediately
    // rather than being swallowed by a window the user cannot see.
    assert.equal(warning.recover("inputs"), true);
    assert.equal(warning.recover("inputs"), false, "already recovered");
    assert.equal(warning.warn("inputs", "input root is gone", 600), true);
    assert.equal(warnings.length, 2);

    // The warning backoff coerces its key, so a caller passing a number and a
    // caller passing its text are the same failure rather than two.
    assert.equal(warning.warn(7, "numeric key", 0), true);
    assert.equal(warning.warn("7", "numeric key", 100), false, "the same key, coerced");
    assert.equal(warning.recover(7), true);
});
