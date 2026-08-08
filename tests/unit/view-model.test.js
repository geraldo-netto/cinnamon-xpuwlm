"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const Domain = require("../../files/cinnamon-tpuwm@geraldo-netto/lib/domain.js");
const ViewModel = require("../../files/cinnamon-tpuwm@geraldo-netto/lib/view-model.js");

const NOW = 1_700_000_000_000;

function state(overrides = {}) {
    const profiles = new Domain.WorkloadPortfolio().list({
        "hardware-health": {status: "running", queued: 2, detail: "sampling"},
    });
    return {
        selectedTab: "overview",
        paused: false,
        profiles,
        device: {available: true, state: "present", name: "Coral USB", kind: "usb", reason: ""},
        health: {device: "present", runtime: "connected", detail: ""},
        metrics: {load: 41.4, queueDepth: 2, runningProfiles: 1},
        alerts: [],
        attentionCount: 0,
        stale: false,
        source: "runtime",
        generatedAt: NOW - 1000,
        ...overrides,
    };
}

test("formatters distinguish missing, recent, minute, and hour values", () => {
    assert.equal(ViewModel.formatLoad(48.8), "49%");
    assert.equal(ViewModel.formatLoad(null), "—");
    assert.equal(ViewModel.formatFraction(0.456), "46%");
    assert.equal(ViewModel.formatFraction("0.5"), "—");
    assert.equal(ViewModel.formatRelativeTime(0, NOW), "unknown");
    assert.equal(ViewModel.formatRelativeTime(NOW - 2000, NOW), "just now");
    assert.equal(ViewModel.formatRelativeTime(NOW - 20_000, NOW), "20s ago");
    assert.equal(ViewModel.formatRelativeTime(NOW - 120_000, NOW), "2m ago");
    assert.equal(ViewModel.formatRelativeTime(NOW - 7_200_000, NOW), "2h ago");
    assert.equal(ViewModel.formatRelativeTime(NOW + 5000, NOW), "just now");
});

test("profile grouping preserves first-seen order and clones entries", () => {
    const profiles = [
        {id: "a", group: "One"},
        {id: "b", group: "Two"},
        {id: "c", group: "One"},
    ];
    const groups = ViewModel.groupProfiles(profiles);
    assert.deepEqual(groups.map((group) => group.name), ["One", "Two"]);
    assert.deepEqual(groups[0].profiles.map((profile) => profile.id), ["a", "c"]);
    groups[0].profiles[0].id = "changed";
    assert.equal(profiles[0].id, "a");
});

test("panel state communicates offline, paused, attention, and online modes", () => {
    assert.equal(ViewModel.attentionReviewText(1), "1 item needs review");
    assert.equal(ViewModel.attentionReviewText(2), "2 items need review");
    assert.deepEqual(ViewModel.panelModel(state({
        device: {available: false, reason: "Disconnected"},
    })), {
        accessibleName: "TPU Workload Manager, unavailable: Disconnected",
        label: "TPU Offline",
        status: "unavailable",
        severity: null,
        tooltip: "TPU Workload Manager — Disconnected",
    });
    assert.deepEqual(ViewModel.panelModel(state({paused: true})), {
        accessibleName: "TPU Workload Manager, paused: all workloads paused",
        label: "TPU Paused",
        status: "paused",
        severity: null,
        tooltip: "TPU Workload Manager — all workloads paused",
    });
    assert.deepEqual(ViewModel.panelModel(state({source: "probe"})), {
        accessibleName: "TPU Workload Manager, detected: hardware detected; runtime not connected",
        label: "TPU Detected",
        status: "detected",
        severity: null,
        tooltip: "TPU Workload Manager — hardware detected; runtime not connected",
    });
    assert.deepEqual(ViewModel.panelModel(state({attentionCount: 2})), {
        accessibleName: "TPU Workload Manager, attention: 2 items need review, highest severity none",
        label: "TPU 41% · none",
        status: "attention",
        severity: null,
        tooltip: "TPU Workload Manager — 2 items need review, highest severity none",
    });
    assert.deepEqual(ViewModel.panelModel(state()), {
        accessibleName: "TPU Workload Manager, online: 41% load",
        label: "TPU 41%",
        status: "online",
        severity: null,
        tooltip: "TPU Workload Manager — online",
    });
});

test("effective screen gives safety states precedence over tabs", () => {
    assert.equal(ViewModel.effectiveScreen(state({device: {available: false}})), "unavailable");
    assert.equal(ViewModel.effectiveScreen(state({paused: true})), "paused");
    assert.equal(ViewModel.effectiveScreen(state({selectedTab: "alerts"})), "alerts");
    assert.equal(ViewModel.effectiveScreen(state({selectedTab: "future"})), "overview");
    assert.equal(ViewModel.toViewModel(state({paused: true}), NOW).showTabs, false);

    const unavailablePaused = ViewModel.toViewModel(state({
        paused: true,
        device: {available: false, name: "No TPU", kind: "unknown", reason: "Disconnected"},
    }), NOW);
    assert.equal(unavailablePaused.screen, "unavailable");
    assert.equal(unavailablePaused.policyPaused, true);
    assert.equal(ViewModel.toViewModel(state(), NOW).policyPaused, false);
});

test("metrics explain normal and held workload state", () => {
    const normal = ViewModel.metricModels(state({attentionCount: 1}));
    assert.deepEqual(normal[1], {label: "Queue", value: "2", suffix: "jobs"});
    assert.equal(normal[3].suffix, "item · none");
    assert.equal(normal[3].tone, "attention");
    const paused = ViewModel.metricModels(state({paused: true, attentionCount: 0}));
    assert.equal(paused[0].value, "0%");
    assert.equal(paused[1].suffix, "held");
    assert.equal(paused[2].value, "0");
    assert.equal(paused[3].value, "Paused");
});

