"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const Domain = require("../../lib/domain.js");
const Menu = require("../../lib/menu-view.js");
const ViewModel = require("../../lib/view-model.js");
const {
    FakeActor,
    FakeButton,
    FakeMenu,
    createSt,
    findActors,
} = require("../helpers/fakes.js");

const NOW = 1_700_000_000_000;

function baseState(overrides = {}) {
    return {
        selectedTab: "overview",
        paused: false,
        profiles: new Domain.WorkloadPortfolio().list({
            "hardware-health": {status: "running", queued: 2, detail: "sampling"},
        }),
        device: {available: true, name: "Coral USB", kind: "usb", reason: ""},
        metrics: {load: 42, queueDepth: 2, runningProfiles: 1},
        alerts: [],
        attentionCount: 0,
        stale: false,
        source: "runtime",
        generatedAt: NOW,
        ...overrides,
    };
}

function harness() {
    const calls = [];
    const actions = {};
    for (const name of ["selectTab", "toggleProfile", "changeWeight", "pauseAll", "resumeAll", "refresh", "openSettings"]) {
        actions[name] = (...args) => calls.push([name, ...args]);
    }
    const menu = new FakeMenu();
    const view = new Menu.MenuView({
        St: createSt(),
        Clutter: {ActorAlign: {CENTER: "center"}},
        Atk: {Role: {PUSH_BUTTON: "push-button"}},
        menu,
        actions,
    });
    return {calls, menu, view, root: menu.actors[0]};
}

function button(root, accessibleName) {
    return findActors(root, (actor) => actor instanceof FakeButton && actor.accessibleName === accessibleName)[0];
}

test("menu validates dependencies and required actions", () => {
    const validActions = Object.fromEntries(
        ["selectTab", "toggleProfile", "changeWeight", "pauseAll", "resumeAll", "refresh", "openSettings"]
            .map((name) => [name, () => {}]),
    );
    assert.throws(() => new Menu.MenuView({}), /dependencies/);
    assert.throws(() => new Menu.MenuView({
        St: createSt(),
        Clutter: {},
        menu: new FakeMenu(),
        actions: {...validActions, refresh: null},
    }), /refresh/);
    assert.throws(() => Menu.requireAction(null, "refresh"), /refresh/);
});

test("style and child helpers make updates idempotent", () => {
    const actor = new FakeActor();
    Menu.setStyleClass(actor, "active", true);
    assert.equal(actor.styleClasses.has("active"), true);
    Menu.setStyleClass(actor, "active", false);
    assert.equal(actor.styleClasses.has("active"), false);
    const first = new FakeActor();
    const second = new FakeActor();
    actor.add_child(first);
    actor.add_child(second);
    Menu.destroyChildren(actor);
    assert.equal(first.destroyed, true);
    assert.equal(second.destroyed, true);
    assert.equal(actor.children.length, 0);
});

test("pause control defaults to local pause intent before first render", () => {
    const {calls, root} = harness();
    button(root, "Pause all workloads").click();
    assert.deepEqual(calls, [["pauseAll"]]);
});

test("overview exposes grouped profiles and all primary actions", () => {
    const {calls, view, root} = harness();
    view.render(ViewModel.toViewModel(baseState(), NOW));
    assert.equal(button(root, "overview tab, selected").styleClasses.has("tpuwm-tab-active"), true);
    assert.equal(button(root, "profiles tab").styleClasses.has("tpuwm-tab-active"), false);
    button(root, "profiles tab").click();
    button(root, "Manage workload profiles").click();
    button(root, "Refresh TPU status").click();
    button(root, "Open TPU Workload Manager settings").click();
    button(root, "Pause all workloads").click();
    button(root, "Disable Hardware health").click();
    assert.deepEqual(calls, [
        ["selectTab", "profiles"],
        ["selectTab", "profiles"],
        ["refresh"],
        ["openSettings"],
        ["pauseAll"],
        ["toggleProfile", "hardware-health"],
    ]);
});

test("profiles screen offers weight and enable controls", () => {
    const {calls, view, root} = harness();
    view.render(ViewModel.toViewModel(baseState({selectedTab: "profiles"}), NOW));
    button(root, "Decrease Hardware health weight").click();
    button(root, "Increase Hardware health weight").click();
    button(root, "Enable Network & peripherals").click();
    assert.deepEqual(calls, [
        ["changeWeight", "hardware-health", -1],
        ["changeWeight", "hardware-health", 1],
        ["toggleProfile", "network-peripherals"],
    ]);
    const minimum = button(root, "Decrease Desktop context weight");
    assert.equal(minimum.reactive, false);
    assert.equal(minimum.can_focus, false);
    assert.equal(minimum.styleClasses.has("tpuwm-button-disabled"), true);

    const maximumState = baseState({selectedTab: "profiles"});
    maximumState.profiles[0].weight = 5;
    view.render(ViewModel.toViewModel(maximumState, NOW));
    const maximum = button(root, "Increase Hardware health weight");
    assert.equal(maximum.reactive, false);
    assert.equal(maximum.can_focus, false);
});

