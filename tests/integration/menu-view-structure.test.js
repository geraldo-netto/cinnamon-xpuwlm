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
    FakeScrollView,
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
        device: {
            id: "tpu-usb",
            backend: "tpu",
            available: true,
            state: "present",
            name: "Coral USB",
            kind: "usb",
            vendor: "",
            load: 42,
            reason: "",
        },
        devices: [
            {
                id: "tpu-usb",
                backend: "tpu",
                available: true,
                state: "present",
                name: "Coral USB",
                kind: "usb",
                vendor: "",
                load: 42,
                reason: "",
            },
            {
                id: "gpu-renderD128",
                backend: "gpu",
                available: false,
                state: "absent",
                name: "NVIDIA GPU",
                kind: "dri",
                vendor: "0x10de",
                load: null,
                reason: "Runtime not installed",
            },
        ],
        health: {device: "present", runtime: "connected", detail: ""},
        metrics: {queueDepth: 2, runningProfiles: 1},
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
        Clutter: {ActorAlign: {CENTER: "center"}},
        Atk: createAtk(),
        menu,
        actions,
    });
    return {menu, view, root: menu.actors[0]};
}

function icons(root) {
    return findActors(root, (actor) => typeof actor.icon_name === "string");
}

function labelsWithClass(root, styleClass) {
    return findActors(root, (actor) => actor.styleClasses.has(styleClass)).map((actor) => actor.text);
}

test("System lists current device and runtime status", () => {
    const {view, root} = harness();
    view.render(ViewModel.toViewModel(baseState({selectedTab: "profiles"}), NOW));

    const titles = labelsWithClass(root, "xpuwlm-profile-title");
    assert.equal(titles.includes("Coral USB"), true);
    assert.equal(titles.includes("Local runtime"), true);
    const descriptions = labelsWithClass(root, "xpuwlm-profile-description");
    assert.equal(descriptions.includes("Ready for workloads"), true);
    assert.equal(labelsWithClass(root, "xpuwlm-status").includes("Ready"), true);

    view.render(ViewModel.toViewModel(baseState({
        selectedTab: "profiles", device: {...baseState().device, name: "Updated device"},
    }), NOW));
    assert.equal(labelsWithClass(root, "xpuwlm-profile-title").includes("Updated device"), true);
});

test("Diagnostics current-state tiles keep approved names and values", () => {
    const {view, root} = harness();
    view.render(ViewModel.toViewModel(baseState({selectedTab: "setup"}), NOW));

    assert.deepEqual(labelsWithClass(root, "xpuwlm-metric-name"), [
        "Ready tools", "Active jobs", "Last update",
    ]);
    assert.equal(labelsWithClass(root, "xpuwlm-metric-value").length, 3);
});

test("the view model always describes exactly four metric tiles", () => {
    const normal = ViewModel.metricModels(baseState({attentionCount: 1}));
    assert.deepEqual(normal, [
        {label: "TPU load", value: "42%"},
        {label: "Queue", value: "2", suffix: "jobs"},
        {label: "Running", value: "1", suffix: "profiles"},
        {label: "Attention", value: "1", suffix: "item · none", tone: "attention"},
    ]);
    assert.deepEqual(ViewModel.metricModels(baseState({paused: true})).at(-1), {
        label: "State",
        value: "Paused",
        tone: "attention",
    });
});

test("every symbolic icon declares a name, type, size, and placement", () => {
    const {view, root} = harness();
    const profiles = ViewModel.toViewModel(baseState({selectedTab: "profiles"}), NOW);
    view.render(profiles);
    view._openDetail("profiles");

    const brand = icons(root).find((actor) => actor.icon_name === "xpuwlm-symbolic");
    assert.deepEqual(
        {
            icon_name: brand.icon_name,
            icon_type: brand.icon_type,
            icon_size: brand.icon_size,
            style_class: brand.style_class,
        },
        {
            icon_name: "xpuwlm-symbolic",
            icon_type: "symbolic",
            icon_size: 28,
            style_class: "xpuwlm-brand-icon",
        },
    );

    const settings = icons(root).find((actor) => actor.icon_name === "emblem-system-symbolic");
    assert.equal(settings.icon_size, 16);
    assert.equal(settings.icon_type, "symbolic");

    // Every profile keeps its icon, but the tab renders the ones that run
    // before the collapsed group, so the order follows that split rather than
    // catalog order once part of the catalog can run.
    const profileIcons = icons(root).filter((actor) => actor.style_class === "xpuwlm-profile-icon");
    assert.equal(profileIcons.length, BuiltIns.coreCatalog().size);
    assert.deepEqual(
        profileIcons.map((actor) => actor.icon_name),
        [
            ...profiles.runnableGroups.flatMap((group) => group.profiles),
            ...profiles.blockedProfiles,
        ].map((profile) => profile.icon),
    );
    assert.deepEqual(
        [...profileIcons.map((actor) => actor.icon_name)].sort(),
        BuiltIns.coreCatalog().definitions().map((definition) => definition.icon).sort(),
    );
    assert.equal(profileIcons.every((actor) => actor.icon_size === 20), true);
    assert.equal(profileIcons.every((actor) => actor.icon_type === "symbolic"), true);

    view.render(ViewModel.toViewModel(baseState({
        selectedTab: "alerts", metrics: {queueDepth: 0, runningProfiles: 0},
    }), NOW));
    const hero = icons(root).find((actor) => actor.style_class === "xpuwlm-healthy-icon");
    assert.deepEqual(
        {name: hero.icon_name, size: hero.icon_size, type: hero.icon_type},
        {name: "emblem-ok-symbolic", size: 28, type: "symbolic"},
    );
});

