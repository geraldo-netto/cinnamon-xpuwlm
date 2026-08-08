"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const Domain = require("../../files/cinnamon-tpuwm@geraldo-netto/lib/domain.js");
const FailureBackoff = require("../../files/cinnamon-tpuwm@geraldo-netto/lib/failure-log-backoff.js");
const Manager = require("../../files/cinnamon-tpuwm@geraldo-netto/lib/manager.js");

function generator(seed) {
    let state = seed >>> 0;
    return () => {
        state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
        return state / 0x100000000;
    };
}

test("fuzz: manager error channels preserve bounded exponential transitions", () => {
    const random = generator(0x4552524f);
    const errors = [];
    const initialDelayMs = 4;
    const maximumDelayMs = 32;
    const backoff = new FailureBackoff.FailureErrorBackoff({
        logger: {error: (message) => errors.push(message)},
        initialDelayMs,
        maximumDelayMs,
    });
    const channels = [{name: "view-a"}, {name: "view-b"}, {name: "runtime"}];
    let nowMs = 0;

    for (let cycle = 0; cycle < 100; cycle += 1) {
        const channel = channels[cycle % channels.length];
        assert.equal(backoff.recover(channel), cycle >= channels.length);
        let delayMs = initialDelayMs;
        assert.equal(backoff.error(channel, `first-${cycle}`, nowMs), true);
        for (let emission = 0; emission < 20; emission += 1) {
            const beforeDeadline = Math.floor(random() * delayMs);
            assert.equal(backoff.error(channel, "suppressed", nowMs + beforeDeadline), false);
            nowMs += delayMs;
            assert.equal(backoff.error(channel, `due-${cycle}-${emission}`, nowMs), true);
            delayMs = Math.min(delayMs * 2, maximumDelayMs);
        }
        nowMs += 1;
    }
    assert.equal(errors.length, 2100);
});

test("fuzz: listener lifecycle releases every reporter identity", () => {
    const random = generator(0x4c494645);
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
        repository: {load: () => ({}), save() {}},
        runtimeGateway: {
            read: (options, callback) => callback(Domain.probeSnapshot({available: true, name: "TPU", kind: "usb"}, 0)),
        },
        clock: {now: () => 0},
        errorReporter,
    });
    const subscriptions = [];
    for (let index = 0; index < 256; index += 1) {
        const shouldFail = random() < 0.75;
        subscriptions.push(manager.subscribe(() => {
            if (shouldFail) {
                throw new Error("render failure");
            }
        }));
    }
    manager.start();
    assert.equal(retainedKeys.size > 0, true);
    for (const unsubscribe of subscriptions) {
        if (random() < 0.5) {
            unsubscribe();
        }
    }
    manager.dispose();
    assert.equal(retainedKeys.size, 0);
});
