"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {TelemetryWindow} = require("../../files/cinnamon-xpuwlm@geraldo-netto/lib/telemetry-window.js");

test("regression: raw telemetry is never retained and consent revocation resets cursors", () => {
    let time = 1;
    const telemetry = new TelemetryWindow({
        clock: () => time++,
        redact: ({value}) => ({value}),
        featureSchema: {version: 1, names: ["value"]},
        maxSamples: 2,
        retentionMs: 100,
    });
    telemetry.setConsent(true);
    telemetry.capture("source", {value: 4, password: "do-not-retain"});
    const first = telemetry.replay();
    assert.equal(JSON.stringify(first).includes("password"), false);
    assert.equal(JSON.stringify(first).includes("do-not-retain"), false);

    telemetry.setConsent(false);
    telemetry.setConsent(true);
    const second = telemetry.capture("source", {value: 5, password: "still-private"});
    assert.equal(second.sequence, 1);
});
