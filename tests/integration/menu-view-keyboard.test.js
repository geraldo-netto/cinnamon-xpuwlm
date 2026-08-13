"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const Domain = require("../../files/cinnamon-xpuwlm@geraldo-netto/lib/domain.js");
const BuiltIns = require("../helpers/built-in-workloads.js");
const Menu = require("../../files/cinnamon-xpuwlm@geraldo-netto/lib/menu-view.js");
const ViewModel = require("../../files/cinnamon-xpuwlm@geraldo-netto/lib/view-model.js");
const {
    FakeButton,
    FakeMenu,
    createAtk,
    createClutter,
    createSt,
    findActors,
} = require("../helpers/fakes.js");

const NOW = 1_700_000_000_000;
const CLUTTER = createClutter();

function baseState(overrides = {}) {
    return {
        selectedTab: "overview",
        paused: false,
        profiles: new Domain.WorkloadPortfolio(null, BuiltIns.coreCatalog()).list(),
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

function harness(Clutter = CLUTTER) {
    const calls = [];
    const actions = {};
    for (const name of [
        "selectTab", "toggleProfile", "changeWeight",
        "pauseAll", "resumeAll", "refresh", "openSettings",
        "acknowledgeCatalogChanges",
        "submitJob",
    ]) {
        actions[name] = (...args) => calls.push([name, ...args]);
    }
    const menu = new FakeMenu();
    const view = new Menu.MenuView({
        St: createSt(),
        Clutter,
        Atk: createAtk(),
        menu,
        actions,
    });
    return {calls, menu, view, root: menu.actors[0]};
}

function tabs(root) {
    return findActors(root, (actor) => actor instanceof FakeButton
        && actor.styleClasses.has("xpuwlm-tab"));
}

test("key symbols map to the expected tab movements", () => {
    assert.equal(Menu.tabKeyMove(CLUTTER, CLUTTER.KEY_Left), "previous");
    assert.equal(Menu.tabKeyMove(CLUTTER, CLUTTER.KEY_Up), "previous");
    assert.equal(Menu.tabKeyMove(CLUTTER, CLUTTER.KEY_Right), "next");
    assert.equal(Menu.tabKeyMove(CLUTTER, CLUTTER.KEY_Down), "next");
    assert.equal(Menu.tabKeyMove(CLUTTER, CLUTTER.KEY_Home), "first");
    assert.equal(Menu.tabKeyMove(CLUTTER, CLUTTER.KEY_End), "last");
    assert.equal(Menu.tabKeyMove(CLUTTER, CLUTTER.KEY_Return), null);
    assert.equal(Menu.tabKeyMove(null, CLUTTER.KEY_Left), null);
    assert.equal(Menu.tabKeyMove({}, undefined), null);
});

test("tab movement wraps in both directions and jumps to the ends", () => {
    const count = Menu.TAB_NAMES.length;
    assert.deepEqual(Menu.TAB_NAMES, ["overview", "alerts", "profiles", "setup"]);
    assert.equal(Menu.movedTabIndex("next", 0, count), 1);
    assert.equal(Menu.movedTabIndex("next", count - 1, count), 0);
    assert.equal(Menu.movedTabIndex("previous", 0, count), count - 1);
    assert.equal(Menu.movedTabIndex("previous", 1, count), 0);
    assert.equal(Menu.movedTabIndex("first", 2, count), 0);
    assert.equal(Menu.movedTabIndex("first", count - 1, count), 0);
    assert.equal(Menu.movedTabIndex("last", 0, count), count - 1);
    assert.equal(Menu.movedTabIndex("last", 1, count), count - 1);
    assert.equal(Menu.movedTabIndex("next", -1, count), 1);
    assert.equal(Menu.movedTabIndex("next", 99, count), 1);
    assert.equal(Menu.movedTabIndex("unknown", 2, count), 2);
    assert.equal(Menu.movedTabIndex("next", 0, 0), -1);
});

test("arrow keys select and focus the neighbouring tab", () => {
    const {calls, view, root} = harness();
    view.render(ViewModel.toViewModel(baseState(), NOW));
    const [overview, activity, system, setup] = tabs(root);

    assert.deepEqual(overview.pressKey(CLUTTER.KEY_Right), [true]);
    assert.deepEqual(calls, [["selectTab", "alerts"]]);
    assert.equal(activity.focused, true);
    assert.equal(activity.can_focus, true);
    assert.equal(overview.can_focus, false);
    assert.equal(system.can_focus, false);
    assert.equal(setup.can_focus, false);

    view.render(ViewModel.toViewModel(baseState({selectedTab: "alerts"}), NOW));
    activity.pressKey(CLUTTER.KEY_Left);
    assert.deepEqual(calls.at(-1), ["selectTab", "overview"]);
    assert.equal(overview.focused, true);
});

test("arrow selection wraps around the tab strip", () => {
    const {calls, view, root} = harness();
    view.render(ViewModel.toViewModel(baseState(), NOW));
    const [overview, , , setup] = tabs(root);

    overview.pressKey(CLUTTER.KEY_Left);
    assert.deepEqual(calls.at(-1), ["selectTab", "setup"]);
    assert.equal(setup.focused, true);

    view.render(ViewModel.toViewModel(baseState({selectedTab: "setup"}), NOW));
    setup.pressKey(CLUTTER.KEY_Down);
    assert.deepEqual(calls.at(-1), ["selectTab", "overview"]);
});

test("arrow selection skips a disabled tab and still wraps", () => {
    const {calls, view, root} = harness();
    view.render(ViewModel.toViewModel(baseState(), NOW));
    const [overview, activity, system, setup] = tabs(root);
    activity.reactive = false;
    system.reactive = false;

    overview.pressKey(CLUTTER.KEY_Right);
    assert.deepEqual(calls.at(-1), ["selectTab", "setup"]);
    assert.equal(setup.focused, true);

    view.render(ViewModel.toViewModel(baseState({selectedTab: "setup"}), NOW));
    setup.pressKey(CLUTTER.KEY_Right);
    assert.deepEqual(calls.at(-1), ["selectTab", "overview"]);
    assert.equal(overview.focused, true);
});

test("Home and End reach the first and last tab directly", () => {
    const {calls, view, root} = harness();
    view.render(ViewModel.toViewModel(baseState({selectedTab: "profiles"}), NOW));
    const [overview, , system, setup] = tabs(root);

    system.pressKey(CLUTTER.KEY_End);
    assert.deepEqual(calls.at(-1), ["selectTab", "setup"]);
    assert.equal(setup.focused, true);

    view.render(ViewModel.toViewModel(baseState({selectedTab: "setup"}), NOW));
    setup.pressKey(CLUTTER.KEY_Home);
    assert.deepEqual(calls.at(-1), ["selectTab", "overview"]);
    assert.equal(overview.focused, true);
});

test("a key that already targets the active tab refocuses without reselecting", () => {
    const {calls, view, root} = harness();
    view.render(ViewModel.toViewModel(baseState(), NOW));
    const [overview] = tabs(root);

    assert.deepEqual(overview.pressKey(CLUTTER.KEY_Home), [true]);
    assert.deepEqual(calls, []);
    assert.equal(overview.focused, true);
});

test("unhandled keys propagate so Cinnamon keeps its own shortcuts", () => {
    const {calls, view, root} = harness();
    view.render(ViewModel.toViewModel(baseState(), NOW));
    const [overview] = tabs(root);

    assert.deepEqual(overview.pressKey(CLUTTER.KEY_Return), [false]);
    assert.deepEqual(calls, []);
    assert.equal(overview.focused, undefined);
});

test("only the selected tab stays reachable with the Tab key", () => {
    const {view, root} = harness();
    view.render(ViewModel.toViewModel(baseState({selectedTab: "alerts"}), NOW));
    assert.deepEqual(tabs(root).map((tab) => tab.can_focus), [false, true, false, false]);
});

test("a Clutter build without key constants leaves the tab strip inert", () => {
    const {calls, view, root} = harness({ActorAlign: {CENTER: "center"}});
    view.render(ViewModel.toViewModel(baseState(), NOW));
    const [overview] = tabs(root);
    assert.deepEqual(overview.pressKey(0xff53), [false]);
    assert.deepEqual(calls, []);
});

test("a key event without a symbol is ignored", () => {
    const {view} = harness();
    assert.equal(view._onTabKeyPress(null), false);
    assert.equal(view._onTabKeyPress({}), false);
    assert.equal(view._focusTab("missing"), false);
});
