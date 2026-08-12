"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const Domain = require("../../files/cinnamon-xpuwlm@geraldo-netto/lib/domain.js");
const BuiltIns = require("../helpers/built-in-workloads.js");
const Layout = require("../../files/cinnamon-xpuwlm@geraldo-netto/lib/layout.js");
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

const WIDE = Layout.popupLayout({
    workAreaWidth: 1920, workAreaHeight: 1080, scaleFactor: 1, textScaleFactor: 1,
});
const COMPACT = Layout.popupLayout({
    workAreaWidth: 480, workAreaHeight: 900, scaleFactor: 1, textScaleFactor: 1,
});
const DENSE = Layout.popupLayout({
    workAreaWidth: 800, workAreaHeight: 1200, scaleFactor: 2, textScaleFactor: 1,
});

function alertState(overrides = {}) {
    return {
        selectedTab: "alerts",
        paused: false,
        profiles: new Domain.WorkloadPortfolio(null, BuiltIns.coreCatalog()).list(),
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
        health: {device: "present", runtime: "connected", detail: ""},
        metrics: {queueDepth: 2, runningProfiles: 1},
        alerts: [{
            id: "power-risk",
            profileId: "hardware-health",
            title: "Voltage drift",
            summary: "Review the recent voltage trend",
            severity: "warning",
            timestamp: NOW,
            confidence: 0.8,
            riskScore: 0.7,
            resolved: false,
        }],
        attentionCount: 1,
        stale: false,
        source: "runtime",
        generatedAt: NOW,
        ...overrides,
    };
}

function harness(layout) {
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
        layout,
    });
    return {menu, view, root: menu.actors[0]};
}

function scrollView(root) {
    return findActors(root, (actor) => actor instanceof FakeScrollView)[0];
}

test("the wide layout keeps single-line rows", () => {
    const {view, root} = harness(WIDE);
    view.render(ViewModel.toViewModel(alertState(), NOW));

    assert.equal(root.styleClasses.has("xpuwlm-mode-wide"), true);
    assert.equal(root.style, `min-width: ${WIDE.widthPx}px; max-width: ${WIDE.widthPx}px;`);
    assert.equal(
        scrollView(root).style,
        `min-height: ${WIDE.scrollHeightPx}px; max-height: ${WIDE.scrollHeightPx}px;`,
    );

    const subtitle = findActors(root, (actor) => actor.styleClasses.has("xpuwlm-subtitle"))[0];
    assert.equal(subtitle.clutter_text.line_wrap, false);
    assert.equal(subtitle.clutter_text.ellipsize, 3);

    const evidence = findActors(root, (actor) => actor.styleClasses.has("xpuwlm-evidence"))[0];
    assert.equal(evidence.vertical, false);
});

// Every shipped workload that declares no model is collapsed here, which today
// is all of them but one: the popup renders one limitation line per collapsed
// profile plus the group's own summary, and one setup section — a description,
// a note, and a title and reason per profile — because they all need the same
// remedy.
const COLLAPSED = BuiltIns.coreCatalog().definitions()
    .filter((definition) => !definition.executable).length;

test("a narrow popup wraps the wording that explains a profile it cannot run", () => {
    const {view, root} = harness(COMPACT);
    view.render(ViewModel.toViewModel(alertState({selectedTab: "profiles"}), NOW));
    view._openDetail("profiles");

    const wrapping = findActors(root, (actor) => actor.styleClasses.has("xpuwlm-profile-limitation")
        || actor.styleClasses.has("xpuwlm-disclosure-summary")
        || actor.styleClasses.has("xpuwlm-empty-note")
        || actor.styleClasses.has("xpuwlm-run-note"));
    // The run note explains why no picture can be submitted; it is prose like
    // the rest and must wrap rather than ellipsize.
    assert.equal(wrapping.length, COLLAPSED + 1);
    assert.equal(wrapping.every((label) => label.clutter_text.line_wrap === true), true);

    const diagnostics = ViewModel.toViewModel(alertState({selectedTab: "setup"}), NOW);
    view.render(diagnostics);
    view._openDetail("setup");
    const setup = findActors(root, (actor) => actor.styleClasses.has("xpuwlm-setup-description")
        || actor.styleClasses.has("xpuwlm-setup-note")
        || actor.styleClasses.has("xpuwlm-profile-title")
        || actor.styleClasses.has("xpuwlm-profile-description"));
    assert.equal(setup.length, COLLAPSED * 2 + 2 + diagnostics.diagnostics.toolSetup.length * 2);
    assert.equal(setup.every((label) => label.clutter_text.line_wrap === true), true);
});

// A command is the one string a wide popup must not shorten: an ellipsized
// command is one the user cannot retype or select whole.
test("a command always wraps, whatever the popup mode decides for prose", () => {
    for (const layout of [WIDE, COMPACT, DENSE]) {
        const {view, root} = harness(layout);
        view.render(ViewModel.toViewModel(alertState({selectedTab: "setup"}), NOW));
        view._openDetail("setup");
        const commands = findActors(root, (actor) => actor.styleClasses.has("xpuwlm-command"));
        assert.equal(commands.length, 1, layout.mode);
        assert.equal(commands[0].clutter_text.line_wrap, true, layout.mode);
        assert.equal(commands[0].clutter_text.ellipsize, 0, layout.mode);
    }
});

