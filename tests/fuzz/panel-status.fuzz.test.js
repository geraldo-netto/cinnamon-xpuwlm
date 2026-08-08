"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const Domain = require("../../files/cinnamon-tpuwm@geraldo-netto/lib/domain.js");
const ViewModel = require("../../files/cinnamon-tpuwm@geraldo-netto/lib/view-model.js");

function generator(seed) {
    let value = seed >>> 0;
    return () => {
        value = (Math.imul(value, 1_664_525) + 1_013_904_223) >>> 0;
        return value;
    };
}

test("fuzz: compact panel status preserves safety precedence and text alternatives", () => {
    const random = generator(0x50414e4c);
    const profiles = new Domain.WorkloadPortfolio().list();
    for (let iteration = 0; iteration < 4_096; iteration += 1) {
        const bits = random();
        const available = (bits & 1) !== 0;
        const paused = (bits & 2) !== 0;
        const probe = (bits & 4) !== 0;
        const unknownDevice = !available && (bits & 8) !== 0;
        const attentionCount = (bits >>> 4) % 5;
        const expectedStatus = !available
            ? "unavailable"
            : paused
                ? "paused"
                : probe
                    ? "detected"
                    : attentionCount > 0 ? "attention" : "online";
        const spokenStatus = unknownDevice ? "unknown" : expectedStatus;
        const panel = ViewModel.panelModel({
            selectedTab: "overview",
            paused,
            profiles,
            device: {
                available,
                state: available ? "present" : unknownDevice ? "unknown" : "absent",
                name: "Coral USB",
                kind: "usb",
                reason: "Disconnected",
            },
            health: {
                device: available ? "present" : unknownDevice ? "unknown" : "absent",
                runtime: probe ? "absent" : "connected",
                detail: "Disconnected",
            },
            metrics: {load: bits % 101, queueDepth: 0, runningProfiles: 0},
            alerts: [],
            attentionCount,
            stale: false,
            source: probe ? "probe" : "runtime",
            generatedAt: bits,
        });
        assert.equal(panel.status, expectedStatus);
        assert.match(panel.accessibleName, new RegExp(`, ${spokenStatus}:`, "u"));
        assert.match(panel.tooltip, /^TPU Workload Manager — /u);
    }
});
