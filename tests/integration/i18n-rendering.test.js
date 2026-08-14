"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const AlertNotifier = require("../../files/cinnamon-xpuwlm@geraldo-netto/lib/alert-notifier.js");
const BuiltIns = require("../helpers/built-in-workloads.js");
const DocumentQuestion = require("../../files/cinnamon-xpuwlm@geraldo-netto/lib/document-question.js");
const Domain = require("../../files/cinnamon-xpuwlm@geraldo-netto/lib/domain.js");
const EventImport = require("../../files/cinnamon-xpuwlm@geraldo-netto/lib/event-import.js");
const FileOrganizer = require("../../files/cinnamon-xpuwlm@geraldo-netto/lib/file-organizer.js");
const I18n = require("../../files/cinnamon-xpuwlm@geraldo-netto/lib/i18n.js");
const Layout = require("../../files/cinnamon-xpuwlm@geraldo-netto/lib/layout.js");
const MediaTranscription = require("../../files/cinnamon-xpuwlm@geraldo-netto/lib/media-transcription.js");
const Menu = require("../../files/cinnamon-xpuwlm@geraldo-netto/lib/menu-view.js");
const PluginInventory = require("../../files/cinnamon-xpuwlm@geraldo-netto/lib/plugin-inventory.js");
const SelectedText = require("../../files/cinnamon-xpuwlm@geraldo-netto/lib/selected-text.js");
const ViewModel = require("../../files/cinnamon-xpuwlm@geraldo-netto/lib/view-model.js");
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
        assert.equal(model.panel.tooltip, "[XPU Workload Manager — online]");
        assert.equal(model.panel.label.startsWith("[TPU]"), true);
        assert.equal(model.runtimeStatus, "[Online]");
        assert.equal(model.headerSubtitle.includes("[Online]"), false);
        assert.equal(model.headerSubtitle.includes("[2 active jobs]"), true);
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
        assert.equal(labels.includes("[XPU Workload Manager]"), true);
        assert.equal(labels.includes("[Tools]"), true);
        const model = ViewModel.toViewModel(liveState(), NOW);
        view.render(model);
        const tabButtons = findActors(root, (actor) => actor.styleClasses && actor.styleClasses.has("xpuwlm-tab"));
        assert.deepEqual(tabButtons.map((button) => button.accessibleName), [
            "[%s tab, selected]".replace("%s", "[Tools]"),
            "[%s tab]".replace("%s", "[Activity]"),
            "[%s tab]".replace("%s", "[System]"),
            "[%s tab]".replace("%s", "[Diagnostics]"),
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
        assert.equal(message.summary, "[XPU critical alert — %s]".replace("%s", "[Unknown profile]"));
    } finally {
        I18n.reset();
    }
});

test("workflow status and readiness details use the shared translation port", () => {
    try {
        pseudoLocale();
        assert.deepEqual([
            EventImport.initialState().availabilityDetail,
            DocumentQuestion.initialState().availabilityDetail,
            SelectedText.initialState().availabilityDetail,
            FileOrganizer.initialState().availabilityDetail,
            MediaTranscription.initialState().availabilityDetail,
        ], [
            "[Event provider is not ready]",
            "[Document provider is not ready]",
            "[Selected-text provider is not ready]",
            "[File organizer provider is not ready]",
            "[Media transcription provider is not ready]",
        ]);

        const emptyInventory = {version: 1, generatedAt: 1, plugins: []};
        assert.deepEqual([
            PluginInventory.eventReadiness(emptyInventory).detail,
            PluginInventory.documentQuestionReadiness(emptyInventory).detail,
            PluginInventory.selectedTextReadiness(emptyInventory).detail,
            PluginInventory.fileOrganizerReadiness(emptyInventory).detail,
            PluginInventory.mediaTranscriptionReadiness(emptyInventory).detail,
        ], [
            "[Install and configure the event-extraction provider]",
            "[Install and configure the ask-selected-files provider]",
            "[Install and configure a selected-text provider]",
            "[Install and configure a file-organizer provider]",
            "[Install and configure the media-transcription provider]",
        ]);

        assert.equal(PluginInventory.readinessDetail({
            source: "external",
            workerState: "ready",
            protocol: {capabilities: ["execute"]},
            permissions: [],
            artifacts: [{id: "qwen-events", ready: false, reason: ""}],
        }), "[Install qwen-events]");
    } finally {
        I18n.reset();
    }
});
