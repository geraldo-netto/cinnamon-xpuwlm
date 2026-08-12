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
});

test("Tools lists five live tasks and opens one focused workflow", () => {
    const {view, root} = harness();
    view.render(ViewModel.toViewModel(state(), NOW));
    const tools = findActors(root, (actor) => actor.xpuwlmIdentity?.startsWith("tool:"));
    assert.deepEqual(tools.map((actor) => actor.xpuwlmIdentity), [
        "tool:documents", "tool:events", "tool:text", "tool:organizer", "tool:picture",
    ]);

    tools[0].click();
    assert.ok(button(root, "Back to Tools"));
    assert.ok(button(root, "Choose documents for one question"));
    assert.equal(findActors(root, (actor) => actor.xpuwlmIdentity?.startsWith("tool:")).length, 0);
    button(root, "Back to Tools").click();
    assert.equal(findActors(root, (actor) => actor.xpuwlmIdentity?.startsWith("tool:")).length, 5);
});

test("Activity removes Open Tools and confirms Clear History with matching button style", () => {
    const completed = workflow({phase: "complete", message: "Calendar file written"});
    const {calls, view, root} = harness();
    view.render(ViewModel.toViewModel(state({selectedTab: "alerts", eventImport: completed}), NOW));

    assert.equal(button(root, "Open Tools"), undefined);
    const clear = button(root, "Clear recent activity history");
    const refresh = button(root, "Refresh activity");
    assert.equal(clear.style_class, refresh.style_class);
    clear.click();
    assert.ok(button(root, "Confirm clearing recent activity history"));
    button(root, "Confirm clearing recent activity history").click();
    assert.deepEqual(calls.at(-1), ["clearActivity"]);
});

test("System has no refresh or description and progressively discloses profiles", () => {
    const {view, root} = harness();
    view.render(ViewModel.toViewModel(state({selectedTab: "profiles"}), NOW));

    assert.equal(labels(root).includes("System hardware and advanced controls"), false);
    assert.equal(view._footer.visible, false);
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
    button(root, "Open workload service logs").click();
    button(root, "Copy diagnostics report").click();
    button(root, "Refresh diagnostics").click();
    assert.deepEqual(calls.slice(-3), [
        ["openLogs"], ["copyReport", model.diagnostics.report], ["refresh"],
    ]);
    button(root, `Open setup details, ${model.diagnostics.setupStatus}`).click();
    assert.ok(button(root, "Back to Diagnostics"));
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
