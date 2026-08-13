"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const Domain = require("../../files/cinnamon-xpuwlm@geraldo-netto/lib/domain.js");
const Menu = require("../../files/cinnamon-xpuwlm@geraldo-netto/lib/menu-view.js");
const ViewModel = require("../../files/cinnamon-xpuwlm@geraldo-netto/lib/view-model.js");
const BuiltIns = require("../helpers/built-in-workloads.js");
const {FakeButton, FakeMenu, createAtk, createSt, findActors} = require("../helpers/fakes.js");

const NOW = 1_700_000_000_000;

function workflow(overrides = {}) {
    return {
        available: true, availabilityDetail: "", phase: "idle", sources: [],
        jobId: "", message: "", progress: null, candidates: [], duplicatesDropped: 0,
        exportedPath: "", answer: "", providerId: "", accelerator: "", citations: [],
        operation: "", result: "", tasks: [], evidence: null, plan: [],
        ...overrides,
    };
}

function state(overrides = {}) {
    return {
        selectedTab: "overview",
        paused: false,
        profiles: new Domain.WorkloadPortfolio(null, BuiltIns.coreCatalog()).list(
            BuiltIns.servingProfiles(),
        ),
        device: {
            id: "gpu-renderD128", backend: "gpu", available: true, state: "present",
            name: "AMD GPU", kind: "dri", vendor: "0x1002", load: 12, reason: "",
        },
        devices: [],
        health: {device: "present", runtime: "connected", detail: ""},
        metrics: {queueDepth: 0, runningProfiles: 0},
        alerts: [], attentionCount: 0, stale: false, source: "runtime", generatedAt: NOW,
        control: {pending: false, message: "", available: true},
        inputs: {
            roots: ["/home/tester/pictures"], pictures: [],
            runnable: ["visual-library"], omitted: 0,
        },
        eventImport: workflow(), documentQuestion: workflow(),
        selectedText: workflow(), fileOrganizer: workflow(),
        mediaTranscription: workflow({result: null}),
        ...overrides,
    };
}

function harness() {
    const calls = [];
    const actions = {};
    for (const name of [
        "selectTab", "toggleProfile", "changeWeight", "pauseAll", "resumeAll", "refresh",
        "openSettings", "acknowledgeCatalogChanges", "submitJob", "clearActivity",
        "openLogs", "copyReport", "chooseEventFiles", "chooseEventFolder", "startEventImport",
        "cancelEventImport", "editEventCandidate", "decideEventCandidate", "beginEventExport",
        "confirmEventExport", "backEventPreview", "resetEventImport", "chooseQuestionFiles",
        "startDocumentQuestion", "cancelDocumentQuestion", "resetDocumentQuestion",
        "startSelectedText", "cancelSelectedText", "resetSelectedText", "chooseOrganizerFiles",
        "startFileOrganizer", "cancelFileOrganizer", "resetFileOrganizer",
        "chooseMediaFile", "startMediaTranscription", "cancelMediaTranscription",
        "resetMediaTranscription",
    ]) {
        actions[name] = (...args) => {
            calls.push([name, ...args]);
            return true;
        };
    }
    const menu = new FakeMenu();
    const view = new Menu.MenuView({
        St: createSt(), Clutter: {ActorAlign: {CENTER: "center"}}, Atk: createAtk(),
        menu, actions,
    });
    return {calls, view, root: menu.actors[0]};
}

function button(root, name) {
    return findActors(root, (actor) => actor instanceof FakeButton && actor.accessibleName === name)[0];
}

function labels(root) {
    return findActors(root, (actor) => typeof actor.text === "string").map((actor) => actor.text);
}

