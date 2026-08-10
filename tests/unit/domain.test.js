"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const Domain = require("../../files/cinnamon-tpuwm@geraldo-netto/lib/domain.js");
const BuiltIns = require("../helpers/built-in-workloads.js");

const NOW = 1_700_000_000_000;
const CATALOG = BuiltIns.coreCatalog();
const DEFINITIONS = CATALOG.definitions();

function validSnapshot(overrides = {}) {
    return {
        version: Domain.SNAPSHOT_VERSION,
        generatedAt: NOW - 500,
        devices: [{
            id: "tpu-usb",
            backend: "tpu",
            available: true,
            name: "Coral USB",
            kind: "usb",
            load: 37.5,
            reason: "",
        }],
        metrics: {queueDepth: 4, runningProfiles: 2},
        profiles: {
            "hardware-health": {status: "running", queued: 3, detail: "sampling"},
        },
        alerts: [{
            id: "power-risk",
            profileId: "hardware-health",
            title: "Voltage drift",
            summary: "Review the recent voltage trend",
            severity: "warning",
            timestamp: NOW - 1000,
            confidence: 0.8,
            riskScore: 0.7,
            resolved: false,
        }],
        ...overrides,
    };
}

test("numeric and object helpers reject malformed values and clamp bounds", () => {
    assert.equal(Domain.isPlainObject({}), true);
    assert.equal(Domain.isPlainObject([]), false);
    assert.equal(Domain.isPlainObject(null), false);
    assert.equal(Domain.finiteNumber(2.5, 9), 2.5);
    assert.equal(Domain.finiteNumber(Number.NaN, 9), 9);
    assert.equal(Domain.boundedInteger(9.8, 1, 5, 2), 5);
    assert.equal(Domain.boundedInteger(-2, 1, 5, 2), 1);
    assert.equal(Domain.boundedInteger("4", 1, 5, 2), 2);
    assert.equal(Domain.boundedNumber(2.5, 0, 2, 1), 2);
    assert.equal(Domain.nullableBoundedNumber(0.7, 0, 1), 0.7);
    assert.equal(Domain.nullableBoundedNumber(7, 0, 1), 1);
    assert.equal(Domain.nullableBoundedNumber("0.7", 0, 1), null);
    assert.equal(Domain.nullableBoundedNumber(Number.POSITIVE_INFINITY, 0, 1), null);
    assert.equal(Domain.safeText("  hello  ", 3), "hel");
    assert.equal(Domain.safeText("a💡b", 2), "a💡");
    assert.equal(Domain.safeText("\ud800x", 2), "\ufffdx");
    assert.equal(Domain.safeText("bounded", Number.NaN), "");
    assert.equal(Domain.safeText("bounded", -1), "");
    assert.equal(Domain.safeText(9, 3, "fallback"), "fallback");
    assert.equal(Domain.clampWeight(99), Domain.MAX_WEIGHT);
    assert.equal(Domain.clampWeight(-99), Domain.MIN_WEIGHT);
});

test("freshness windows are finite, bounded, and centrally normalized", () => {
    for (const value of [
        0,
        "0",
        Number.NaN,
        Number.POSITIVE_INFINITY,
        Number.NEGATIVE_INFINITY,
    ]) {
        assert.equal(Domain.normalizeStaleAfterMs(value), Domain.DEFAULT_STALE_AFTER_MS);
    }
    assert.equal(Domain.normalizeStaleAfterMs(-1), 1000);
    assert.equal(Domain.normalizeStaleAfterMs(999), 1000);
    assert.equal(Domain.normalizeStaleAfterMs("2500"), 2500);
    assert.equal(Domain.normalizeStaleAfterMs(2500.5), 2500.5);
});

test("profile state defaults are complete and sanitization is allow-listed", () => {
    const defaults = Domain.defaultProfileState(CATALOG);
    assert.equal(defaults.paused, false);
    assert.equal(Object.keys(defaults.profiles).length, DEFINITIONS.length);
    assert.deepEqual(Domain.sanitizeProfileState(null, CATALOG), defaults);

    const result = Domain.sanitizeProfileState({
        paused: true,
        profiles: {
            "hardware-health": {enabled: false, weight: 99},
            "storage-intelligence": {enabled: "yes", weight: -20},
            unexpected: {enabled: true, weight: 5},
        },
    }, CATALOG);
    assert.equal(result.paused, true);
    assert.deepEqual(result.profiles["hardware-health"], {enabled: false, weight: 5});
    assert.deepEqual(result.profiles["storage-intelligence"], {enabled: true, weight: 1});
    assert.equal(Object.hasOwn(result.profiles, "unexpected"), false);
});

