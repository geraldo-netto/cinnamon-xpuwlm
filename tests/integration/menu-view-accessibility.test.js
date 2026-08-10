"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const Domain = require("../../files/cinnamon-tpuwm@geraldo-netto/lib/domain.js");
const BuiltIns = require("../helpers/built-in-workloads.js");
const Menu = require("../../files/cinnamon-tpuwm@geraldo-netto/lib/menu-view.js");
const ViewModel = require("../../files/cinnamon-tpuwm@geraldo-netto/lib/view-model.js");
const {
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
        profiles: new Domain.WorkloadPortfolio(null, BuiltIns.coreCatalog())
            .list(BuiltIns.servingProfiles()),
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

function harness(Atk = createAtk()) {
    const actions = {};
    for (const name of [
        "selectTab", "toggleProfile", "changeWeight",
        "pauseAll", "resumeAll", "refresh", "openSettings",
        "acknowledgeCatalogChanges",
        "submitJob",
    ]) {
        actions[name] = () => {};
    }
    const menu = new FakeMenu();
    const view = new Menu.MenuView({
        St: createSt(),
        Clutter: {ActorAlign: {CENTER: "center"}},
        Atk,
        menu,
        actions,
    });
    return {menu, view, root: menu.actors[0]};
}

function tabs(root) {
    return findActors(root, (actor) => actor instanceof FakeButton
        && actor.styleClasses.has("tpuwm-tab"));
}

function toggles(root) {
    return findActors(root, (actor) => actor instanceof FakeButton
        && actor.styleClasses.has("tpuwm-toggle"));
}

test("the tab strip exposes a tab list containing page tabs", () => {
    const {root} = harness();
    const strip = findActors(root, (actor) => actor.styleClasses.has("tpuwm-tabs"))[0];
    assert.equal(strip.accessibleRole, "page-tab-list");
    assert.deepEqual(tabs(root).map((tab) => tab.accessibleRole), [
        "page-tab", "page-tab", "page-tab", "page-tab",
    ]);
});

test("the selected state follows the active tab in both directions", () => {
    const {view, root} = harness();
    view.render(ViewModel.toViewModel(baseState(), NOW));
    assert.deepEqual(
        tabs(root).map((tab) => tab.accessibleStates.has("selected")),
        [true, false, false, false],
    );

    view.render(ViewModel.toViewModel(baseState({selectedTab: "alerts"}), NOW));
    assert.deepEqual(
        tabs(root).map((tab) => tab.accessibleStates.has("selected")),
        [false, false, true, false],
    );
    assert.deepEqual(tabs(root).map((tab) => tab.accessibleName), [
        "Overview tab", "Profiles tab", "Alerts tab, selected", "Setup tab",
    ]);
});

test("profile toggles are toggle buttons carrying their checked state", () => {
    const {view, root} = harness();
    view.render(ViewModel.toViewModel(baseState({selectedTab: "profiles"}), NOW));

    const controls = toggles(root);
    assert.equal(controls.length, BuiltIns.coreCatalog().size);
    assert.equal(controls.every((toggle) => toggle.accessibleRole === "toggle-button"), true);
    assert.deepEqual(
        controls.map((toggle) => toggle.accessibleStates.has("checked")),
        BuiltIns.coreCatalog().definitions().map((definition) => definition.defaultEnabled),
    );

    const disabled = baseState({selectedTab: "profiles"});
    disabled.profiles = disabled.profiles.map((profile) => ({...profile, enabled: false}));
    view.render(ViewModel.toViewModel(disabled, NOW));
    assert.equal(toggles(root).every((toggle) => !toggle.accessibleStates.has("checked")), true);
});

test("unavailable weight controls report an insensitive state", () => {
    const {view, root} = harness();
    view.render(ViewModel.toViewModel(baseState({selectedTab: "profiles"}), NOW));

    const decrease = findActors(root, (actor) => actor instanceof FakeButton
        && actor.accessibleName === "Decrease Desktop context weight")[0];
    assert.equal(decrease.accessibleStates.has("sensitive"), false);

    const increase = findActors(root, (actor) => actor instanceof FakeButton
        && actor.accessibleName === "Increase Desktop context weight")[0];
    assert.equal(increase.accessibleStates.has("sensitive"), true);
});

test("action buttons keep the push button role", () => {
    const {view, root} = harness();
    view.render(ViewModel.toViewModel(baseState(), NOW));
    for (const name of [
        "Pause all workloads",
        "Manage workload profiles",
        "Refresh TPU status",
        "Open TPU Workload Manager settings",
    ]) {
        const button = findActors(root, (actor) => actor.accessibleName === name)[0];
        assert.equal(button.accessibleRole, "push-button", name);
    }
});

test("a Cinnamon build without Atk roles or states still renders", () => {
    for (const Atk of [null, {}, {Role: {}}, {StateType: {}}]) {
        const {view, root} = harness(Atk);
        assert.doesNotThrow(() => view.render(ViewModel.toViewModel(
            baseState({selectedTab: "profiles"}),
            NOW,
        )));
        assert.equal(tabs(root).every((tab) => tab.accessibleStates.size === 0), true);
        assert.equal(toggles(root).every((toggle) => toggle.accessibleStates.size === 0), true);
    }
});

test("actors without accessible state support are left untouched", () => {
    const {view} = harness();
    const bare = {};
    assert.equal(view._setAccessibleRole(bare, "PUSH_BUTTON"), false);
    assert.equal(view._setAccessibleState(bare, "SELECTED", true), false);
    assert.equal(view._setAccessibleState(bare, "SELECTED", false), false);
    assert.equal(view._setAccessibleRole({set_accessible_role() {}}, "MISSING_ROLE"), false);
    assert.equal(view._setAccessibleState({add_accessible_state() {}}, "MISSING_STATE", true), false);
});
