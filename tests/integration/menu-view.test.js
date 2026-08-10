"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const Domain = require("../../files/cinnamon-tpuwm@geraldo-netto/lib/domain.js");
const BuiltIns = require("../helpers/built-in-workloads.js");
const Menu = require("../../files/cinnamon-tpuwm@geraldo-netto/lib/menu-view.js");
const ViewModel = require("../../files/cinnamon-tpuwm@geraldo-netto/lib/view-model.js");
const {
    FakeActor,
    FakeButton,
    FakeMenu,
    createAtk,
    createSt,
    findActors,
} = require("../helpers/fakes.js");

const NOW = 1_700_000_000_000;

function baseState(overrides = {}) {
    return {
        selectedTab: "overview",
        paused: false,
        profiles: new Domain.WorkloadPortfolio(null, BuiltIns.coreCatalog()).list({
            "hardware-health": {status: "running", queued: 2, detail: "sampling"},
        }),
        device: {available: true, state: "present", name: "Coral USB", kind: "usb", reason: ""},
        health: {device: "present", runtime: "connected", detail: ""},
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
    for (const name of ["selectTab", "toggleProfile", "changeWeight", "pauseAll", "resumeAll", "refresh", "openSettings", "acknowledgeCatalogChanges"]) {
        actions[name] = (...args) => calls.push([name, ...args]);
    }
    const menu = new FakeMenu();
    const view = new Menu.MenuView({
        St: createSt(),
        Clutter: {ActorAlign: {CENTER: "center"}},
        Atk: createAtk(),
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
        ["selectTab", "toggleProfile", "changeWeight", "pauseAll", "resumeAll", "refresh", "openSettings", "acknowledgeCatalogChanges"]
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
    assert.equal(button(root, "Overview tab, selected").styleClasses.has("tpuwm-tab-active"), true);
    assert.equal(button(root, "Profiles tab").styleClasses.has("tpuwm-tab-active"), false);
    button(root, "Profiles tab").click();
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

test("pending runtime control is announced and disables policy controls", () => {
    const {view, root} = harness();
    view.render(ViewModel.toViewModel(baseState({
        selectedTab: "profiles",
        control: {pending: true, message: "Applying change in runtime…"},
    }), NOW));
    assert.equal(findActors(root, (actor) => actor.text === "Applying change in runtime…").length, 1);
    for (const accessibleName of [
        "Pause all workloads",
        "Decrease Hardware health weight",
        "Increase Hardware health weight",
        "Disable Hardware health",
    ]) {
        assert.equal(button(root, accessibleName).reactive, false, accessibleName);
    }

    view.render(ViewModel.toViewModel(baseState({
        selectedTab: "profiles",
        control: {pending: false, message: "Runtime rejected the change; retry"},
    }), NOW));
    const feedback = findActors(root, (actor) => actor.text === "Runtime rejected the change; retry")[0];
    assert.equal(feedback.styleClasses.has("tpuwm-control-error"), true);
    assert.equal(button(root, "Pause all workloads").reactive, true);
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

test("alerts screen renders critical and newer alerts before lower priorities", () => {
    const {view, root} = harness();
    const alerts = [
        {id: "advisory", profileId: "hardware-health", title: "Advisory", summary: "", severity: "advisory", timestamp: NOW, confidence: null, riskScore: null, resolved: false},
        {id: "warning-old", profileId: "hardware-health", title: "Warning old", summary: "", severity: "warning", timestamp: NOW - 1000, confidence: null, riskScore: null, resolved: false},
        {id: "critical", profileId: "hardware-health", title: "Critical", summary: "", severity: "critical", timestamp: NOW - 5000, confidence: null, riskScore: null, resolved: false},
        {id: "warning-new", profileId: "hardware-health", title: "Warning new", summary: "", severity: "warning", timestamp: NOW, confidence: null, riskScore: null, resolved: false},
    ];
    view.render(ViewModel.toViewModel(baseState({
        selectedTab: "alerts",
        alerts,
        attentionCount: alerts.length,
    }), NOW));

    const titles = findActors(root, (actor) => actor.styleClasses.has("tpuwm-alert-title"))
        .map((actor) => actor.text);
    assert.deepEqual(titles, ["Critical", "Warning new", "Warning old", "Advisory"]);
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

// Plug-in installs, upgrades, and removals were computed and discarded. The
// popup now states them above the workload data they affect, in words, and
// keeps the notice until the user acknowledges it.
test("the catalog notice appears with named plug-ins and dismisses on demand", () => {
    const {calls, view, root} = harness();
    const notice = findActors(root, (actor) => actor.styleClasses
        && actor.styleClasses.has("tpuwm-catalog-notice"))[0];
    assert.equal(notice.visible, false);

    view.render(ViewModel.toViewModel(baseState({
        catalogChanges: {
            installed: ["hardware-health"],
            upgraded: [],
            removed: ["third-party-workload"],
        },
    }), NOW));
    assert.equal(notice.visible, true);
    assert.equal(
        notice.accessibleName,
        "Workload catalog changed: Installed: Hardware health · Removed: third-party-workload",
    );
    const texts = findActors(notice, (actor) => typeof actor.text === "string").map((actor) => actor.text);
    assert.deepEqual(texts, [
        "2 workload plug-ins changed",
        "Installed: Hardware health · Removed: third-party-workload",
        "Dismiss",
    ]);
    // The copy stacks title over detail and takes the free width, so the
    // dismiss control keeps its own edge instead of floating mid-row.
    assert.equal(notice.children[0].vertical, true);
    assert.equal(notice.children[0].x_expand, true);

    button(root, "Dismiss the workload catalog change notice").click();
    assert.deepEqual(calls, [["acknowledgeCatalogChanges"]]);

    // Acknowledgement clears the projection, and the next render hides the row
    // without rebuilding the body underneath it.
    view.render(ViewModel.toViewModel(baseState(), NOW));
    assert.equal(notice.visible, false);

    // A model built before this notice existed carries no field at all; the
    // row must stay hidden rather than render an undefined change set.
    view.render({...ViewModel.toViewModel(baseState(), NOW), catalogNotice: undefined});
    assert.equal(notice.visible, false);
});

// The notice sits outside the tab body so a plug-in change is still reported
// while the popup is showing a safety state.
test("the catalog notice survives the unavailable and paused screens", () => {
    const {view, root} = harness();
    const notice = findActors(root, (actor) => actor.styleClasses
        && actor.styleClasses.has("tpuwm-catalog-notice"))[0];
    for (const overrides of [
        {paused: true},
        {device: {available: false, state: "absent", name: "No device", kind: "unknown", reason: "No accelerator detected"}},
    ]) {
        view.render(ViewModel.toViewModel(baseState({
            ...overrides,
            catalogChanges: {installed: ["desktop-context"], upgraded: [], removed: []},
        }), NOW));
        assert.equal(notice.visible, true);
    }
});