test("profile definitions use unique, verified symbolic icon names", () => {
    const icons = DEFINITIONS.map((profile) => profile.icon);
    assert.equal(icons.every((icon) => icon.endsWith("-symbolic")), true);
    assert.equal(new Set(icons).size, icons.length);
    assert.equal(icons.includes("applications-system-symbolic"), true);
    assert.equal(icons.includes("applications-engineering-symbolic"), true);
    assert.equal(icons.includes("view-dual-symbolic"), true);
    const visualLibrary = DEFINITIONS.find((profile) => profile.id === "visual-library");
    assert.doesNotMatch(visualLibrary.description, /low-light/u);
});

test("workload catalog injects profile identity and bounds into domain behavior", () => {
    const definition = {
        id: "custom-workload",
        title: "Custom workload",
        group: "Custom",
        description: "Injected domain profile",
        icon: "applications-science-symbolic",
        order: 10,
        defaultEnabled: false,
        defaultWeight: 4,
        executable: true,
    };
    const catalog = new Domain.WorkloadCatalog([definition]);
    definition.title = "Mutated";

    assert.equal(catalog.size, 1);
    assert.equal(catalog.has("custom-workload"), true);
    assert.equal(catalog.has("hardware-health"), false);
    assert.equal(catalog.definitions()[0].title, "Custom workload");
    assert.equal(Object.isFrozen(catalog.definitions()), true);
    assert.equal(Object.isFrozen(catalog.definitions()[0]), true);
    assert.deepEqual(Domain.defaultProfileState(catalog), {
        paused: false,
        profiles: {"custom-workload": {enabled: false, weight: 4}},
    });
    assert.deepEqual(
        Domain.normalizeMetrics({runningProfiles: 9}, catalog).runningProfiles,
        1,
    );
    assert.equal(Domain.normalizeAlert({
        id: "custom-alert",
        profileId: "custom-workload",
        title: "Custom alert",
    }, NOW, catalog).profileId, "custom-workload");
    assert.equal(Domain.normalizeAlert({
        id: "legacy-alert",
        profileId: "hardware-health",
        title: "Legacy alert",
    }, NOW, catalog), null);

    const portfolio = new Domain.WorkloadPortfolio(null, catalog);
    assert.equal(portfolio.list().length, 1);
    assert.equal(portfolio.profile("custom-workload").weight, 4);
    assert.throws(() => portfolio.profile("hardware-health"), /Unknown workload/u);
});

test("workload catalog rejects malformed and duplicate definitions", () => {
    const valid = {...DEFINITIONS[0]};
    assert.equal(Domain.isProfileDefinition(valid), true);
    assert.equal(Domain.hasProfileDefinitionShape(valid), true);
    assert.equal(Domain.hasProfileDefinitionIdentity(valid), true);
    assert.equal(Domain.hasProfileDefinitionText(valid), true);
    assert.equal(Domain.hasProfileDefinitionDefaults(valid), true);
    assert.equal(Domain.hasProfileDefinitionShape({...valid, extra: true}), false);
    assert.equal(Domain.hasProfileDefinitionIdentity({...valid, icon: "bad"}), false);
    assert.equal(Domain.hasProfileDefinitionText({...valid, title: ""}), false);
    assert.equal(Domain.hasProfileDefinitionDefaults({...valid, defaultWeight: 9}), false);
    assert.equal(Domain.isProfileDefinition(null), false);
    assert.throws(() => new Domain.WorkloadCatalog(null), /valid profile/u);
    assert.throws(() => new Domain.WorkloadCatalog([{}]), /valid profile/u);
    assert.throws(() => new Domain.WorkloadCatalog([valid, valid]), /unique/u);
    assert.equal(Domain.requireWorkloadCatalog(Domain.EMPTY_WORKLOAD_CATALOG), Domain.EMPTY_WORKLOAD_CATALOG);
    assert.throws(() => Domain.requireWorkloadCatalog({}), /catalog/u);
});

test("runtime fields preserve unknown measurements and reject unsafe content", () => {
    assert.deepEqual(Domain.normalizeProfileRuntime(null), {status: "idle", queued: 0, detail: ""});
    assert.deepEqual(Domain.normalizeProfileRuntime({status: "wrong", queued: -4, detail: 3}), {
        status: "idle",
        queued: 0,
        detail: "",
    });
    assert.equal(Domain.normalizeDeviceEntry(null), null);
    assert.deepEqual(
        Domain.normalizeDeviceEntry({backend: "tpu", available: true, name: 4, kind: "future", reason: 7}),
        {
            id: "device-0",
            backend: "tpu",
            available: true,
            state: "present",
            name: "TPU accelerator",
            kind: "unknown",
            vendor: "",
            load: null,
            reason: "",
        },
    );
    assert.deepEqual(Domain.normalizeMetrics({queueDepth: 1.9, runningProfiles: 99}, CATALOG), {
        queueDepth: 1,
        runningProfiles: DEFINITIONS.length,
    });
    assert.deepEqual(Domain.normalizeMetrics(null), {queueDepth: 0, runningProfiles: 0});
});

