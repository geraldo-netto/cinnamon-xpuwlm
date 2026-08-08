"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const Domain = require("../../lib/domain.js");
const Runtime = require("../../lib/runtime-gateway.js");

const ROOT = path.resolve(__dirname, "../..");
const NOW = 1_700_000_000_000;

test("regression: shared runtime modules contain no Node-only Buffer dependency", () => {
    for (const relativePath of ["lib/domain.js", "lib/runtime-gateway.js", "lib/cinnamon-runtime.js"]) {
        const source = fs.readFileSync(path.join(ROOT, relativePath), "utf8");
        assert.equal(/\bBuffer\b/u.test(source), false, `${relativePath} must remain CJS-compatible`);
    }
});

test("regression: Cinnamon root-resolution bridges export every nested dependency", () => {
    for (const moduleName of ["domain", "manager", "runtime-gateway", "view-model"]) {
        const bridge = require(path.join(ROOT, `${moduleName}.js`));
        const implementation = require(path.join(ROOT, "lib", `${moduleName}.js`));
        assert.equal(bridge, implementation);
    }
});

test("regression: malformed nullable measurements remain unknown rather than zero", () => {
    const snapshot = Domain.normalizeSnapshot({
        version: 1,
        generatedAt: NOW,
        device: {available: true},
        metrics: {load: "0", queueDepth: 0, runningProfiles: 0},
        profiles: {},
        alerts: [{
            id: "a",
            profileId: "hardware-health",
            title: "Risk",
            timestamp: NOW,
            confidence: "0",
            riskScore: false,
        }],
    }, NOW);
    assert.equal(snapshot.metrics.load, null);
    assert.equal(snapshot.alerts[0].confidence, null);
    assert.equal(snapshot.alerts[0].riskScore, null);
});

test("regression: stale snapshots cannot display a connected device", () => {
    const snapshot = Domain.normalizeSnapshot({
        version: 1,
        generatedAt: NOW - 10_001,
        device: {available: true, name: "Coral", kind: "usb"},
    }, NOW, 10_000);
    assert.equal(snapshot.stale, true);
    assert.equal(snapshot.device.available, false);
    assert.equal(snapshot.source, "runtime");
});

test("regression: UTF-8 size checks count encoded bytes, not UTF-16 units", () => {
    assert.equal(Runtime.byteLength("😀"), new TextEncoder().encode("😀").byteLength);
    const tooLarge = "😀".repeat(Math.floor(Runtime.MAX_SNAPSHOT_BYTES / 4) + 1);
    assert.match(Runtime.parseSnapshotDocument(tooLarge, NOW).device.reason, /exceeds/);
});
