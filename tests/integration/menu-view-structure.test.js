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

test("the overview lists every accelerator with availability and load", () => {
    const {view, root} = harness();
    view.render(ViewModel.toViewModel(baseState(), NOW));

    const titles = labelsWithClass(root, "tpuwm-profile-title");
    assert.equal(titles.includes("TPU · Coral USB"), true);
    assert.equal(titles.includes("GPU · NVIDIA GPU"), true);
    const descriptions = labelsWithClass(root, "tpuwm-profile-description");
    assert.equal(descriptions.includes("Load 42%"), true);
    assert.equal(descriptions.includes("Absent"), true);
    const headings = labelsWithClass(root, "tpuwm-group-value");
    assert.equal(headings.includes("1 of 2 available"), true);

    view.render(ViewModel.toViewModel(baseState({devices: []}), NOW));
    assert.equal(labelsWithClass(root, "tpuwm-profile-title").includes("TPU · Coral USB"), false);
});

test("metric tiles keep a fixed name, order, and value structure", () => {
    const {view, root} = harness();
    view.render(ViewModel.toViewModel(baseState(), NOW));

    assert.deepEqual(labelsWithClass(root, "tpuwm-metric-name"), [
        "TPU load", "Queue", "Running", "Attention",
    ]);
    assert.deepEqual(labelsWithClass(root, "tpuwm-metric-value"), [
        "42%", "2 jobs", "1 profiles", "0 items",
    ]);

    view.render(ViewModel.toViewModel(baseState({paused: true}), NOW));
    assert.deepEqual(labelsWithClass(root, "tpuwm-metric-value"), [
        "0%", "2 held", "0 profiles", "Paused",
    ]);
    const attention = findActors(root, (actor) => actor.text === "Paused"
        && actor.styleClasses.has("tpuwm-metric-value"));
    assert.equal(attention[0].styleClasses.has("tpuwm-attention"), true);
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

    const brand = icons(root).find((actor) => actor.icon_name === "tpuwm-symbolic");
    assert.deepEqual(
        {
            icon_name: brand.icon_name,
            icon_type: brand.icon_type,
            icon_size: brand.icon_size,
            style_class: brand.style_class,
        },
        {
            icon_name: "tpuwm-symbolic",
            icon_type: "symbolic",
            icon_size: 32,
            style_class: "tpuwm-brand-icon",
        },
    );

    const settings = icons(root).find((actor) => actor.icon_name === "emblem-system-symbolic");
    assert.equal(settings.icon_size, 16);
    assert.equal(settings.icon_type, "symbolic");

    // Every profile keeps its icon, but the tab renders the ones that run
    // before the collapsed group, so the order follows that split rather than
    // catalog order once part of the catalog can run.
    const profileIcons = icons(root).filter((actor) => actor.style_class === "tpuwm-profile-icon");
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

    view.render(ViewModel.toViewModel(baseState({selectedTab: "alerts"}), NOW));
    const hero = icons(root).find((actor) => actor.style_class === "tpuwm-hero-icon");
    assert.deepEqual(
        {name: hero.icon_name, size: hero.icon_size, type: hero.icon_type},
        {name: "emblem-ok-symbolic", size: 36, type: "symbolic"},
    );
});

test("the unavailable screen renders every numbered recovery step", () => {
    const {view, root} = harness();
    view.render(ViewModel.toViewModel(baseState({
        device: {available: false, state: "absent", name: "No TPU", kind: "unknown", reason: "Reconnect device"},
        health: {device: "absent", runtime: "connected", detail: "Reconnect device"},
    }), NOW));

    assert.deepEqual(labelsWithClass(root, "tpuwm-step-number"), ["1", "2", "3"]);
    const rows = findActors(root, (actor) => actor.styleClasses.has("tpuwm-recovery-row"));
    assert.equal(rows.length, 3);
    assert.deepEqual(rows.map((row) => labelsWithClass(row, "tpuwm-profile-title")), [
        ["Check the connection"],
        ["Check device access"],
        ["Retry now"],
    ]);
    assert.deepEqual(
        rows.map((row) => labelsWithClass(row, "tpuwm-profile-description").length),
        [1, 1, 1],
    );
    assert.equal(labelsWithClass(rows[2], "tpuwm-profile-description")[0], "Reconnect device");
});

test("the scrolling body keeps its vertical-only layout contract", () => {
    const {root} = harness();
    const scroll = findActors(root, (actor) => actor instanceof FakeScrollView)[0];

    assert.equal(scroll.style_class, "tpuwm-scroll vfade");
    assert.equal(scroll.x_fill, true);
    assert.equal(scroll.y_fill, false);
    assert.equal(scroll.y_align, "start");
    assert.deepEqual(scroll.policy, ["never", "automatic"]);
    assert.equal(scroll.autoScrolling, true);
    assert.equal(scroll.children.length, 1);
    assert.equal(scroll.children[0].styleClasses.has("tpuwm-body"), true);
    assert.equal(scroll.children[0].vertical, true);
});

test("every interactive control is focusable, reactive, and role-labelled", () => {
    const {view, root} = harness();
    view.render(ViewModel.toViewModel(baseState({selectedTab: "profiles"}), NOW));

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

    const enabled = buttons.filter((button) => !button.styleClasses.has("tpuwm-button-disabled"));
    assert.equal(enabled.every((button) => button.reactive === true), true);
    // The tab strip uses roving focus, so only its selected tab is reachable.
    assert.equal(
        enabled
            .filter((button) => !button.styleClasses.has("tpuwm-tab"))
            .every((button) => button.can_focus === true),
        true,
    );
    assert.equal(
        enabled.filter((button) => button.styleClasses.has("tpuwm-tab") && button.can_focus).length,
        1,
    );

    const disabled = buttons.filter((button) => button.styleClasses.has("tpuwm-button-disabled"));
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