test("the unavailable screen renders every numbered recovery step", () => {
    const {view, root} = harness();
    view.render(ViewModel.toViewModel(baseState({
        device: {available: false, state: "absent", name: "No TPU", kind: "unknown", reason: "Reconnect device"},
        health: {device: "absent", runtime: "connected", detail: "Reconnect device"},
    }), NOW));

    assert.deepEqual(labelsWithClass(root, "xpuwlm-step-number"), ["1", "2", "3"]);
    const rows = findActors(root, (actor) => actor.styleClasses.has("xpuwlm-recovery-row"));
    assert.equal(rows.length, 3);
    assert.deepEqual(rows.map((row) => labelsWithClass(row, "xpuwlm-profile-title")), [
        ["Check the connection"],
        ["Check device access"],
        ["Retry now"],
    ]);
    assert.deepEqual(
        rows.map((row) => labelsWithClass(row, "xpuwlm-profile-description").length),
        [1, 1, 1],
    );
    assert.equal(labelsWithClass(rows[2], "xpuwlm-profile-description")[0], "Reconnect device");
});

test("the scrolling body keeps its vertical-only layout contract", () => {
    const {root} = harness();
    const scroll = findActors(root, (actor) => actor instanceof FakeScrollView)[0];

    assert.equal(scroll.style_class, "xpuwlm-scroll vfade");
    assert.equal(scroll.x_fill, true);
    assert.equal(scroll.y_fill, false);
    assert.equal(scroll.y_align, "start");
    assert.deepEqual(scroll.policy, ["never", "automatic"]);
    assert.equal(scroll.autoScrolling, true);
    assert.equal(scroll.children.length, 1);
    assert.equal(scroll.children[0].styleClasses.has("xpuwlm-body"), true);
    assert.equal(scroll.children[0].vertical, true);
});

test("every interactive control is focusable, reactive, and role-labelled", () => {
    const {view, root} = harness();
    view.render(ViewModel.toViewModel(baseState({selectedTab: "profiles"}), NOW));
    view._openDetail("profiles");

    const buttons = findActors(root, (actor) => actor instanceof FakeButton);
    assert.equal(buttons.length > 0, true);
    for (const button of buttons) {
        assert.equal(button.track_hover, true, button.accessibleName);
        assert.equal(
            ["push-button", "page-tab", "toggle-button"].includes(button.accessibleRole),
            true,
            button.accessibleName,
        );
        assert.equal(typeof button.accessibleName, "string");
        assert.notEqual(button.accessibleName, "");
        assert.equal(button.styleClasses.size > 0, true, button.accessibleName);
    }

    const enabled = buttons.filter((button) => !button.styleClasses.has("xpuwlm-button-disabled"));
    assert.equal(enabled.every((button) => button.reactive === true), true);
    // The tab strip uses roving focus, so only its selected tab is reachable.
    assert.equal(
        enabled
            .filter((button) => !button.styleClasses.has("xpuwlm-tab"))
            .every((button) => button.can_focus === true),
        true,
    );
    assert.equal(
        enabled.filter((button) => button.styleClasses.has("xpuwlm-tab") && button.can_focus).length,
        1,
    );

    const disabled = buttons.filter((button) => button.styleClasses.has("xpuwlm-button-disabled"));
    assert.equal(disabled.length > 0, true);
    assert.equal(disabled.every((button) => button.reactive === false), true);
    assert.equal(disabled.every((button) => button.can_focus === false), true);
});

test("labels ellipsize on one line so narrow popups never reflow", () => {
    const {view, root} = harness();
    view.render(ViewModel.toViewModel(baseState(), NOW));
    const labels = findActors(root, (actor) => actor.clutter_text !== undefined);
    assert.equal(labels.length > 0, true);
    assert.equal(labels.every((label) => label.clutter_text.line_wrap === false), true);
    assert.equal(labels.every((label) => label.clutter_text.ellipsize === 3), true);
});

test("a profile waiting on consent is offered a command, not an install", () => {
    const {view, root} = harness();
    const state = baseState({selectedTab: "setup"});
    state.profiles = state.profiles.map((profile) => (profile.id === "hardware-health"
        ? {
            ...profile,
            status: "unavailable",
            reason: "consent-missing",
            detail: "needs consent for files:read",
        }
        : profile));

    view.render(ViewModel.toViewModel(state, NOW));
    view._openDetail("setup");

    const titles = labelsWithClass(root, "xpuwlm-group-title");
    assert.equal(
        titles.some((title) => /Grant the permission/u.test(title)),
        true,
        "the setup tab names the remedy",
    );
    const commands = labelsWithClass(root, "xpuwlm-command");
    assert.equal(
        commands.some((command) => command.includes("omnitensor-grant grant")),
        true,
        "and the command that grants it",
    );
    const notes = labelsWithClass(root, "xpuwlm-setup-note");
    assert.equal(
        notes.some((note) => /same user/u.test(note)),
        true,
        "and why it is not a button in this popup",
    );
});
