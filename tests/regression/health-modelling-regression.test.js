"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const Domain = require("../../files/cinnamon-tpuwm@geraldo-netto/lib/domain.js");
const BuiltIns = require("../helpers/built-in-workloads.js");
const FailureBackoff = require("../../files/cinnamon-tpuwm@geraldo-netto/lib/failure-log-backoff.js");
const Manager = require("../../files/cinnamon-tpuwm@geraldo-netto/lib/manager.js");
const Runtime = require("../../files/cinnamon-tpuwm@geraldo-netto/lib/runtime-gateway.js");
const RuntimeSchema = require("../../files/cinnamon-tpuwm@geraldo-netto/lib/runtime-snapshot-schema-validator.js");
const ViewModel = require("../../files/cinnamon-tpuwm@geraldo-netto/lib/view-model.js");
const {readSnapshot} = require("../helpers/fakes.js");

const NOW = 1_700_000_000_000;

function gateway(overrides = {}) {
    return new Runtime.RuntimeSnapshotGateway({
        path: "/run/tpuwm.json",
        clock: {now: () => NOW},
        readTextAsync: (filename, options, callback) => callback(null, null),
        detectDevice: () => [{id: "tpu-usb", backend: "tpu", available: true, name: "Coral USB", kind: "usb"}],
        snapshotValidator: new RuntimeSchema.RuntimeSnapshotSchemaValidator(),
        warningReporter: new FailureBackoff.FailureWarningBackoff({logger: {warn() {}}}),
        workloadCatalog: BuiltIns.coreCatalog(),
        ...overrides,
    });
}

function connectedDocument(overrides = {}) {
    return JSON.stringify({
        version: Domain.SNAPSHOT_VERSION,
        generatedAt: NOW,
        devices: [{
            id: "tpu-usb",
            backend: "tpu",
            available: true,
            name: "Coral USB",
            kind: "usb",
            load: 40,
            reason: "",
        }],
        metrics: {queueDepth: 3, runningProfiles: 1},
        profiles: {},
        alerts: [],
        ...overrides,
    });
}

test("regression: an unreadable runtime never claims the device is absent", () => {
    const snapshot = readSnapshot(gateway({
        readTextAsync(filename, options, callback) { callback(new Error("permission denied"), null); },
    }));

    assert.deepEqual(snapshot.health, {
        device: "unknown",
        runtime: "unreadable",
        detail: "Runtime snapshot could not be read",
    });
    assert.deepEqual(snapshot.devices, []);
});

test("regression: a malformed document reports malformed, not a missing device", () => {
    const snapshot = readSnapshot(gateway({
        readTextAsync: (filename, options, callback) => callback(null, "{\"version\":1}"),
    }));
    assert.equal(snapshot.health.runtime, "malformed");
    assert.equal(snapshot.health.device, "unknown");
    assert.deepEqual(snapshot.devices, []);
});

test("regression: failed discovery reports probe failure, not an absent device", () => {
    const snapshot = readSnapshot(gateway({
        detectDevice() { throw new Error("sysfs unavailable"); },
    }));
    assert.equal(snapshot.health.runtime, "probe-failed");
    assert.equal(snapshot.health.device, "unknown");
});

test("regression: a detected device with no runtime keeps both facts separate", () => {
    const snapshot = readSnapshot(gateway());
    assert.deepEqual(snapshot.health, {
        device: "present",
        runtime: "absent",
        detail: "No runtime service is publishing a snapshot",
    });
    assert.equal(snapshot.devices[0].available, true);
});

test("regression: a connected runtime reports both device and runtime health", () => {
    const present = readSnapshot(gateway({
        readTextAsync: (filename, options, callback) => callback(null, connectedDocument()),
    }));
    assert.deepEqual(present.health, {device: "present", runtime: "connected", detail: ""});

    const absent = readSnapshot(gateway({
        readTextAsync: (filename, options, callback) => callback(null, connectedDocument({
            devices: [{
                id: "tpu-usb",
                backend: "tpu",
                available: false,
                name: "No TPU detected",
                kind: "unknown",
                reason: "Unplugged",
            }],
        })),
    }));
    assert.deepEqual(absent.health, {
        device: "absent",
        runtime: "connected",
        detail: "Unplugged",
    });
});