test("alerts require stable identities and normalize evidence", () => {
    assert.equal(Domain.normalizeAlert(null, NOW), null);
    assert.equal(Domain.normalizeAlert({id: "x", profileId: "unknown", title: "Bad"}, NOW), null);
    const alert = Domain.normalizeAlert({
        id: " id ",
        profileId: "hardware-health",
        title: " title ",
        severity: "future",
        timestamp: NOW + 90_000,
        confidence: -1,
        riskScore: "high",
        resolved: true,
    }, NOW, CATALOG);
    assert.deepEqual(alert, {
        id: "id",
        profileId: "hardware-health",
        title: "title",
        summary: "",
        severity: "advisory",
        timestamp: NOW + 60_000,
        confidence: 0,
        riskScore: null,
        resolved: true,
    });
});

test("snapshot normalization fails closed for invalid, unsupported, and stale input", () => {
    assert.equal(Domain.normalizeSnapshot(null, NOW).source, "invalid");
    assert.match(Domain.normalizeSnapshot({version: 2}, NOW).health.detail, /Unsupported/);
    assert.match(Domain.normalizeSnapshot({version: 1, generatedAt: 0}, NOW).health.detail, /timestamp/);
    assert.match(Domain.normalizeSnapshot({version: 1, generatedAt: NOW + 60_001}, NOW).health.detail, /timestamp/);
    assert.equal(Domain.normalizeSnapshot(validSnapshot({generatedAt: NOW + 60_000}), NOW).source, "runtime");
    const stale = Domain.normalizeSnapshot(validSnapshot({generatedAt: NOW - 3000}), NOW, 1000);
    assert.equal(stale.stale, true);
    assert.equal(stale.source, "runtime");
    assert.deepEqual(stale.devices, []);
    assert.equal(stale.health.device, "unknown");
    assert.equal(stale.generatedAt, NOW - 3000);
});

test("snapshot normalization accepts only known profiles and valid alerts", () => {
    const alerts = validSnapshot().alerts.concat({id: "bad", profileId: "missing", title: "Ignored"});
    const result = Domain.normalizeSnapshot(validSnapshot({
        profiles: {
            "hardware-health": {status: "running", queued: 3, detail: "sampling"},
            unknown: {status: "running"},
        },
        alerts,
    }), NOW, Domain.DEFAULT_STALE_AFTER_MS, CATALOG);
    assert.equal(result.source, "runtime");
    assert.equal(result.devices[0].available, true);
    assert.equal(result.devices[0].load, 37.5);
    assert.deepEqual(Object.keys(result.profiles), ["hardware-health"]);
    assert.equal(result.alerts.length, 1);
    assert.equal(result.alerts[0].severity, "warning");
});

test("connected snapshots expire on the clock independently of any reader", () => {
    const connected = Domain.normalizeSnapshot(
        validSnapshot({generatedAt: NOW}), NOW, Domain.DEFAULT_STALE_AFTER_MS, CATALOG,
    );
    const deadline = NOW + Domain.DEFAULT_STALE_AFTER_MS;

    assert.equal(Domain.snapshotExpiryDelayMs(connected, NOW), Domain.DEFAULT_STALE_AFTER_MS + 1);
    assert.equal(Domain.snapshotExpiryDelayMs(connected, deadline), 1);
    assert.equal(Domain.snapshotExpiryDelayMs(connected, deadline + 5000), 1);
    assert.equal(Domain.snapshotExpiryDelayMs(connected, NOW, 1000), 1001);

    assert.equal(Domain.isSnapshotExpired(connected, deadline), false);
    assert.equal(Domain.isSnapshotExpired(connected, deadline + 1), true);
    assert.equal(Domain.expireSnapshot(connected, deadline), connected);

    const expired = Domain.expireSnapshot(connected, deadline + 1);
    assert.equal(expired.stale, true);
    assert.equal(expired.source, "runtime");
    assert.deepEqual(expired.devices, []);
    assert.equal(expired.generatedAt, NOW);
    assert.match(expired.health.detail, /stale/u);
    assert.deepEqual(expired, Domain.normalizeSnapshot(validSnapshot({generatedAt: NOW}), deadline + 1));
});

test("snapshots without a live freshness deadline never expire on the clock", () => {
    const later = NOW + 10_000_000;
    for (const snapshot of [
        Domain.probeSnapshot([{id: "tpu-pcie-0", backend: "tpu", available: true, name: "PCIe", kind: "pcie"}], NOW),
        Domain.unavailableSnapshot("disconnected", NOW, "error"),
        Domain.staleSnapshot(NOW),
        null,
    ]) {
        assert.equal(Domain.snapshotExpiryDelayMs(snapshot, later), null);
        assert.equal(Domain.isSnapshotExpired(snapshot, later), false);
        assert.equal(Domain.expireSnapshot(snapshot, later), snapshot);
    }
});

