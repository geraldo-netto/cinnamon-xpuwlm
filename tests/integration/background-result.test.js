"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {BackgroundExecution} = require(
    "../../files/cinnamon-xpuwlm@geraldo-netto/lib/background-execution.js"
);
const Result = require("../../files/cinnamon-xpuwlm@geraldo-netto/lib/workload-result.js");
const {FakeTimer, leasePort, drain} = require("../helpers/background-execution-fixture.js");
const {valid} = require("../helpers/workload-result-fixture.js");

test("background execution publishes a typed immutable workload result", async () => {
    const timer = new FakeTimer();
    const published = [];
    const execution = new BackgroundExecution({
        timer, leasePort: leasePort([]), reportError: () => {}, maxQueued: 2,
    });
    execution.register({
        id: "queue-health",
        trigger: {kind: "event", event: "queue-changed"},
        run: async () => published.push(Result.createWorkloadResult(valid("forecast"))),
    });
    execution.emit("queue-changed");
    await drain(execution, timer);

    assert.equal(published.length, 1);
    assert.equal(Result.isWorkloadResult(published[0]), true);
    assert.equal(Object.isFrozen(published[0].payload.points), true);
});