test("task-first tabs and header match the approved hierarchy", () => {
    const {view, root} = harness();
    view.render(ViewModel.toViewModel(state(), NOW));

    assert.deepEqual(Menu.TAB_NAMES, ["overview", "alerts", "profiles", "setup"]);
    for (const name of ["Tools tab, selected", "Activity tab", "System tab", "Diagnostics tab"]) {
        assert.ok(button(root, name));
    }
    assert.equal(labels(root).includes("Available now"), false);
    assert.equal(labels(root).includes("Choose what you want to do"), false);
    assert.equal(button(root, "Pause all workloads"), undefined);
    assert.equal(button(root, "Open XPU Workload Manager settings") !== undefined, true);
    assert.equal(findActors(root, (actor) => actor.styleClasses?.has("xpuwlm-status")
        && actor.parent?.styleClasses?.has("xpuwlm-title-row")).length, 0);
    assert.equal(root.styleClasses.has("xpuwlm-screen-overview"), true);
    assert.equal(findActors(root, (actor) => actor.styleClasses?.has("xpuwlm-content")).length, 1);
    assert.equal(view._footer.x_expand, true);
});

test("Tools lists five live tasks and opens one focused workflow", () => {
    const {view, root} = harness();
    view.render(ViewModel.toViewModel(state(), NOW));
    const tools = findActors(root, (actor) => actor.xpuwlmIdentity?.startsWith("tool:"));
    assert.deepEqual(tools.map((actor) => actor.xpuwlmIdentity), [
        "tool:documents", "tool:events", "tool:text", "tool:organizer", "tool:media",
    ]);
    assert.equal(tools.every((actor) => actor.children[0].children[0].icon_size === 24), true);
    assert.equal(tools.every((actor) => actor.children[0].children[1].x_expand === true), true);

    tools[0].click();
    assert.ok(button(root, "Back to Tools"));
    assert.ok(button(root, "Choose documents for one question"));
    assert.equal(findActors(root, (actor) => actor.xpuwlmIdentity?.startsWith("tool:")).length, 0);
    button(root, "Back to Tools").click();
    assert.equal(findActors(root, (actor) => actor.xpuwlmIdentity?.startsWith("tool:")).length, 5);
});

test("media tool clicks through selection, run, multilingual result, copy, and clear", () => {
    const {calls, view, root} = harness();
    view.render(ViewModel.toViewModel(state(), NOW));
    view._openDetail("media");
    button(root, "Choose one audio, document, image, video, or presentation file").click();
    assert.deepEqual(calls.at(-1), ["chooseMediaFile"]);

    const selected = workflow({
        phase: "selected", result: null,
        sources: [{name: "clip.mp4", path: "/private/clip.mp4", size: 42}],
    });
    view.render(ViewModel.toViewModel(state({mediaTranscription: selected}), NOW));
    button(root, "Transcribe the explicitly selected media locally").click();
    assert.deepEqual(calls.at(-1), ["startMediaTranscription"]);

    const complete = workflow({
        phase: "complete", providerId: "media-vulkan", accelerator: "gpu",
        sources: selected.sources,
        result: {
            source: {fileName: "clip.mp4", modality: "video"},
            speech: {
                language: "he",
                segments: [{startMs: 0, endMs: 1000, text: "שלום"}],
            },
            visuals: [{
                timestampMs: 0, slideNumber: null, pageNumber: null,
                visibleText: "Привет", description: "Blue title card.",
            }],
        },
    });
    view.render(ViewModel.toViewModel(state({mediaTranscription: complete}), NOW));
    assert.ok(labels(root).includes("00:00:00.000–00:00:01.000 · שלום"));
    assert.ok(labels(root).includes("Visible text: Привет"));
    button(root, "Copy this media transcription").click();
    assert.match(calls.at(-1)[1], /שלום/u);
    button(root, "Clear media transcription").click();
    assert.deepEqual(calls.at(-1), ["resetMediaTranscription"]);
});

