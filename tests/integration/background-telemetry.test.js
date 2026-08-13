"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {BackgroundExecution} = require("../../files/cinnamon-xpuwlm@geraldo-netto/lib/background-execution.js");
const {TelemetryWindow} = require("../../files/cinnamon-xpuwlm@geraldo-netto/lib/telemetry-window.js");
const {FakeTimer, leasePort, drain} = require("../helpers/background-execution-fixture.js");

test("background jobs publish through the shared consented telemetry window", async () => {
    const timer = new FakeTimer();
    let time = 0;
    const telemetry = new TelemetryWindow({
        clock: () => time++,
        redact: ({queueDepth}) => ({"queue-depth": queueDepth}),
        featureSchema: {version: 1, names: ["queue-depth"]},
        maxSamples: 4,
        retentionMs: 100,
    });
    telemetry.setConsent(true);
    const execution = new BackgroundExecution({
        timer, leasePort: leasePort([]), reportError: () => {}, maxQueued: 2,
    });
    execution.register({
        id: "queue-health",
        trigger: {kind: "event", event: "queue-changed"},
        run: async ({payload}) => telemetry.capture("queue-health", payload),
    });
    execution.emit("queue-changed", {queueDepth: 3, privateJob: "do-not-retain"});
    await drain(execution, timer);

    const replay = telemetry.replay();
    assert.deepEqual(replay.entries[0].features, {"queue-depth": 3});
    assert.equal(JSON.stringify(replay).includes("privateJob"), false);
});