test("alerts screen renders empty, active, resolved, and fallback evidence", () => {
    const {view, root} = harness();
    view.render(ViewModel.toViewModel(baseState({selectedTab: "alerts"}), NOW));
    assert.equal(findActors(root, (actor) => actor.text === "No active alerts").length, 1);

    const alerts = [
        {id: "active", profileId: "hardware-health", title: "Voltage drift", summary: "", severity: "warning", timestamp: NOW, confidence: null, riskScore: 0.7, resolved: false},
        {id: "done", profileId: "hardware-health", title: "Temperature stable", summary: "Resolved", severity: "advisory", timestamp: NOW, confidence: 0.9, riskScore: 0.1, resolved: true},
    ];
    view.render(ViewModel.toViewModel(baseState({selectedTab: "alerts", alerts, attentionCount: 1}), NOW));
    assert.equal(findActors(root, (actor) => actor.text === "Voltage drift").length, 1);
    assert.equal(findActors(root, (actor) => actor.text === "No additional detail was supplied.").length, 1);
    assert.equal(findActors(root, (actor) => actor.text === "Temperature stable").length, 1);

    const changedAlerts = [
        {
            ...alerts[0],
            title: "Critical voltage drift",
            summary: "Disconnect the supply",
            severity: "critical",
            confidence: 0.8,
            riskScore: 0.9,
        },
        alerts[1],
    ];
    view.render(ViewModel.toViewModel(baseState({
        selectedTab: "alerts",
        alerts: changedAlerts,
        attentionCount: 1,
    }), NOW));
    assert.equal(findActors(root, (actor) => actor.text === "Voltage drift").length, 0);
    assert.equal(findActors(root, (actor) => actor.text === "No additional detail was supplied.").length, 0);
    assert.equal(findActors(root, (actor) => actor.text === "Critical voltage drift").length, 1);
    assert.equal(findActors(root, (actor) => actor.text === "Disconnect the supply").length, 1);
    assert.equal(findActors(root, (actor) => actor.text === "critical").length, 1);
    assert.equal(findActors(root, (actor) => actor.text === "80%").length, 1);
    assert.equal(findActors(root, (actor) => actor.text === "90%").length, 1);
    assert.equal(findActors(root, (actor) => actor.styleClasses.has("tpuwm-alert-critical")).length, 1);
});

test("paused screen invokes resume independently of button presentation text", () => {
    const {calls, view, root} = harness();
    view.render(ViewModel.toViewModel(baseState({paused: true}), NOW));
    const headerResume = button(root, "Resume all workloads");
    const label = headerResume.children[0];
    label.set_text("Localized resume text");
    headerResume.click();
    const bodyResume = findActors(root, (actor) => actor instanceof FakeButton && actor.accessibleName === "Resume all workloads")[1];
    bodyResume.click();
    assert.deepEqual(calls, [["resumeAll"], ["resumeAll"]]);
    assert.equal(findActors(root, (actor) => actor.text === "Local policy paused").length, 1);
    assert.equal(findActors(root, (actor) => actor.styleClasses.has("tpuwm-tabs"))[0].visible, false);
    assert.equal(button(root, "Manage workload profiles").visible, false);
});

test("unavailable screen hides tabs and offers recovery", () => {
    const {calls, view, root} = harness();
    view.render(ViewModel.toViewModel(baseState({
        device: {available: false, name: "No TPU", kind: "unknown", reason: "Reconnect device"},
    }), NOW));
    assert.equal(findActors(root, (actor) => actor.styleClasses.has("tpuwm-tabs"))[0].visible, false);
    assert.equal(button(root, "Manage workload profiles").visible, false);
    assert.equal(findActors(root, (actor) => actor.text === "Reconnect device").length, 1);
    button(root, "Retry TPU detection").click();
    assert.deepEqual(calls, [["refresh"]]);
});

test("unavailable screen keeps pause control aligned with policy intent", () => {
    const {calls, view, root} = harness();
    const device = {available: false, name: "No TPU", kind: "unknown", reason: "Reconnect device"};
    view.render(ViewModel.toViewModel(baseState({paused: true, device}), NOW));

    assert.equal(findActors(root, (actor) => actor.text === "Reconnect device").length, 1);
    button(root, "Resume all workloads").click();

    view.render(ViewModel.toViewModel(baseState({paused: false, device}), NOW));
    button(root, "Pause all workloads").click();
    assert.deepEqual(calls, [["resumeAll"], ["pauseAll"]]);
});

test("body rendering skips unchanged content and destroy is idempotent", () => {
    const {view, root} = harness();
    const model = ViewModel.toViewModel(baseState(), NOW);
    view.render(model);
    const body = findActors(root, (actor) => actor.styleClasses.has("tpuwm-body"))[0];
    const originalChildren = body.children.slice();
    view.render(model);
    assert.deepEqual(body.children, originalChildren);
    assert.equal(view.destroy(), true);
    assert.equal(root.destroyed, true);
    assert.equal(view.destroy(), false);
});

test("labels tolerate actors without a clutter text delegate", () => {
    const {view} = harness();
    view._St = {...view._St, Label: FakeActor};
    const label = view._label("Accessible text", "copy");
    assert.equal(label.text, "Accessible text");
    assert.equal(view._label(null, "copy").text, "");
    view.destroy();
});
