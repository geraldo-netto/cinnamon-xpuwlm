"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const Cinnamon = require("../../files/cinnamon-tpuwm@geraldo-netto/lib/cinnamon-runtime.js");
const Domain = require("../../files/cinnamon-tpuwm@geraldo-netto/lib/domain.js");
const FailureBackoff = require("../../files/cinnamon-tpuwm@geraldo-netto/lib/failure-log-backoff.js");
const Manager = require("../../files/cinnamon-tpuwm@geraldo-netto/lib/manager.js");
const ViewModel = require("../../files/cinnamon-tpuwm@geraldo-netto/lib/view-model.js");

const NOW = 1_700_000_000_000;

function absentEnvironment() {
    return {
        Gio: {
            File: {new_for_path: () => ({query_exists: () => false})},
            FileQueryInfoFlags: {NOFOLLOW_SYMLINKS: 1},
        },
        GLib: {get_home_dir: () => "/home/tester", file_get_contents: () => [false, ""]},
        ByteArray: {toString: (value) => String(value)},
    };
}

function connectedDocument(overrides = {}) {
    return {
        version: Domain.SNAPSHOT_VERSION,
        generatedAt: NOW,
        device: {available: true, name: "Coral USB", kind: "usb", reason: ""},
        metrics: {load: 40, queueDepth: 3, runningProfiles: 1},
        profiles: {"hardware-health": {status: "running", queued: 3, detail: "sampling"}},
        alerts: [],
        ...overrides,
    };
}

test("device detection reports a complete structure in every branch", () => {
    assert.deepEqual(Cinnamon.detectDevice(absentEnvironment()), {
        available: false,
        name: "No TPU detected",
        kind: "unknown",
        reason: "Connect a Coral USB or PCIe Edge TPU",
    });
    assert.equal(Cinnamon.detectPcieDevice(absentEnvironment()), null);
    assert.equal(Cinnamon.detectUsbDevice(absentEnvironment()), null);

    const pcie = {
        ...absentEnvironment(),
        Gio: {
            File: {new_for_path: (path) => ({query_exists: () => path === "/dev/apex_0"})},
            FileQueryInfoFlags: {NOFOLLOW_SYMLINKS: 1},
        },
    };
    assert.deepEqual(Cinnamon.detectPcieDevice(pcie), {
        available: true,
        name: "Coral PCIe Edge TPU",
        kind: "pcie",
        reason: "",
    });

    assert.deepEqual(Cinnamon.CORAL_USB_IDENTITIES.map((identity) => ({...identity})), [
        {vendor: "18d1", product: "9302", name: "Coral USB Accelerator"},
        {vendor: "1a6e", product: "089a", name: "Coral USB Accelerator (DFU)"},
    ]);
    assert.deepEqual(
        Cinnamon.findCoralUsbIdentity("18d1", "9302"),
        Cinnamon.CORAL_USB_IDENTITIES[0],
    );
    assert.equal(Cinnamon.findCoralUsbIdentity("18d1", "089a"), null);
});

test("cached detection returns an isolated copy of the shared device record", () => {
    const detector = new Cinnamon.CachedDeviceDetector(absentEnvironment(), {now: () => NOW});
    const first = detector.detect();
    first.name = "mutated";
    first.available = true;
    const second = detector.detect();
    assert.equal(second.name, "No TPU detected");
    assert.equal(second.available, false);
    assert.notEqual(first, second);
});

test("the accepted enumerations stay closed and exact", () => {
    assert.deepEqual([...Domain.PROFILE_STATUSES], [
        "healthy", "running", "watching", "idle", "paused", "unavailable",
    ]);
    assert.deepEqual([...Domain.ALERT_SEVERITIES], ["advisory", "warning", "critical"]);
    assert.deepEqual([...Domain.PROFILE_IDS], Domain.PROFILE_DEFINITIONS.map((p) => p.id));
    assert.deepEqual(Manager.TABS, ["overview", "profiles", "alerts"]);
    assert.deepEqual(Object.keys(ViewModel.STATUS_LABELS), [...Domain.PROFILE_STATUSES]);
    assert.deepEqual(ViewModel.STATUS_LABELS, {
        healthy: "Healthy",
        running: "Running",
        watching: "Watching",
        idle: "Idle",
        paused: "Paused",
        unavailable: "Unavailable",
    });
    assert.deepEqual(ViewModel.ALERT_SEVERITY_PRIORITY, {advisory: 0, warning: 1, critical: 2});
    assert.deepEqual(
        [...Domain.ALERT_SEVERITIES].map((severity) => ViewModel.ALERT_SEVERITY_PRIORITY[severity]),
        [0, 1, 2],
    );
});