test("a narrow work area wraps text and shrinks the scroll", () => {
    const {view, root} = harness(COMPACT);
    view.render(ViewModel.toViewModel(alertState(), NOW));

    assert.equal(root.styleClasses.has("xpuwlm-mode-compact"), true);
    assert.equal(root.styleClasses.has("xpuwlm-mode-wide"), false);
    assert.equal(COMPACT.widthPx < WIDE.widthPx, true);
    assert.equal(root.style, `min-width: ${COMPACT.widthPx}px; max-width: ${COMPACT.widthPx}px;`);

    const wrapping = findActors(root, (actor) => actor.styleClasses.has("xpuwlm-subtitle")
        || actor.styleClasses.has("xpuwlm-catalog-notice-detail")
        || actor.styleClasses.has("xpuwlm-alert-summary")
        || actor.styleClasses.has("xpuwlm-alert-title"));
    assert.equal(wrapping.length, 4);
    assert.equal(wrapping.every((label) => label.clutter_text.line_wrap === true), true);
    assert.equal(wrapping.every((label) => label.clutter_text.ellipsize === 0), true);

    const evidence = findActors(root, (actor) => actor.styleClasses.has("xpuwlm-evidence"))[0];
    assert.equal(evidence.vertical, false, "two evidence columns still fit at 520 pixels");
});

test("the dense layout stacks alert evidence into one column", () => {
    const {view, root} = harness(DENSE);
    view.render(ViewModel.toViewModel(alertState(), NOW));

    assert.equal(root.styleClasses.has("xpuwlm-mode-dense"), true);
    const evidence = findActors(root, (actor) => actor.styleClasses.has("xpuwlm-evidence"))[0];
    assert.equal(evidence.vertical, true);
    assert.equal(evidence.children.length, 2);
});

test("every essential control survives the narrowest supported popup", () => {
    const {view, root} = harness(DENSE);
    view.render(ViewModel.toViewModel(alertState({selectedTab: "profiles"}), NOW));
    view._openDetail("profiles");

    const names = findActors(root, (actor) => actor instanceof FakeButton)
        .filter((button) => button.visible)
        .map((button) => button.accessibleName);
    for (const required of [
        "Tools tab",
        "System tab",
        "Activity tab",
        "Diagnostics tab",
        "Back to System",
        "Disable Hardware health",
    ]) {
        assert.equal(names.some((name) => name.startsWith(required)), true, required);
    }
    assert.equal(scrollView(root).policy[1], "automatic");
});

test("re-applying a layout rebuilds structure only when it actually changes", () => {
    const {view, root} = harness(WIDE);
    view.render(ViewModel.toViewModel(alertState(), NOW));

    assert.equal(view.applyLayout(Layout.popupLayout({
        workAreaWidth: 1920, workAreaHeight: 1080, scaleFactor: 1, textScaleFactor: 1,
    })), false);

    assert.equal(view.applyLayout(COMPACT), true);
    assert.equal(root.styleClasses.has("xpuwlm-mode-compact"), true);
    const subtitle = findActors(root, (actor) => actor.styleClasses.has("xpuwlm-subtitle"))[0];
    const noticeDetail = findActors(root, (actor) => actor.styleClasses.has("xpuwlm-catalog-notice-detail"))[0];
    assert.equal(subtitle.clutter_text.line_wrap, true);
    assert.equal(noticeDetail.clutter_text.line_wrap, true);

    assert.equal(view.applyLayout(WIDE), true);
    assert.equal(subtitle.clutter_text.line_wrap, false);
    assert.equal(noticeDetail.clutter_text.line_wrap, false);
    assert.equal(root.styleClasses.has("xpuwlm-mode-compact"), false);
    assert.equal(root.styleClasses.has("xpuwlm-mode-wide"), true);
});

test("every tab keeps the largest tab's fixed viewport", () => {
    const {view, root} = harness(WIDE);
    const scroll = scrollView(root);
    const scrollContent = scroll.children[0];
    const expected = `min-height: ${WIDE.scrollHeightPx}px; max-height: ${WIDE.scrollHeightPx}px;`;

    for (const selectedTab of Menu.TAB_NAMES) {
        view.render(ViewModel.toViewModel(alertState({selectedTab}), NOW));
        assert.equal(scroll.style, expected, selectedTab);
        assert.equal(scroll.y_fill, true, selectedTab);
        assert.equal(scrollContent.style, `min-height: ${WIDE.scrollHeightPx}px;`, selectedTab);
        assert.equal(view._footer.parent, scrollContent, selectedTab);
    }
});

test("a view without a rendered model still accepts a layout change", () => {
    const {view, root} = harness(WIDE);
    assert.equal(view.applyLayout(DENSE), true);
    assert.equal(root.styleClasses.has("xpuwlm-mode-dense"), true);
    assert.equal(view.applyLayout(null), true);
    assert.equal(root.styleClasses.has("xpuwlm-mode-wide"), true);
});

test("the default layout applies when the caller supplies none", () => {
    const {root} = harness(undefined);
    assert.equal(root.styleClasses.has("xpuwlm-mode-wide"), true);
    assert.equal(root.style, `min-width: ${Layout.PREFERRED_WIDTH}px; max-width: ${Layout.PREFERRED_WIDTH}px;`);
});
