"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const Domain = require("../../files/cinnamon-tpuwm@geraldo-netto/lib/domain.js");
const BuiltIns = require("../helpers/built-in-workloads.js");
const Notifier = require("../../files/cinnamon-tpuwm@geraldo-netto/lib/alert-notifier.js");

const NOW = 1_700_000_000_000;
const PROFILES = new Domain.WorkloadPortfolio(null, BuiltIns.coreCatalog()).list();
const IDENTITIES = ["alpha", "beta", "gamma"];
const SEVERITIES = ["advisory", "warning", "critical"];

function generator(seed) {
    let state = seed >>> 0;
    return () => {
        state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
        return state / 0x1_0000_0000;
    };
}

function notifier(messages) {
    return new Notifier.CriticalAlertNotifier({
        notifications: {notify: (message) => messages.push(message)},
        errorReporter: {report() {}, recover() {}},
        clock: {now: () => NOW},
    });
}

test("property: notifications equal the number of critical reappearances", () => {
    const random = generator(0x4e4f5449);

    for (let iteration = 0; iteration < 400; iteration += 1) {
        const messages = [];
        const observer = notifier(messages);
        const wasActive = new Map(IDENTITIES.map((id) => [id, false]));
        let expected = 0;

        for (let step = 0; step < 24; step += 1) {
            const alerts = [];
            const nowActive = new Map(IDENTITIES.map((id) => [id, false]));
            for (const id of IDENTITIES) {
                if (random() < 0.5) {
                    continue;
                }
                const severity = SEVERITIES[Math.floor(random() * SEVERITIES.length)];
                const resolved = random() < 0.3;
                alerts.push({
                    id,
                    profileId: "hardware-health",
                    title: `Alert ${id}`,
                    summary: "",
                    severity,
                    timestamp: NOW,
                    confidence: null,
                    riskScore: null,
                    resolved,
                });
                nowActive.set(id, severity === "critical" && !resolved);
            }
            for (const id of IDENTITIES) {
                if (nowActive.get(id) && !wasActive.get(id)) {
                    expected += 1;
                }
                wasActive.set(id, nowActive.get(id));
            }
            observer.observe(alerts, PROFILES);
        }

        assert.equal(messages.length, expected, `iteration ${iteration}`);
    }
});

test("property: a continuously active critical alert never repeats", () => {
    const random = generator(0x53544159);

    for (let iteration = 0; iteration < 200; iteration += 1) {
        const messages = [];
        const observer = notifier(messages);
        const alert = {
            id: "stable",
            profileId: "hardware-health",
            title: "Voltage drift",
            summary: "",
            severity: "critical",
            timestamp: NOW,
            confidence: null,
            riskScore: null,
            resolved: false,
        };
        const rounds = 1 + Math.floor(random() * 30);
        for (let round = 0; round < rounds; round += 1) {
            observer.observe([{...alert, summary: `changing ${round}`}], PROFILES);
        }
        assert.equal(messages.length, 1, `iteration ${iteration}`);
    }
});

test("fuzz: hostile alert lists never crash the notifier", () => {
    const random = generator(0x484f5354);
    const hostile = [
        {},
        {id: "no-severity"},
        {id: "null-severity", severity: null},
        {id: "resolved-truthy", severity: "critical", resolved: 1},
        {id: "critical", severity: "critical", resolved: false, profileId: "missing"},
    ];

    for (let iteration = 0; iteration < 500; iteration += 1) {
        const messages = [];
        const observer = notifier(messages);
        const alerts = hostile.filter(() => random() < 0.6);
        assert.doesNotThrow(() => observer.observe(alerts, PROFILES));
        assert.equal(
            messages.length,
            alerts.filter((alert) => alert.severity === "critical" && alert.resolved !== true).length,
        );
    }
});
