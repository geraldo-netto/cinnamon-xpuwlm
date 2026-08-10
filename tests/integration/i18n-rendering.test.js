"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const AlertNotifier = require("../../files/cinnamon-tpuwm@geraldo-netto/lib/alert-notifier.js");
const BuiltIns = require("../helpers/built-in-workloads.js");
const Domain = require("../../files/cinnamon-tpuwm@geraldo-netto/lib/domain.js");
const I18n = require("../../files/cinnamon-tpuwm@geraldo-netto/lib/i18n.js");
const Layout = require("../../files/cinnamon-tpuwm@geraldo-netto/lib/layout.js");
const Menu = require("../../files/cinnamon-tpuwm@geraldo-netto/lib/menu-view.js");
const ViewModel = require("../../files/cinnamon-tpuwm@geraldo-netto/lib/view-model.js");
const {FakeMenu, createAtk, createClutter, createSt, findActors} = require("../helpers/fakes.js");

const NOW = 1_700_000_000_000;

// A pseudo-locale that brackets every translated msgid, proving each rendered
// string flows through the shared translation port rather than a literal.
function pseudoLocale() {
    return I18n.install({
        translate: (msgid) => `[${msgid}]`,
        translatePlural: (singular, plural, count) => `[${count === 1 ? singular : plural}]`,
    });
}

function liveState(overrides = {}) {
    return {
        selectedTab: "overview",
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
            load: 55,
            reason: "",
        },
        devices: [],
        health: {device: "present", runtime: "connected", detail: ""},
        metrics: {queueDepth: 1, runningProfiles: 2},
        alerts: [],
        attentionCount: 0,
        stale: false,
        source: "runtime",
        generatedAt: NOW,
        control: {pending: false, message: ""},
        ...overrides,
    };
}

test("panel and header strings are translated through the port", () => {
    try {
        pseudoLocale();
        const model = ViewModel.toViewModel(liveState(), NOW);
        assert.equal(model.panel.tooltip, "[TPU Workload Manager — online]");
        assert.equal(model.panel.label.startsWith("[TPU]"), true);
        assert.equal(model.runtimeStatus, "[Online]");
        assert.equal(model.headerSubtitle.includes("[Online]"), true);
        assert.equal(model.headerSubtitle.includes("[Updated %s]".replace("%s", "[just now]")), true);
        assert.equal(model.metrics[1].label, "[Queue]");
        assert.equal(model.metrics[1].suffix, "[jobs]");
    } finally {
        I18n.reset();
    }
});

test("plural review summaries translate with their counts substituted", () => {
    try {
        pseudoLocale();
        assert.equal(ViewModel.attentionReviewText(1), "[1 item needs review]");
        assert.equal(ViewModel.attentionReviewText(3), "[3 items need review]");
    } finally {
        I18n.reset();
    }
    assert.equal(ViewModel.attentionReviewText(1), "1 item needs review");
    assert.equal(ViewModel.attentionReviewText(3), "3 items need review");
});

test("recovery guidance and severity text translate through the port", () => {
    try {
        pseudoLocale();
        const model = ViewModel.toViewModel(liveState({
            device: {available: false, reason: "unplugged", state: "absent", name: "", backend: null},
            health: {device: "absent", runtime: "absent", detail: ""},
            source: "probe",
        }), NOW);
        assert.equal(model.recovery.kicker, "[Runtime absent]");
        assert.equal(model.recovery.steps.at(-1).title, "[Retry now]");
        assert.equal(ViewModel.severityText("critical"), "[critical]");
        assert.equal(ViewModel.severityText(null), "[none]");
    } finally {
        I18n.reset();
    }
});

test("menu chrome renders translated labels and accessible names", () => {
    try {
        pseudoLocale();
        const menu = new FakeMenu();
        const view = new Menu.MenuView({
            St: createSt(),
            Clutter: createClutter(),
            Atk: createAtk(),
            menu,
            layout: Layout.defaultLayout(),
            actions: {
                selectTab() {}, toggleProfile() {}, changeWeight() {},
                pauseAll() {}, resumeAll() {}, refresh() {}, openSettings() {},
                acknowledgeCatalogChanges() {},
                submitJob() {},
            },
        });
        const root = menu.actors[0];
        const labels = findActors(root, (actor) => typeof actor.text === "string").map((actor) => actor.text);
        assert.equal(labels.includes("[TPU Workload Manager]"), true);
        assert.equal(labels.includes("[Pause all]"), true);
        assert.equal(labels.includes("[Overview]"), true);
        const model = ViewModel.toViewModel(liveState(), NOW);
        view.render(model);
        const tabButtons = findActors(root, (actor) => actor.styleClasses && actor.styleClasses.has("tpuwm-tab"));
        assert.deepEqual(tabButtons.map((button) => button.accessibleName), [
            "[%s tab, selected]".replace("%s", "[Overview]"),
            "[%s tab]".replace("%s", "[Profiles]"),
            "[%s tab]".replace("%s", "[Alerts]"),
            "[%s tab]".replace("%s", "[Setup]"),
        ]);
    } finally {
        I18n.reset();
    }
});

test("critical notifications translate their summary prefix", () => {
    try {
        pseudoLocale();
        const message = AlertNotifier.notificationMessage(
            {profileId: "missing", title: "Overheat", summary: ""},
            [],
        );
        assert.equal(message.summary, "[TPU critical alert — %s]".replace("%s", "[Unknown profile]"));
    } finally {
        I18n.reset();
    }
});