test("fallback, probe, and stale snapshots carry the complete snapshot structure", () => {
    assert.deepEqual(Domain.unavailableSnapshot("Disconnected", NOW, "error"), {
        version: Domain.SNAPSHOT_VERSION,
        generatedAt: NOW,
        stale: false,
        source: "error",
        device: {
            available: false,
            name: "No TPU detected",
            kind: "unknown",
            reason: "Disconnected",
        },
        metrics: {load: null, queueDepth: 0, runningProfiles: 0},
        profiles: {},
        alerts: [],
    });

    assert.deepEqual(Domain.probeSnapshot({available: true, name: "Coral USB", kind: "usb"}, NOW), {
        version: Domain.SNAPSHOT_VERSION,
        generatedAt: NOW,
        stale: false,
        source: "probe",
        device: {available: true, name: "Coral USB", kind: "usb", reason: ""},
        metrics: {load: null, queueDepth: 0, runningProfiles: 0},
        profiles: {},
        alerts: [],
    });

    assert.deepEqual(Domain.staleSnapshot(NOW), {
        version: Domain.SNAPSHOT_VERSION,
        generatedAt: NOW,
        stale: true,
        source: "runtime",
        device: {
            available: false,
            name: "No TPU detected",
            kind: "unknown",
            reason: "Runtime snapshot is stale",
        },
        metrics: {load: null, queueDepth: 0, runningProfiles: 0},
        profiles: {},
        alerts: [],
    });
});

test("normalized runtime fragments expose exactly their contract fields", () => {
    assert.deepEqual(Domain.normalizeDevice(null), {
        available: false,
        name: "No TPU detected",
        kind: "unknown",
        reason: "Device state is missing",
    });
    assert.deepEqual(Domain.normalizeMetrics(undefined), {
        load: null,
        queueDepth: 0,
        runningProfiles: 0,
    });
    assert.deepEqual(Domain.normalizeProfileRuntime(undefined), {
        status: "idle",
        queued: 0,
        detail: "",
    });
    assert.deepEqual(Domain.normalizeAlert({
        id: "power-risk",
        profileId: "hardware-health",
        title: "Voltage drift",
    }, NOW), {
        id: "power-risk",
        profileId: "hardware-health",
        title: "Voltage drift",
        summary: "",
        severity: "advisory",
        timestamp: NOW,
        confidence: null,
        riskScore: null,
        resolved: false,
    });
});

test("default state and portfolio serialization cover every declared profile", () => {
    const defaults = Domain.defaultProfileState();
    assert.deepEqual(Object.keys(defaults), ["paused", "profiles"]);
    assert.equal(defaults.paused, false);
    assert.deepEqual(
        Object.keys(defaults.profiles),
        Domain.PROFILE_DEFINITIONS.map((definition) => definition.id),
    );
    for (const definition of Domain.PROFILE_DEFINITIONS) {
        assert.deepEqual(defaults.profiles[definition.id], {
            enabled: definition.defaultEnabled,
            weight: definition.defaultWeight,
        });
        assert.deepEqual(Object.keys(definition), [
            "id", "title", "group", "description", "icon", "defaultEnabled", "defaultWeight",
        ]);
    }

    const portfolio = new Domain.WorkloadPortfolio();
    assert.deepEqual(portfolio.serialize(), defaults);
    const serialized = portfolio.serialize();
    serialized.paused = true;
    serialized.profiles["hardware-health"].weight = 5;
    assert.deepEqual(portfolio.serialize(), defaults);

    const listed = portfolio.list();
    assert.deepEqual(Object.keys(listed[0]), [
        "id", "title", "group", "description", "icon", "defaultEnabled", "defaultWeight",
        "enabled", "weight", "status", "queued", "detail",
    ]);
    listed[0].title = "mutated";
    assert.equal(portfolio.list()[0].title, "Hardware health");
    assert.notEqual(portfolio.profile("hardware-health"), portfolio.profile("hardware-health"));
});

test("manager projections are complete and isolated from listener mutation", () => {
    const manager = new Manager.WorkloadManager({
        repository: {load: () => ({}), save() {}},
        runtimeGateway: {
            read: () => Domain.normalizeSnapshot(connectedDocument({
                alerts: [{
                    id: "power-risk",
                    profileId: "hardware-health",
                    title: "Voltage drift",
                    summary: "Review",
                    severity: "warning",
                    timestamp: NOW,
                }],
            }), NOW),
        },
        errorReporter: new FailureBackoff.FailureErrorBackoff({logger: {error() {}}}),
        clock: {now: () => NOW},
    });
    manager.start();

    const state = manager.state();
    assert.deepEqual(Object.keys(state), [
        "selectedTab", "paused", "profiles", "device", "metrics", "alerts",
        "attentionCount", "stale", "source", "generatedAt",
    ]);
    assert.deepEqual(state.device, {
        available: true,
        name: "Coral USB",
        kind: "usb",
        reason: "",
    });
    assert.deepEqual(state.metrics, {load: 40, queueDepth: 3, runningProfiles: 1});
    assert.equal(state.profiles.length, Domain.PROFILE_DEFINITIONS.length);
    assert.equal(state.alerts.length, 1);
    assert.equal(state.attentionCount, 1);

    state.device.name = "mutated";
    state.metrics.load = 99;
    state.alerts[0].title = "mutated";
    state.profiles[0].weight = 99;
    const next = manager.state();
    assert.equal(next.device.name, "Coral USB");
    assert.equal(next.metrics.load, 40);
    assert.equal(next.alerts[0].title, "Voltage drift");
    assert.equal(next.profiles[0].weight, 2);
    manager.dispose();
});