test("snapshot normalization bounds the accepted alert list", () => {
    const template = validSnapshot().alerts[0];
    const overflowing = validSnapshot({
        alerts: Array.from({length: Domain.MAX_ALERTS + 1}, (_, index) => ({
            ...template,
            id: `alert-${index}`,
        })),
    });
    const normalized = Domain.normalizeSnapshot(
        overflowing, NOW, Domain.DEFAULT_STALE_AFTER_MS, CATALOG,
    );
    assert.equal(normalized.alerts.length, Domain.MAX_ALERTS);
    assert.equal(normalized.alerts.at(-1).id, `alert-${Domain.MAX_ALERTS - 1}`);

    const nonArray = Domain.normalizeSnapshot(validSnapshot({alerts: "not-an-array"}), NOW);
    assert.deepEqual(nonArray.alerts, []);
});

test("probe and unavailable snapshots carry explicit safe fallback state", () => {
    const unavailable = Domain.unavailableSnapshot(" disconnected ", NOW, "error");
    assert.equal(unavailable.health.detail, "disconnected");
    assert.equal(unavailable.metrics.queueDepth, null);
    assert.deepEqual(unavailable.devices, []);
    assert.equal(unavailable.source, "error");

    const probe = Domain.probeSnapshot(
        [{id: "tpu-pcie-0", backend: "tpu", available: true, name: "PCIe", kind: "pcie"}],
        NOW,
    );
    assert.equal(probe.source, "probe");
    assert.equal(probe.devices[0].available, true);
    assert.equal(probe.devices[0].kind, "pcie");
});

test("portfolio applies idempotent profile, weight, and global pause changes", () => {
    const portfolio = new Domain.WorkloadPortfolio({
        paused: false,
        profiles: {"hardware-health": {enabled: true, weight: 2}},
    }, CATALOG);
    assert.equal(portfolio.paused, false);
    assert.deepEqual(portfolio.profile("hardware-health"), {enabled: true, weight: 2});
    assert.equal(portfolio.setEnabled("hardware-health", true), false);
    assert.equal(portfolio.setEnabled("hardware-health", false), true);
    assert.equal(portfolio.adjustWeight("hardware-health", 99), true);
    assert.equal(portfolio.adjustWeight("hardware-health", 1), false);
    assert.equal(portfolio.pauseAll(), true);
    assert.equal(portfolio.pauseAll(), false);
    assert.equal(portfolio.resumeAll(), true);
    assert.equal(portfolio.resumeAll(), false);
    assert.throws(() => portfolio.profile("missing"), RangeError);

    portfolio.pauseAll();
    const listed = portfolio.list({"storage-intelligence": {status: "running", queued: 2}});
    assert.equal(listed.length, DEFINITIONS.length);
    assert.equal(listed.every((profile) => profile.status === "paused"), true);
    const serialized = portfolio.serialize();
    serialized.profiles["hardware-health"].weight = 1;
    assert.equal(portfolio.profile("hardware-health").weight, 5);
});

test("unknown-content counting tolerates every hostile collection shape", () => {
    const catalog = BuiltIns.coreCatalog();
    assert.equal(Domain.unknownProfileCount(null, catalog), 0);
    assert.equal(Domain.unknownProfileCount("profiles", catalog), 0);
    assert.equal(Domain.unknownProfileCount([], catalog), 0);
    assert.equal(Domain.unknownProfileCount({}, catalog), 0);
    assert.equal(Domain.unknownProfileCount({"hardware-health": {}}, catalog), 0);
    assert.equal(Domain.unknownProfileCount({missing: {}, "also-missing": {}}, catalog), 2);
    assert.equal(Domain.unknownProfileCount({missing: {}}), 1, "an empty catalog knows nobody");

    assert.equal(Domain.unknownAlertCount(null, catalog), 0);
    assert.equal(Domain.unknownAlertCount({}, catalog), 0);
    assert.equal(Domain.unknownAlertCount([null, 7, "alert"], catalog), 0);
    assert.equal(Domain.unknownAlertCount([{profileId: "hardware-health"}], catalog), 0);
    assert.equal(Domain.unknownAlertCount([{profileId: "missing"}, {}], catalog), 2);
    assert.equal(Domain.unknownAlertCount([{profileId: "hardware-health"}]), 1);
    // Only the alerts the contract admits are counted, matching what
    // normalization actually walks.
    assert.equal(
        Domain.unknownAlertCount(
            Array.from({length: Domain.MAX_ALERTS + 5}, () => ({profileId: "missing"})),
            catalog,
        ),
        Domain.MAX_ALERTS,
    );
});

module.exports = {NOW, validSnapshot};
