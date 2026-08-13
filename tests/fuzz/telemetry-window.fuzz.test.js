"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {TelemetryWindow} = require("../../files/cinnamon-xpuwlm@geraldo-netto/lib/telemetry-window.js");

function generator(seed) {
    let state = seed >>> 0;
    return () => {
        state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
        return state / 0x1_0000_0000;
    };
}

test("fuzz: replay remains bounded, ordered, redacted, and recoverable", () => {
    const random = generator(0x54454c45);
    let time = 0;
    const telemetry = new TelemetryWindow({
        clock: () => time += Math.floor(random() * 3),
        redact: (raw) => ({load: raw.load, present: raw.present}),
        featureSchema: {version: 7, names: ["load", "present"]},
        maxSamples: 32,
        retentionMs: 50,
    });
    telemetry.setConsent(true);
    let lost = false;
    for (let iteration = 0; iteration < 2000; iteration += 1) {
        if (!lost && random() < 0.15) {
            telemetry.markMissing("device", "read-failed");
            lost = true;
        } else if (lost && random() < 0.5) {
            telemetry.recover("device");
            lost = false;
        } else if (!lost) {
            telemetry.capture("device", {
                load: random() * 100,
                present: random() < 0.9,
                secret: `raw-${iteration}`,
            });
        }
        const replay = telemetry.replay({afterSequence: 0, limit: 17});
        assert.equal(replay.entries.length <= 17, true);
        assert.equal(replay.entries.every((entry, index, entries) => (
            index === 0 || entries[index - 1].sequence < entry.sequence
        )), true);
        assert.equal(JSON.stringify(replay).includes("raw-"), false);
    }
});
