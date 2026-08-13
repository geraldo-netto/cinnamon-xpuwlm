"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {BackgroundExecution} = require("../../files/cinnamon-xpuwlm@geraldo-netto/lib/background-execution.js");
const {FakeTimer, leasePort} = require("../helpers/background-execution-fixture.js");

test("stress: event bursts stay bounded and interactive work preempts promptly", async () => {
    const timer = new FakeTimer();
    const log = [];
    let started;
    const backgroundStarted = new Promise((resolve) => { started = resolve; });
    const execution = new BackgroundExecution({
        timer, leasePort: leasePort(log), reportError: () => {}, maxQueued: 8,
    });
    for (let index = 0; index < 32; index += 1) {
        execution.register({
            id: `worker-${index}`,
            trigger: {kind: "event", event: "burst"},
            run: index === 0
                ? async ({signal}) => {
                    started();
                    await new Promise((resolve) => signal.onCancel(resolve));
                }
                : async () => log.push(["background", index]),
        });
    }
    for (let iteration = 0; iteration < 10_000; iteration += 1) {
        const results = execution.emit("burst", iteration);
        assert.equal(results.length, 32);
        assert.equal(execution.state().queuedIds.length <= 8, true);
        assert.equal(timer.count(0), 1);
    }
    assert.equal(log.length, 0, "ten thousand event callbacks must not run a workload inline");
    timer.fireDelay(0);
    await backgroundStarted;
    const result = await execution.runInteractive({
        id: "interactive",
        run: async () => {
            log.push(["interactive"]);
            return "done";
        },
    });
    assert.equal(result, "done");
    assert.deepEqual(log.filter((entry) => entry[0] === "interactive"), [["interactive"]]);
    assert.equal(log.some((entry) => entry[0] === "background"), false);
    execution.dispose();
    await execution.idle();
});
