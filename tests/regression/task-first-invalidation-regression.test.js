"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const Domain = require("../../files/cinnamon-xpuwlm@geraldo-netto/lib/domain.js");
const ViewModel = require("../../files/cinnamon-xpuwlm@geraldo-netto/lib/view-model.js");
const BuiltIns = require("../helpers/built-in-workloads.js");

const NOW = 1_700_000_000_000;

function state(overrides = {}) {
    return {
        selectedTab: "alerts",
        paused: false,
        profiles: new Domain.WorkloadPortfolio(null, BuiltIns.coreCatalog()).list(
            BuiltIns.servingProfiles(),
        ),
        device: {backend: "gpu", available: true, name: "GPU", load: 4, reason: ""},
        devices: [],
        health: {device: "present", runtime: "connected", detail: ""},
        metrics: {queueDepth: 0, runningProfiles: 0},
        alerts: [], attentionCount: 0, source: "runtime", generatedAt: NOW,
        control: {pending: false, message: "", available: true},
        inputs: {roots: [], pictures: [], runnable: [], omitted: 0},
        ...overrides,
    };
}

test("regression: Activity invalidates when only the runtime job count changes", () => {
    const idle = ViewModel.toViewModel(state(), NOW);
    const running = ViewModel.toViewModel(state({
        metrics: {queueDepth: 0, runningProfiles: 1},
    }), NOW);

    assert.notEqual(idle.bodyKey, running.bodyKey);
    assert.equal(idle.activity.activeCount, 0);
    assert.equal(running.activity.activeCount, 1);
});

test("regression: Diagnostics invalidates when only its last-update source changes", () => {
    const earlier = ViewModel.toViewModel(state({selectedTab: "setup"}), NOW + 60_000);
    const later = ViewModel.toViewModel(state({
        selectedTab: "setup", generatedAt: NOW + 30_000,
    }), NOW + 60_000);

    assert.notEqual(earlier.bodyKey, later.bodyKey);
    assert.notDeepEqual(earlier.diagnostics.current, later.diagnostics.current);
});
