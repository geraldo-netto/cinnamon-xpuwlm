"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const Domain = require("../../files/cinnamon-tpuwm@geraldo-netto/lib/domain.js");
const FailureBackoff = require("../../files/cinnamon-tpuwm@geraldo-netto/lib/failure-log-backoff.js");
const Runtime = require("../../files/cinnamon-tpuwm@geraldo-netto/lib/runtime-gateway.js");
const RuntimeSchema = require("../../files/cinnamon-tpuwm@geraldo-netto/lib/runtime-snapshot-schema-validator.js");
const ViewModel = require("../../files/cinnamon-tpuwm@geraldo-netto/lib/view-model.js");

const ROOT = path.resolve(__dirname, "../../files/cinnamon-tpuwm@geraldo-netto");
const NOW = 1_700_000_000_000;

test("regression: shared runtime modules contain no Node-only Buffer dependency", () => {
    for (const relativePath of [
        "lib/domain.js",
        "lib/runtime-gateway.js",
        "lib/runtime-snapshot-schema-validator.js",
        "lib/snapshot-validator.js",
        "lib/cinnamon-runtime.js",
    ]) {
        const source = fs.readFileSync(path.join(ROOT, relativePath), "utf8");
        assert.equal(/\bBuffer\b/u.test(source), false, `${relativePath} must remain CJS-compatible`);
    }
});

test("regression: Cinnamon root-resolution bridges export every nested dependency", () => {
    for (const moduleName of [
        "domain",
        "manager",
        "runtime-gateway",
        "runtime-snapshot-schema-validator",
        "snapshot-validator",
        "view-model",
    ]) {
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

test("regression: far-future snapshots cannot remain fresh indefinitely", () => {
    const snapshot = Domain.normalizeSnapshot({
        version: 1,
        generatedAt: NOW + 86_400_000,
        device: {available: true, name: "Coral", kind: "usb"},
    }, NOW);
    assert.equal(snapshot.source, "invalid");
    assert.equal(snapshot.device.available, false);
    assert.match(snapshot.device.reason, /timestamp/);
});

test("regression: UTF-8 size checks count encoded bytes, not UTF-16 units", () => {
    assert.equal(Runtime.byteLength("😀"), new TextEncoder().encode("😀").byteLength);
    const tooLarge = "😀".repeat(Math.floor(Runtime.MAX_SNAPSHOT_BYTES / 4) + 1);
    assert.match(Runtime.parseSnapshotDocument(
        tooLarge,
        NOW,
        new RuntimeSchema.RuntimeSnapshotSchemaValidator(),
    ).device.reason, /exceeds/);
});

test("regression: warning backoff never hides failure state or overruns after clock rollback", () => {
    const warnings = [];
    let nowMs = NOW;
    const gateway = new Runtime.RuntimeSnapshotGateway({
        path: "/unreadable/state.json",
        clock: {now: () => nowMs},
        readText() {
            throw new Error("permission denied");
        },
        detectDevice() {
            throw new Error("must not probe after read failure");
        },
        snapshotValidator: new RuntimeSchema.RuntimeSnapshotSchemaValidator(),
        warningReporter: new FailureBackoff.FailureWarningBackoff({
            logger: {warn: (message) => warnings.push(message)},
        }),
    });

    for (let poll = 0; poll < 20; poll += 1) {
        const snapshot = gateway.read();
        assert.equal(snapshot.source, "error");
        assert.equal(snapshot.device.available, false);
        assert.match(snapshot.device.reason, /could not be read/);
        nowMs += 1000;
    }
    assert.equal(warnings.length, 1);

    nowMs = NOW - 1000;
    const rolledBackSnapshot = gateway.read();
    assert.equal(rolledBackSnapshot.source, "error");
    assert.equal(rolledBackSnapshot.device.available, false);
    assert.equal(warnings.length, 2);
    gateway.read();
    assert.equal(warnings.length, 2);
});

test("regression: same-identity alert content invalidates before its age changes", () => {
    const profiles = new Domain.WorkloadPortfolio().list();
    const alert = {
        id: "stable-alert",
        profileId: "hardware-health",
        title: "Voltage drift",
        summary: "Review the supply",
        severity: "warning",
        timestamp: NOW,
        confidence: 0.2,
        riskScore: 0.3,
        resolved: false,
    };
    const state = {
        selectedTab: "alerts",
        paused: false,
        profiles,
        device: {available: true, name: "Coral USB", kind: "usb", reason: ""},
        metrics: {load: 42, queueDepth: 0, runningProfiles: 1},
        alerts: [alert],
        attentionCount: 1,
        stale: false,
        source: "runtime",
        generatedAt: NOW,
    };
    const initialKey = ViewModel.toViewModel(state, NOW).bodyKey;

    for (const [field, value] of Object.entries({
        title: "Critical voltage drift",
        summary: "Disconnect the supply",
        severity: "critical",
        confidence: 0.8,
        riskScore: 0.9,
    })) {
        const changedState = {...state, alerts: [{...alert, [field]: value}]};
        assert.notEqual(ViewModel.toViewModel(changedState, NOW).bodyKey, initialKey, field);
    }
});

test("regression: critical active alerts cannot be buried by runtime array order", () => {
    const profiles = new Domain.WorkloadPortfolio().list();
    const alert = (id, severity) => ({
        id,
        profileId: "hardware-health",
        title: id,
        severity,
        timestamp: NOW,
        resolved: false,
    });
    const model = ViewModel.toViewModel({
        selectedTab: "alerts",
        paused: false,
        profiles,
        device: {available: true, name: "Coral USB", kind: "usb", reason: ""},
        metrics: {load: 42, queueDepth: 0, runningProfiles: 1},
        alerts: [alert("advisory", "advisory"), alert("critical", "critical")],
        attentionCount: 2,
        stale: false,
        source: "runtime",
        generatedAt: NOW,
    }, NOW);

    assert.deepEqual(model.activeAlerts.map((item) => item.id), ["critical", "advisory"]);
});
