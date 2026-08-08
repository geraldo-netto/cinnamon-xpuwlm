"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const Domain = require("../../files/cinnamon-tpuwm@geraldo-netto/lib/domain.js");
const BuiltIns = require("../helpers/built-in-workloads.js");
const ViewModel = require("../../files/cinnamon-tpuwm@geraldo-netto/lib/view-model.js");

const ROOT = path.resolve(__dirname, "../../files/cinnamon-tpuwm@geraldo-netto");

function state(overrides = {}) {
    return {
        selectedTab: "overview",
        paused: false,
        profiles: new Domain.WorkloadPortfolio(null, BuiltIns.coreCatalog()).list(),
        device: {available: true, state: "present", name: "Coral USB", kind: "usb", reason: ""},
        health: {device: "present", runtime: "connected", detail: ""},
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
        [state(), "online", "online"],
        [state({attentionCount: 1}), "attention", "attention"],
        [state({source: "probe", health: {device: "present", runtime: "absent", detail: ""}}), "detected", "detected"],
        [state({paused: true}), "paused", "paused"],
        [
            state({
                device: {available: false, state: "absent", reason: "Disconnected"},
                health: {device: "absent", runtime: "connected", detail: "Disconnected"},
            }),
            "unavailable",
            "unavailable",
        ],
        [
            state({
                device: {available: false, state: "unknown", reason: "Runtime snapshot is stale"},
                health: {device: "unknown", runtime: "stale", detail: "Runtime snapshot is stale"},
            }),
            "unavailable",
            "unknown",
        ],
    ];
    for (const [value, expectedStatus, spokenStatus] of cases) {
        const panel = ViewModel.panelModel(value);
        assert.equal(panel.status, expectedStatus);
        assert.match(panel.tooltip, /^TPU Workload Manager — /u);
        assert.match(panel.accessibleName, new RegExp(`^TPU Workload Manager, ${spokenStatus}:`, "u"));
        assert.equal(
            fs.existsSync(path.join(ROOT, "icons", `tpuwm-status-${expectedStatus}-symbolic.svg`)),
            true,
        );
    }
});