test("regression: unknown telemetry is shown as unknown, never as zero", () => {
    for (const snapshot of [
        readSnapshot(gateway({
            readTextAsync(filename, options, callback) { callback(new Error("denied"), null); },
        })),
        readSnapshot(gateway()),
        Domain.staleSnapshot(NOW),
    ]) {
        assert.equal(snapshot.metrics.queueDepth, null, snapshot.health.runtime);
        assert.equal(snapshot.metrics.runningProfiles, null, snapshot.health.runtime);
    }

    const connected = readSnapshot(gateway({
        readTextAsync: (filename, options, callback) => callback(null, connectedDocument()),
    }));
    assert.deepEqual(connected.metrics, {queueDepth: 3, runningProfiles: 1});
    assert.equal(connected.devices[0].load, 40);
});

test("regression: each runtime state renders its own recovery guidance", () => {
    const seen = new Set();
    for (const runtime of [...Domain.RUNTIME_STATES]) {
        const state = {
            selectedTab: "overview",
            paused: false,
            profiles: [],
            device: Domain.aggregateDevice([], "Detail for the state"),
            devices: [],
            health: {device: "unknown", runtime, detail: `Detail for ${runtime}`},
            metrics: {queueDepth: null, runningProfiles: null},
            alerts: [],
            attentionCount: 0,
            stale: false,
            source: "invalid",
            generatedAt: NOW,
        };
        const model = ViewModel.toViewModel(state, NOW);
        assert.equal(model.screen, "unavailable", runtime);
        assert.equal(model.runtimeStatus, ViewModel.RUNTIME_STATUS_LABELS[runtime], runtime);
        assert.equal(model.recovery.steps.length, 3, runtime);
        assert.equal(model.recovery.steps.at(-1).description, `Detail for ${runtime}`, runtime);
        assert.equal(model.metrics[1].value, "—", runtime);
        assert.equal(model.metrics[2].value, "—", runtime);
        seen.add(model.recovery.title);
    }
    assert.equal(seen.size, Domain.RUNTIME_STATES.size);
});

test("regression: the manager projects health and starts in a not-started state", () => {
    const manager = new Manager.WorkloadManager({
        workloadRegistry: BuiltIns.coreRegistry(),
        repository: {load: () => ({}), save() {}},
        runtimeGateway: {read: (options, callback) => callback(readSnapshot(gateway()))},
        errorReporter: {report() {}, recover() {}},
        clock: {now: () => NOW},
    });
    assert.deepEqual(manager.state().health, {
        device: "unknown",
        runtime: "not-started",
        detail: "Monitoring has not started",
    });
    manager.start();
    assert.deepEqual(manager.state().health, {
        device: "present",
        runtime: "absent",
        detail: "No runtime service is publishing a snapshot",
    });
    manager.dispose();
});

test("regression: an unrecognised health value degrades to an explicit unknown", () => {
    assert.deepEqual(Domain.health("future", "future", "detail"), {
        device: "unknown",
        runtime: "unreadable",
        detail: "detail",
    });
    const state = {
        selectedTab: "overview",
        paused: false,
        profiles: [],
        device: Domain.aggregateDevice([], "No health reported"),
        devices: [],
        metrics: {queueDepth: null, runningProfiles: null},
        alerts: [],
        attentionCount: 0,
        stale: false,
        source: "invalid",
        generatedAt: NOW,
    };
    const model = ViewModel.toViewModel(state, NOW);
    assert.deepEqual(model.health, {device: "unknown", runtime: "unreadable", detail: ""});
    assert.equal(model.device.status, "Device unknown");
    assert.equal(model.recovery.steps.at(-1).description, "No health reported");

    const forged = ViewModel.toViewModel({
        ...state,
        health: {device: "future", runtime: "future", detail: "Forged health"},
    }, NOW);
    assert.equal(forged.runtimeStatus, ViewModel.RUNTIME_STATUS_LABELS.unreadable);
    assert.equal(forged.device.status, ViewModel.DEVICE_STATUS_LABELS.unknown);
    assert.equal(forged.recovery.title, ViewModel.RUNTIME_RECOVERY.connected.title);
    assert.equal(forged.recovery.steps.at(-1).description, "Forged health");
});
