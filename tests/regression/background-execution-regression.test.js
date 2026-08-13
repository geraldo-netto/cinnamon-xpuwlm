"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {BackgroundExecution} = require("../../files/cinnamon-xpuwlm@geraldo-netto/lib/background-execution.js");
const {FakeTimer, leasePort, drain} = require("../helpers/background-execution-fixture.js");

test("regression: a release failure cannot strand the next background dispatch", async () => {
    const timer = new FakeTimer();
    const log = [];
    const errors = [];
    let releases = 0;
    const execution = new BackgroundExecution({
        timer,
        leasePort: leasePort(log, () => {
            releases += 1;
            if (releases === 1) {
                throw new Error("release failed");
            }
        }),
        reportError: (...args) => errors.push(args),
        maxQueued: 2,
    });
    for (const id of ["one", "two"]) {
        execution.register({id, trigger: {kind: "event", event: "tick"}, run: async () => {}});
        execution.triggerNow(id);
    }
    await drain(execution, timer);

    assert.equal(releases, 2);
    assert.equal(errors.length, 1);
    assert.match(errors[0][1].message, /release failed/u);
});