test("alert model resolves profile titles and evidence", () => {
    const profiles = state().profiles;
    const known = ViewModel.alertModel({
        profileId: "hardware-health",
        timestamp: NOW - 10_000,
        confidence: 0.8,
        riskScore: null,
    }, profiles, NOW);
    assert.equal(known.profileTitle, "Hardware health");
    assert.equal(known.age, "10s ago");
    assert.equal(known.confidenceText, "80%");
    assert.equal(known.riskText, "—");
    assert.equal(ViewModel.alertModel({profileId: "missing"}, profiles, NOW).profileTitle, "Unknown profile");
});

test("active alert comparator prioritizes severity, recency, then stable ID", () => {
    const base = {id: "beta", severity: "warning", timestamp: NOW};
    assert.ok(ViewModel.compareActiveAlerts(
        {...base, severity: "critical"},
        {...base, severity: "warning"},
    ) < 0);
    assert.ok(ViewModel.compareActiveAlerts(
        {...base, timestamp: NOW},
        {...base, timestamp: NOW - 1},
    ) < 0);
    assert.ok(ViewModel.compareActiveAlerts(
        {...base, id: "alpha"},
        {...base, id: "beta"},
    ) < 0);
    assert.ok(ViewModel.compareActiveAlerts(
        {...base, id: "beta"},
        {...base, id: "alpha"},
    ) > 0);
    assert.equal(ViewModel.compareActiveAlerts(base, {...base}), 0);
});

test("view model sorts only active alerts without mutating runtime order", () => {
    const alerts = [
        {id: "resolved", profileId: "hardware-health", title: "Resolved", severity: "critical", timestamp: NOW, resolved: true},
        {id: "warning-old", profileId: "hardware-health", title: "Warning old", severity: "warning", timestamp: NOW - 2000, resolved: false},
        {id: "advisory", profileId: "hardware-health", title: "Advisory", severity: "advisory", timestamp: NOW, resolved: false},
        {id: "critical", profileId: "hardware-health", title: "Critical", severity: "critical", timestamp: NOW - 5000, resolved: false},
        {id: "warning-z", profileId: "hardware-health", title: "Warning Z", severity: "warning", timestamp: NOW - 1000, resolved: false},
        {id: "warning-a", profileId: "hardware-health", title: "Warning A", severity: "warning", timestamp: NOW - 1000, resolved: false},
    ];
    const runtimeOrder = alerts.map((alert) => alert.id);
    const model = ViewModel.toViewModel(state({alerts, attentionCount: 5}), NOW);

    assert.deepEqual(model.activeAlerts.map((alert) => alert.id), [
        "critical",
        "warning-a",
        "warning-z",
        "warning-old",
        "advisory",
    ]);
    assert.deepEqual(model.resolvedAlerts.map((alert) => alert.id), ["resolved"]);
    assert.deepEqual(alerts.map((alert) => alert.id), runtimeOrder);
});

test("view model groups profiles, separates alerts, and creates stable body key", () => {
    const alerts = [
        {id: "a", profileId: "hardware-health", title: "Review", timestamp: NOW, confidence: 0.5, riskScore: 0.4, resolved: false},
        {id: "b", profileId: "hardware-health", title: "Done", timestamp: NOW, confidence: 0.9, riskScore: 0.2, resolved: true},
    ];
    const model = ViewModel.toViewModel(state({alerts, attentionCount: 1}), NOW);
    assert.equal(model.screen, "overview");
    assert.equal(model.device.status, "Online");
    assert.equal(model.showTabs, true);
    assert.equal(model.enabledGroups.length, 3);
    assert.equal(model.allGroups.length, 3);
    assert.equal(model.pausedProfiles.length, 3);
    assert.equal(model.activeAlerts.length, 1);
    assert.equal(model.resolvedAlerts.length, 1);
    assert.match(model.headerSubtitle, /Updated just now/);
    assert.match(
        ViewModel.toViewModel(state({
            source: "probe",
            health: {device: "present", runtime: "absent", detail: ""},
        }), NOW).headerSubtitle,
        /Runtime absent/,
    );
    assert.doesNotThrow(() => JSON.parse(model.bodyKey));
    const agedModel = ViewModel.toViewModel(state({alerts, attentionCount: 1}), NOW + 10_000);
    assert.notEqual(agedModel.bodyKey, model.bodyKey);

    const offline = ViewModel.toViewModel(state({
        device: {available: false, state: "absent", name: "No TPU", kind: "unknown", reason: "Connect device"},
        health: {device: "absent", runtime: "connected", detail: "Connect device"},
    }), NOW);
    assert.equal(offline.device.status, "No device");
    assert.equal(offline.showTabs, false);
    assert.match(offline.headerSubtitle, /Connect device/);
});

test("body key tracks every rendered field of a same-identity alert", () => {
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
    const initial = ViewModel.toViewModel(state({alerts: [alert], attentionCount: 1}), NOW);
    const equivalent = ViewModel.toViewModel(state({alerts: [{...alert}], attentionCount: 1}), NOW);
    assert.equal(equivalent.bodyKey, initial.bodyKey);

    for (const [field, value] of Object.entries({
        title: "Critical voltage drift",
        summary: "Disconnect the supply",
        severity: "critical",
        confidence: 0.8,
        riskScore: 0.9,
    })) {
        const changed = ViewModel.toViewModel(state({
            alerts: [{...alert, [field]: value}],
            attentionCount: 1,
        }), NOW);
        assert.notEqual(changed.bodyKey, initial.bodyKey, field);
    }
});
