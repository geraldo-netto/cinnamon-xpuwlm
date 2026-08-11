"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const Domain = require("../../files/cinnamon-xpuwlm@geraldo-netto/lib/domain.js");
const BuiltIns = require("../helpers/built-in-workloads.js");
const Menu = require("../../files/cinnamon-xpuwlm@geraldo-netto/lib/menu-view.js");
const ViewModel = require("../../files/cinnamon-xpuwlm@geraldo-netto/lib/view-model.js");
const {
    FakeActor,
    FakeButton,
    FakeMenu,
    createAtk,
    createClutter,
    createSt,
    findActors,
} = require("../helpers/fakes.js");

const NOW = 1_700_000_000_000;

function baseState(overrides = {}) {
    return {
        selectedTab: "profiles",
        paused: false,
        // Focus restoration is about live controls, so every profile here is
        // one the runtime serves; a profile it cannot run has no live control
        // to return the caret to.
        profiles: new Domain.WorkloadPortfolio(null, BuiltIns.coreCatalog()).list({
            ...BuiltIns.servingProfiles(),
            "hardware-health": {status: "running", queued: 2, detail: "Serving on tpu"},
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
        Clutter: createClutter(),
        Atk: createAtk(),
        menu,
        actions,
    });
    return {menu, view, root: menu.actors[0]};
}

function control(root, identity) {
    return findActors(root, (actor) => actor.xpuwlmIdentity === identity)[0];
}

function focused(root) {
    return findActors(root, (actor) => actor.focused === true && actor.xpuwlmIdentity !== undefined)
        .map((actor) => actor.xpuwlmIdentity);
}

test("body controls declare stable semantic identities", () => {
    const {view, root} = harness();
    view.render(ViewModel.toViewModel(baseState(), NOW));

    const identities = Menu.focusableControls(
        findActors(root, (actor) => actor.styleClasses.has("xpuwlm-body"))[0],
    ).map((actor) => actor.xpuwlmIdentity);
    assert.equal(identities.includes("toggle:hardware-health"), true);
    assert.equal(identities.includes("weight-up:hardware-health"), true);
    assert.equal(identities.includes("weight-down:hardware-health"), true);
    assert.equal(
        identities.filter((identity) => identity.startsWith("toggle:")).length,
        BuiltIns.coreCatalog().size,
    );
});

test("focus returns to the same control after an unrelated rebuild", () => {
    const {view, root} = harness();
    view.render(ViewModel.toViewModel(baseState(), NOW));
    control(root, "toggle:storage-intelligence").grab_key_focus();

    const changed = baseState();
    changed.profiles = changed.profiles.map((profile) => profile.id === "hardware-health"
        ? {...profile, queued: 99}
        : profile);
    view.render(ViewModel.toViewModel(changed, NOW));

    assert.deepEqual(focused(root), ["toggle:storage-intelligence"]);
    assert.equal(control(root, "toggle:storage-intelligence").focused, true);
});

test("a vanished control falls back to the first control in the rebuilt body", () => {
    const {view, root} = harness();
    view.render(ViewModel.toViewModel(baseState(), NOW));
    control(root, "weight-up:desktop-context").grab_key_focus();

    view.render(ViewModel.toViewModel(baseState({selectedTab: "overview"}), NOW));

    assert.equal(control(root, "weight-up:desktop-context"), undefined);
    const identities = focused(root);
    assert.equal(identities.length, 1);
    assert.equal(identities[0].startsWith("toggle:"), true);
});

test("a body without any control hands focus to the selected tab", () => {
    const {view, root} = harness();
    view.render(ViewModel.toViewModel(baseState(), NOW));
    control(root, "toggle:hardware-health").grab_key_focus();

    view.render(ViewModel.toViewModel(baseState({
        selectedTab: "alerts",
        device: {available: false, name: "No TPU", kind: "unknown", reason: "Reconnect"},
    }), NOW));
    assert.equal(control(root, "retry-detection").focused, true);

    view.render(ViewModel.toViewModel(baseState({selectedTab: "alerts"}), NOW));
    const tab = findActors(root, (actor) => actor instanceof FakeButton
        && actor.accessibleName === "Alerts tab, selected")[0];
    assert.equal(tab.focused, true);
    assert.equal(view._focusedIdentity, null);
});

test("a rebuild never steals focus from a control outside the body", () => {
    const {view, root} = harness();
    view.render(ViewModel.toViewModel(baseState(), NOW));
    const pause = findActors(root, (actor) => actor instanceof FakeButton
        && actor.accessibleName === "Pause all workloads")[0];
    pause.grab_key_focus();
    assert.equal(view._focusedIdentity, null);

    view.render(ViewModel.toViewModel(baseState({selectedTab: "overview"}), NOW));
    assert.deepEqual(focused(root), []);
    assert.equal(pause.focused, true);
});

test("paused and recovery screens keep their own recovery targets", () => {
    const {view, root} = harness();
    view.render(ViewModel.toViewModel(baseState(), NOW));
    control(root, "toggle:hardware-health").grab_key_focus();

    view.render(ViewModel.toViewModel(baseState({paused: true}), NOW));
    assert.equal(control(root, "resume-all").focused, true);

    view.render(ViewModel.toViewModel(baseState({
        device: {available: false, name: "No TPU", kind: "unknown", reason: "Reconnect"},
    }), NOW));
    assert.equal(control(root, "retry-detection").focused, true);
});

test("focusable control discovery skips unreachable and unidentified actors", () => {
    const root = new FakeActor();
    const plain = new FakeActor();
    const identified = new FakeButton();
    identified.xpuwlmIdentity = "reachable";
    const unreachable = new FakeButton();
    unreachable.xpuwlmIdentity = "unreachable";
    unreachable.can_focus = false;
    root.add_child(plain);
    plain.add_child(identified);
    plain.add_child(unreachable);

    assert.deepEqual(
        Menu.focusableControls(root).map((actor) => actor.xpuwlmIdentity),
        ["reachable"],
    );
    assert.deepEqual(Menu.focusableControls(new FakeActor()), []);
});

test("restoring focus without a previous identity does nothing", () => {
    const {view, root} = harness();
    view.render(ViewModel.toViewModel(baseState(), NOW));
    assert.equal(view._restoreBodyFocus(null), null);
    assert.equal(view._restoreBodyFocus(undefined), null);
    assert.deepEqual(focused(root), []);
});
