"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const Domain = require("../../lib/domain.js");
const ViewModel = require("../../lib/view-model.js");

const NOW = 1_700_000_000_000;

function generator(seed) {
    let state = seed >>> 0;
    return () => {
        state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
        return state / 0x1_0000_0000;
    };
}

function viewState(profiles, alert) {
    return {
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
}

test("fuzz: every rendered alert mutation invalidates a stable identity", () => {
    const random = generator(0x414c4552);
    const profiles = new Domain.WorkloadPortfolio().list();
    const fields = ["title", "summary", "severity", "confidence", "riskScore"];

    for (let index = 0; index < 1000; index += 1) {
        const alert = {
            id: `alert-${Math.floor(random() * 20)}`,
            profileId: "hardware-health",
            title: `Voltage drift ${index}`,
            summary: `Review supply ${index}`,
            severity: "warning",
            timestamp: NOW,
            confidence: 0.1,
            riskScore: 0.2,
            resolved: false,
        };
        const field = fields[index % fields.length];
        const replacements = {
            title: `Critical voltage drift ${index}`,
            summary: `Disconnect supply ${index}`,
            severity: "critical",
            confidence: 0.8 + random() * 0.1,
            riskScore: 0.9 + random() * 0.09,
        };
        const changed = {...alert, [field]: replacements[field]};
        const initialKey = ViewModel.toViewModel(viewState(profiles, alert), NOW).bodyKey;
        const changedKey = ViewModel.toViewModel(viewState(profiles, changed), NOW).bodyKey;
        assert.notEqual(changedKey, initialKey, `${field} iteration ${index}`);
    }
});

test("fuzz: active alert order is deterministic across input permutations", () => {
    const random = generator(0x534f5254);
    const profiles = new Domain.WorkloadPortfolio().list();
    const severities = ["advisory", "warning", "critical"];

    for (let iteration = 0; iteration < 1000; iteration += 1) {
        const alerts = Array.from({length: 12}, (_, index) => ({
            id: `alert-${String(index).padStart(2, "0")}`,
            profileId: "hardware-health",
            title: `Alert ${index}`,
            severity: severities[Math.floor(random() * severities.length)],
            timestamp: NOW - Math.floor(random() * 5),
            resolved: index % 5 === 0,
        }));
        const expected = ViewModel.toViewModel({
            ...viewState(profiles, alerts[0]),
            alerts,
            attentionCount: alerts.filter((alert) => !alert.resolved).length,
        }, NOW).activeAlerts.map((alert) => alert.id);
        const shuffled = alerts.slice().sort(() => random() - 0.5);
        const actual = ViewModel.toViewModel({
            ...viewState(profiles, shuffled[0]),
            alerts: shuffled,
            attentionCount: expected.length,
        }, NOW).activeAlerts.map((alert) => alert.id);

        assert.deepEqual(actual, expected, `iteration ${iteration}`);
    }
});