test("Activity removes Open Tools and confirms Clear History with matching button style", () => {
    const completed = workflow({phase: "complete", message: "Calendar file written"});
    const {calls, view, root} = harness();
    view.render(ViewModel.toViewModel(state({selectedTab: "alerts", eventImport: completed}), NOW));

    assert.equal(button(root, "Open Tools"), undefined);
    const clear = button(root, "Clear recent activity history");
    const refresh = button(root, "Refresh activity");
    assert.equal(clear.style_class, refresh.style_class);
    assert.equal(clear.parent.x_expand, true);
    clear.click();
    assert.ok(button(root, "Confirm clearing recent activity history"));
    button(root, "Confirm clearing recent activity history").click();
    assert.deepEqual(calls.at(-1), ["clearActivity"]);
});

test("Activity assigns a recognizable aligned icon to every workload kind", () => {
    const {view} = harness();

    assert.deepEqual([
        "event:1", "picture:1", "organizer:1", "text:1", "media:1", "documents:1",
    ].map((id) => view._activityIcon({id})), [
        "x-office-calendar-symbolic",
        "image-x-generic-symbolic",
        "folder-symbolic",
        "edit-select-all-symbolic",
        "audio-x-generic-symbolic",
        "folder-documents-symbolic",
    ]);
});

test("Activity empty card preserves exact visual actor direction and expansion", () => {
    const {view} = harness();
    assert.equal(view._renderRunningActivity({running: [], activeCount: 0}), false);
    const card = view._body.children[0];
    const empty = card.children[1];
    const [icon, copy] = empty.children;

    assert.equal(card.styleClasses.has("xpuwlm-running-card"), true);
    assert.equal(card.vertical, true);
    assert.equal(empty.vertical, false);
    assert.equal(empty.x_expand, true);
    assert.deepEqual(
        [icon.icon_name, icon.icon_type, icon.icon_size, icon.style_class],
        ["emblem-ok-symbolic", "symbolic", 28, "xpuwlm-healthy-icon"],
    );
    assert.equal(copy.vertical, true);
    assert.equal(copy.x_expand, true);
    assert.deepEqual(copy.children.map((child) => child.text), [
        "No active jobs", "Start a tool when you are ready",
    ]);
});

test("System has no refresh or description and progressively discloses profiles", () => {
    const {view, root} = harness();
    view.render(ViewModel.toViewModel(state({selectedTab: "profiles"}), NOW));

    assert.equal(labels(root).includes("System hardware and advanced controls"), false);
    assert.equal(view._footer.visible, false);
    const statusRows = findActors(root, (actor) => actor.styleClasses?.has("xpuwlm-state-row"));
    assert.deepEqual(statusRows.map((row) => row.children[0].icon_name), [
        "xpuwlm-device-symbolic", "drive-multidisk-symbolic",
    ]);
    assert.equal(root.styleClasses.has("xpuwlm-screen-profiles"), true);
    button(root, "Open advanced workload profiles").click();
    assert.ok(button(root, "Back to System"));
    assert.ok(button(root, "Decrease Hardware health weight"));
});

test("Diagnostics always shows live state and every approved action works", () => {
    const {calls, view, root} = harness();
    const model = ViewModel.toViewModel(state({selectedTab: "setup"}), NOW);
    view.render(model);

    for (const text of ["Health", "Setup", "Current state", "Recent issues"]) {
        assert.equal(labels(root).includes(text), true);
    }
    const current = findActors(root, (actor) => actor.styleClasses?.has("xpuwlm-diagnostics-current"))[0];
    assert.equal(current.vertical, true);
    assert.equal(current.children.length, 3);
    assert.equal(current.children.every((row) => row.styleClasses.has("xpuwlm-diagnostics-metric")), true);
    assert.equal(current.children.every((row) => row.children[0].x_expand === true), true);
    const actions = findActors(root, (actor) => actor.styleClasses?.has("xpuwlm-diagnostics-actions"))[0];
    assert.equal(actions.children.every((action) => action.x_expand === true), true);
    assert.equal(actions.children.every((action) => action.x_fill === true), true);
    assert.equal(actions.x_expand, true);
    assert.equal(root.styleClasses.has("xpuwlm-screen-setup"), true);
    button(root, "Open workload service logs").click();
    button(root, "Copy diagnostics report").click();
    button(root, "Refresh diagnostics").click();
    assert.deepEqual(calls.slice(-3), [
        ["openLogs"], ["copyReport", model.diagnostics.report], ["refresh"],
    ]);
    button(root, `Open setup details, ${model.diagnostics.setupStatus}`).click();
    assert.ok(button(root, "Back to Diagnostics"));
});

