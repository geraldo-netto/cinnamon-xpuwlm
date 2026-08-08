"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const Domain = require("../../lib/domain.js");

const NOW = 1_700_000_000_000;

function validSnapshot(overrides = {}) {
    return {
        version: Domain.SNAPSHOT_VERSION,
        generatedAt: NOW - 500,
        device: {available: true, name: "Coral USB", kind: "usb", reason: ""},
        metrics: {load: 37.5, queueDepth: 4, runningProfiles: 2},
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
    assert.equal(Domain.safeText(9, 3, "fallback"), "fallback");
    assert.equal(Domain.clampWeight(99), Domain.MAX_WEIGHT);
    assert.equal(Domain.clampWeight(-99), Domain.MIN_WEIGHT);
});

test("profile state defaults are complete and sanitization is allow-listed", () => {
    const defaults = Domain.defaultProfileState();
    assert.equal(defaults.paused, false);
    assert.equal(Object.keys(defaults.profiles).length, Domain.PROFILE_DEFINITIONS.length);
    assert.deepEqual(Domain.sanitizeProfileState(null), defaults);

    const result = Domain.sanitizeProfileState({
        paused: true,
        profiles: {
            "hardware-health": {enabled: false, weight: 99},
            "storage-intelligence": {enabled: "yes", weight: -20},
            unexpected: {enabled: true, weight: 5},
        },
    });
    assert.equal(result.paused, true);
    assert.deepEqual(result.profiles["hardware-health"], {enabled: false, weight: 5});
    assert.deepEqual(result.profiles["storage-intelligence"], {enabled: true, weight: 1});
    assert.equal(Object.hasOwn(result.profiles, "unexpected"), false);
});

test("profile definitions use unique, verified symbolic icon names", () => {
    const icons = Domain.PROFILE_DEFINITIONS.map((profile) => profile.icon);
    assert.equal(icons.every((icon) => icon.endsWith("-symbolic")), true);
    assert.equal(new Set(icons).size, icons.length);
    assert.equal(icons.includes("applications-system-symbolic"), true);
    assert.equal(icons.includes("applications-engineering-symbolic"), true);
    assert.equal(icons.includes("view-dual-symbolic"), true);
});

test("runtime fields preserve unknown measurements and reject unsafe content", () => {
    assert.deepEqual(Domain.normalizeProfileRuntime(null), {status: "idle", queued: 0, detail: ""});
    assert.deepEqual(Domain.normalizeProfileRuntime({status: "wrong", queued: -4, detail: 3}), {
        status: "idle",
        queued: 0,
        detail: "",
    });
    assert.deepEqual(Domain.normalizeDevice(null), {
        available: false,
        name: "No TPU detected",
        kind: "unknown",
        reason: "Device state is missing",
    });
    assert.deepEqual(Domain.normalizeDevice({available: true, name: 4, kind: "future", reason: 7}), {
        available: true,
        name: "TPU accelerator",
        kind: "unknown",
        reason: "",
    });
    assert.deepEqual(Domain.normalizeMetrics({load: "invalid", queueDepth: 1.9, runningProfiles: 99}), {
        load: null,
        queueDepth: 1,
        runningProfiles: Domain.PROFILE_DEFINITIONS.length,
    });
    assert.deepEqual(Domain.normalizeMetrics(null), {load: null, queueDepth: 0, runningProfiles: 0});
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
    }, NOW);
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
    assert.match(Domain.normalizeSnapshot({version: 2}, NOW).device.reason, /Unsupported/);
    assert.match(Domain.normalizeSnapshot({version: 1, generatedAt: 0}, NOW).device.reason, /timestamp/);
    assert.match(Domain.normalizeSnapshot({version: 1, generatedAt: NOW + 60_001}, NOW).device.reason, /timestamp/);
    assert.equal(Domain.normalizeSnapshot(validSnapshot({generatedAt: NOW + 60_000}), NOW).source, "runtime");
    const stale = Domain.normalizeSnapshot(validSnapshot({generatedAt: NOW - 3000}), NOW, 1000);
    assert.equal(stale.stale, true);
    assert.equal(stale.source, "runtime");
    assert.equal(stale.device.available, false);
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
    }), NOW);
    assert.equal(result.source, "runtime");
    assert.equal(result.device.available, true);
    assert.equal(result.metrics.load, 37.5);
    assert.deepEqual(Object.keys(result.profiles), ["hardware-health"]);
    assert.equal(result.alerts.length, 1);
    assert.equal(result.alerts[0].severity, "warning");
});

test("probe and unavailable snapshots carry explicit safe fallback state", () => {
    const unavailable = Domain.unavailableSnapshot(" disconnected ", NOW, "error");
    assert.equal(unavailable.device.reason, "disconnected");
    assert.equal(unavailable.metrics.load, null);
    assert.equal(unavailable.source, "error");

    const probe = Domain.probeSnapshot({available: true, name: "PCIe", kind: "pcie"}, NOW);
    assert.equal(probe.source, "probe");
    assert.equal(probe.device.available, true);
    assert.equal(probe.device.kind, "pcie");
});

test("portfolio applies idempotent profile, weight, and global pause changes", () => {
    const portfolio = new Domain.WorkloadPortfolio({
        paused: false,
        profiles: {"hardware-health": {enabled: true, weight: 2}},
    });
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
    assert.equal(listed.length, Domain.PROFILE_DEFINITIONS.length);
    assert.equal(listed.every((profile) => profile.status === "paused"), true);
    const serialized = portfolio.serialize();
    serialized.profiles["hardware-health"].weight = 1;
    assert.equal(portfolio.profile("hardware-health").weight, 5);
});

module.exports = {NOW, validSnapshot};
