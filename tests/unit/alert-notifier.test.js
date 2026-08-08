"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const Domain = require("../../files/cinnamon-tpuwm@geraldo-netto/lib/domain.js");
const BuiltIns = require("../helpers/built-in-workloads.js");
const Notifier = require("../../files/cinnamon-tpuwm@geraldo-netto/lib/alert-notifier.js");

const NOW = 1_700_000_000_000;
const PROFILES = new Domain.WorkloadPortfolio(null, BuiltIns.coreCatalog()).list();

function alert(overrides = {}) {
    return {
        id: "power-risk",
        profileId: "hardware-health",
        title: "Voltage drift",
        summary: "Review the supply",
        severity: "critical",
        timestamp: NOW,
        confidence: null,
        riskScore: null,
        resolved: false,
        ...overrides,
    };
}

function harness(overrides = {}) {
    const messages = [];
    const failures = [];
    const recoveries = [];
    const notifier = new Notifier.CriticalAlertNotifier({
        notifications: overrides.notifications || {
            notify: (message) => messages.push(message),
        },
        errorReporter: {
            report: (key, message) => failures.push([key, message]),
            recover: (key) => recoveries.push(key),
        },
        clock: {now: () => NOW},
    });
    return {failures, messages, notifier, recoveries};
}

test("the notifier validates its collaborators", () => {
    const notifications = {notify() {}};
    const errorReporter = {report() {}, recover() {}};
    assert.throws(
        () => new Notifier.CriticalAlertNotifier({notifications: {}, errorReporter}),
        /notification port/,
    );
    assert.throws(
        () => new Notifier.CriticalAlertNotifier({notifications, errorReporter: {}}),
        /reporter/,
    );
    assert.throws(
        () => new Notifier.CriticalAlertNotifier({notifications, errorReporter, clock: {}}),
        /clock/,
    );
    assert.throws(() => Notifier.requireNotificationPort(null), /notification port/);
});

test("notification content names the profile and the alert", () => {
    assert.deepEqual(Notifier.notificationMessage(alert(), PROFILES), {
        summary: "TPU critical alert — Hardware health",
        body: "Voltage drift. Review the supply",
    });
    assert.deepEqual(Notifier.notificationMessage(alert({summary: ""}), PROFILES), {
        summary: "TPU critical alert — Hardware health",
        body: "Voltage drift",
    });
    assert.equal(Notifier.profileTitle(PROFILES, "missing"), "Unknown profile");
    assert.equal(
        Notifier.notificationMessage(alert({profileId: "missing"}), []).summary,
        "TPU critical alert — Unknown profile",
    );
});

test("each critical occurrence notifies exactly once while it stays active", () => {
    const {messages, notifier} = harness();
    assert.equal(notifier.observe([alert()], PROFILES).length, 1);
    assert.equal(notifier.observe([alert()], PROFILES).length, 0);
    assert.equal(notifier.observe([alert({summary: "Changed detail"})], PROFILES).length, 0);
    assert.equal(messages.length, 1);
    assert.equal(messages[0].body, "Voltage drift. Review the supply");
});

test("resolution and disappearance both allow the next occurrence to notify", () => {
    const {messages, notifier} = harness();
    notifier.observe([alert()], PROFILES);
    assert.equal(notifier.observe([alert({resolved: true})], PROFILES).length, 0);
    assert.equal(notifier.observe([alert()], PROFILES).length, 1);

    notifier.observe([], PROFILES);
    assert.equal(notifier.observe([alert()], PROFILES).length, 1);
    assert.equal(messages.length, 3);
});

test("only unresolved critical alerts notify", () => {
    const {messages, notifier} = harness();
    const delivered = notifier.observe([
        alert({id: "advisory", severity: "advisory"}),
        alert({id: "warning", severity: "warning"}),
        alert({id: "resolved", resolved: true}),
        alert({id: "critical"}),
    ], PROFILES);
    assert.deepEqual(delivered.map((candidate) => candidate.id), ["critical"]);
    assert.equal(messages.length, 1);
});

test("distinct critical identities each notify once", () => {
    const {messages, notifier} = harness();
    notifier.observe([alert({id: "first"}), alert({id: "second"})], PROFILES);
    assert.equal(messages.length, 2);
    notifier.observe([alert({id: "first"}), alert({id: "second"})], PROFILES);
    assert.equal(messages.length, 2);
    notifier.observe([alert({id: "first"}), alert({id: "third"})], PROFILES);
    assert.equal(messages.length, 3);
    notifier.observe([alert({id: "second"})], PROFILES);
    assert.equal(messages.length, 4);
});

test("a failed notification is reported and retried, never silently dropped", () => {
    let failing = true;
    const messages = [];
    const {failures, notifier, recoveries} = harness({
        notifications: {
            notify(message) {
                if (failing) {
                    throw new Error("message tray unavailable");
                }
                messages.push(message);
            },
        },
    });

    assert.deepEqual(notifier.observe([alert()], PROFILES), []);
    assert.equal(failures.length, 1);
    assert.equal(failures[0][0], Notifier.NOTIFY_FAILURE);
    assert.match(failures[0][1], /Could not show a critical notification/u);

    failing = false;
    assert.equal(notifier.observe([alert()], PROFILES).length, 1);
    assert.equal(messages.length, 1);
    assert.equal(recoveries.includes(Notifier.NOTIFY_FAILURE), true);
});

test("dispose forgets delivered occurrences and is idempotent", () => {
    const {messages, notifier} = harness();
    notifier.observe([alert()], PROFILES);
    assert.equal(notifier.dispose(), true);
    assert.equal(notifier.dispose(), false);
    notifier.observe([alert()], PROFILES);
    assert.equal(messages.length, 2);
});