test("Diagnostics action bar stays complete as a standalone wide row", () => {
    const {calls, view} = harness();
    const actions = view._diagnosticsActions("report");

    assert.equal(actions.styleClasses.has("xpuwlm-diagnostics-actions"), true);
    assert.equal(actions.x_expand, true);
    assert.equal(actions.children.length, 3);
    assert.equal(actions.children.every((action) => action.x_expand && action.x_fill), true);
    assert.equal(actions.children.every((action) => action.reactive && action.can_focus), true);
    assert.deepEqual(actions.children.map((action) => action.accessibleName), [
        "Open workload service logs", "Copy diagnostics report", "Refresh diagnostics",
    ]);
    actions.children[0].click();
    actions.children[1].click();
    actions.children[2].click();
    assert.deepEqual(calls.slice(-3), [["openLogs"], ["copyReport", "report"], ["refresh"]]);
});

test("screen styling retains exactly one current tab class", () => {
    const {view, root} = harness();

    for (const tab of Menu.TAB_NAMES) {
        assert.equal(view._setScreenStyle(tab), tab);
        assert.deepEqual(
            Menu.TAB_NAMES.filter((name) => root.styleClasses.has(`xpuwlm-screen-${name}`)),
            [tab],
        );
    }
});

test("Diagnostics owns setup reasons for tools unavailable on Tools", () => {
    const unavailable = workflow({available: false, availabilityDetail: "Provider missing"});
    const {view, root} = harness();
    const snapshot = state({
        selectedTab: "overview", eventImport: unavailable,
    });
    view.render(ViewModel.toViewModel(snapshot, NOW));
    assert.equal(labels(root).includes("Provider missing"), false);

    const model = ViewModel.toViewModel({...snapshot,
        selectedTab: "setup", eventImport: unavailable,
    }, NOW);
    view.render(model);

    assert.equal(labels(root).includes("Needs setup (1)"), true);
    button(root, `Open setup details, ${model.diagnostics.setupStatus}`).click();
    assert.equal(labels(root).includes("Unavailable tools"), true);
    assert.equal(labels(root).includes("Extract calendar events"), true);
    assert.equal(labels(root).includes("Provider missing"), true);
});

test("detail and diagnostic feedback branches remain safe without live state", () => {
    const empty = harness();
    assert.equal(empty.view._closeDetail(), false);
    empty.view._openDetail("unknown");
    assert.equal(empty.view._closeDetail(), true);
    assert.equal(empty.view._openLogs(), true);
    assert.equal(empty.view._copyReport("report"), true);

    const failed = harness();
    failed.view._actions.openLogs = () => false;
    failed.view._actions.copyReport = () => false;
    failed.view.render(ViewModel.toViewModel(state({selectedTab: "setup"}), NOW));
    assert.equal(failed.view._openLogs(), false);
    assert.equal(labels(failed.root).includes("Could not open logs"), true);
    assert.equal(failed.view._copyReport("report"), false);
    assert.equal(labels(failed.root).includes("Could not copy report"), true);
});

test("Activity disables its pause action while a runtime control is pending", () => {
    const {view, root} = harness();
    view.render(ViewModel.toViewModel(state({
        selectedTab: "alerts",
        metrics: {queueDepth: 0, runningProfiles: 1},
        control: {pending: true, message: "Applying", available: true},
    }), NOW));
    const pause = button(root, "Pause all workloads");
    assert.equal(pause.reactive, false);
    assert.equal(pause.can_focus, false);
});
