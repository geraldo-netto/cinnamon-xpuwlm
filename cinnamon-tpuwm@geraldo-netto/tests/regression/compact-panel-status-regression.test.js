"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const Domain = require("../../lib/domain.js");
const ViewModel = require("../../lib/view-model.js");

const ROOT = path.resolve(__dirname, "../..");

function state(overrides = {}) {
    return {
        selectedTab: "overview",
        paused: false,
        profiles: new Domain.WorkloadPortfolio().list(),
        device: {available: true, name: "Coral USB", kind: "usb", reason: ""},
        metrics: {load: 42, queueDepth: 0, runningProfiles: 1},
        alerts: [],
        attentionCount: 0,
        stale: false,
        source: "runtime",
        generatedAt: 1_700_000_000_000,
        ...overrides,
    };
}

test("regression: compact icon is default while every status keeps explicit text alternatives", () => {
    const settings = JSON.parse(fs.readFileSync(path.join(ROOT, "settings-schema.json"), "utf8"));
    assert.equal(settings["show-panel-label"].default, false);

    const cases = [
        [state(), "online"],
        [state({attentionCount: 1}), "attention"],
        [state({source: "probe"}), "detected"],
        [state({paused: true}), "paused"],
        [state({device: {available: false, reason: "Disconnected"}}), "unavailable"],
    ];
    for (const [value, expectedStatus] of cases) {
        const panel = ViewModel.panelModel(value);
        assert.equal(panel.status, expectedStatus);
        assert.match(panel.tooltip, /^TPU Workload Manager — /u);
        assert.match(panel.accessibleName, new RegExp(`^TPU Workload Manager, ${expectedStatus}:`, "u"));
        assert.equal(
            fs.existsSync(path.join(ROOT, "icons", `tpuwm-status-${expectedStatus}-symbolic.svg`)),
            true,
        );
    }
});
