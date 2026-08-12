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
    createSt,
    findActors,
} = require("../helpers/fakes.js");

const NOW = 1_700_000_000_000;

function baseState(overrides = {}) {
    return {
        selectedTab: "overview",
        paused: false,
        // A host where the runtime serves the whole catalog, so a control that
        // is dead in these tests is dead for a reason the test states.
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
    const calls = [];
    const tooltips = [];
    const actions = {};
    for (const name of [
        "selectTab", "toggleProfile", "changeWeight", "pauseAll", "resumeAll", "refresh",
        "openSettings", "acknowledgeCatalogChanges", "submitJob", "chooseEventFiles",
        "chooseEventFolder", "startEventImport", "cancelEventImport", "editEventCandidate",
        "decideEventCandidate", "beginEventExport", "confirmEventExport", "backEventPreview",
        "resetEventImport",
        "chooseQuestionFiles", "startDocumentQuestion", "cancelDocumentQuestion",
        "resetDocumentQuestion",
        "startSelectedText", "cancelSelectedText", "resetSelectedText",
        "chooseOrganizerFiles", "startFileOrganizer", "cancelFileOrganizer",
        "resetFileOrganizer",
    ]) {
        actions[name] = (...args) => calls.push([name, ...args]);
    }
    const menu = new FakeMenu();
    const view = new Menu.MenuView({
        St: createSt(),
        Clutter: {ActorAlign: {CENTER: "center"}},
        Atk: createAtk(),
        menu,
        actions,
        tooltips: (actor, text) => {
            const tooltip = {actor, text};
            tooltips.push(tooltip);
            return tooltip;
        },
    });
    return {calls, menu, tooltips, view, root: menu.actors[0]};
}

function eventWorkflow(overrides = {}) {
    return {
        available: true,
        availabilityDetail: "",
        phase: "idle",
        selectionKind: "",
        sources: [],
        jobId: "",
        progress: null,
        message: "",
        candidates: [],
        duplicatesDropped: 0,
        exportedPath: "",
        ...overrides,
    };
}

function documentWorkflow(overrides = {}) {
    return {
        available: true,
        availabilityDetail: "",
        phase: "idle",
        sources: [],
        jobId: "",
        message: "",
        progress: null,
        answer: "",
        providerId: "",
        accelerator: "",
        citations: [],
        ...overrides,
    };
}

function selectedTextWorkflow(overrides = {}) {
    return {
        available: true,
        availabilityDetail: "",
        phase: "idle",
        operation: "",
        jobId: "",
        message: "",
        progress: null,
        result: "",
        tasks: [],
        providerId: "",
        accelerator: "",
        evidence: null,
        ...overrides,
    };
}

function fileOrganizerWorkflow(overrides = {}) {
    return {
        available: true,
        availabilityDetail: "",
        phase: "idle",
        sources: [],
        jobId: "",
        message: "",
        progress: null,
        providerId: "",
        accelerator: "",
        plan: [],
        ...overrides,
    };
}

function allToolsState(overrides = {}) {
    return baseState({
        eventImport: eventWorkflow(),
        documentQuestion: documentWorkflow(),
        selectedText: selectedTextWorkflow(),
        fileOrganizer: fileOrganizerWorkflow(),
        inputs: {
            roots: ["/pictures"], pictures: [], runnable: ["visual-library"], omitted: 0,
        },
        ...overrides,
    });
}

function eventCandidate(overrides = {}) {
    return {
        candidateId: "event-1",
        title: "Planning review",
        start: "2026-08-11T10:00:00+02:00",
        end: "2026-08-11T11:00:00+02:00",
        timezone: "Europe/Rome",
        location: "Studio",
        confirmation: "pending",
        evidence: [{
            sourceRef: "private:job:source:1:page:2",
            sourceSha256: "a".repeat(64),
            page: 2,
            span: {start: 12, end: 40},
            textSha256: "b".repeat(64),
        }],
        ...overrides,
    };
}

function button(root, accessibleName) {
    return findActors(root, (actor) => actor instanceof FakeButton && actor.accessibleName === accessibleName)[0];
}

function identities(root) {
    return findActors(root, (actor) => typeof actor.xpuwlmIdentity === "string")
        .map((actor) => actor.xpuwlmIdentity);
}

// A profile the runtime cannot execute names the reason in its toggle, so the
// control is found by what it does rather than by its whole announcement.
function control(root, accessibleNamePrefix) {
    return findActors(root, (actor) => actor instanceof FakeButton
        && actor.accessibleName.startsWith(accessibleNamePrefix))[0];
}

test("menu validates dependencies and required actions", () => {
    const validActions = Object.fromEntries(
        ["selectTab", "toggleProfile", "changeWeight", "pauseAll", "resumeAll", "refresh", "openSettings", "acknowledgeCatalogChanges", "submitJob"]
            .map((name) => [name, () => {}]),
    );
    assert.throws(() => new Menu.MenuView({}), /dependencies/);
    assert.throws(() => new Menu.MenuView({
        St: createSt(),
        Clutter: {},
        menu: new FakeMenu(),
        actions: {...validActions, refresh: null},
    }), /refresh/);
    assert.throws(() => Menu.requireAction(null, "refresh"), /refresh/);
});

test("style and child helpers make updates idempotent", () => {
    const actor = new FakeActor();
    Menu.setStyleClass(actor, "active", true);
    assert.equal(actor.styleClasses.has("active"), true);
    Menu.setStyleClass(actor, "active", false);
    assert.equal(actor.styleClasses.has("active"), false);
    const first = new FakeActor();
    const second = new FakeActor();
    actor.add_child(first);
    actor.add_child(second);
    Menu.destroyChildren(actor);
    assert.equal(first.destroyed, true);
    assert.equal(second.destroyed, true);
    assert.equal(actor.children.length, 0);
});

test("header has no duplicate pause control before first render", () => {
    const {root} = harness();
    assert.equal(button(root, "Pause all workloads"), undefined);
});

test("Tools exposes task navigation, refresh, and settings", () => {
    const {calls, view, root} = harness();
    view.render(ViewModel.toViewModel(baseState(), NOW));
    assert.equal(button(root, "Tools tab, selected").styleClasses.has("xpuwlm-tab-active"), true);
    assert.equal(button(root, "System tab").styleClasses.has("xpuwlm-tab-active"), false);
    button(root, "System tab").click();
    button(root, "Refresh XPU status").click();
    button(root, "Open XPU Workload Manager settings").click();
    assert.deepEqual(calls, [
        ["selectTab", "profiles"],
        ["refresh"],
        ["openSettings"],
    ]);
});

test("profiles screen offers weight and enable controls", () => {
    const {calls, view, root} = harness();
    view.render(ViewModel.toViewModel(baseState({selectedTab: "profiles"}), NOW));
    view._openDetail("profiles");
    button(root, "Decrease Hardware health weight").click();
    button(root, "Increase Hardware health weight").click();
    control(root, "Enable Network & peripherals").click();
    assert.deepEqual(calls, [
        ["changeWeight", "hardware-health", -1],
        ["changeWeight", "hardware-health", 1],
        ["toggleProfile", "network-peripherals"],
    ]);
    const minimum = button(root, "Decrease Desktop context weight");
    assert.equal(minimum.reactive, false);
    assert.equal(minimum.can_focus, false);
    assert.equal(minimum.styleClasses.has("xpuwlm-button-disabled"), true);

    const maximumState = baseState({selectedTab: "profiles"});
    maximumState.profiles[0].weight = 5;
    view.render(ViewModel.toViewModel(maximumState, NOW));
    const maximum = button(root, "Increase Hardware health weight");
    assert.equal(maximum.reactive, false);
    assert.equal(maximum.can_focus, false);
});

test("event import stays hidden until live readiness and starts from explicit selection", () => {
    const {calls, view, root} = harness();
    view.render(ViewModel.toViewModel(baseState({
        selectedTab: "profiles",
        eventImport: eventWorkflow({available: false, availabilityDetail: "Provider missing"}),
    }), NOW));
    view._openDetail("events");
    assert.equal(button(root, "Choose event source files"), undefined);

    view.render(ViewModel.toViewModel(baseState({
        selectedTab: "profiles",
        eventImport: eventWorkflow({
            available: false,
            availabilityDetail: "Configure and qualify an event model provider",
            phase: "error",
            message: "Provider setup is incomplete",
        }),
    }), NOW));
    assert.equal(findActors(root, (actor) => actor.text === "Configure and qualify an event model provider").length, 1);
    assert.equal(button(root, "Choose event source files").reactive, false);

    view.render(ViewModel.toViewModel(baseState({
        selectedTab: "profiles",
        eventImport: eventWorkflow(),
    }), NOW));
    button(root, "Choose event source files").click();
    button(root, "Choose one event source folder").click();
    assert.deepEqual(calls, [["chooseEventFiles"], ["chooseEventFolder"]]);

    view.render(ViewModel.toViewModel(baseState({
        selectedTab: "profiles",
        eventImport: eventWorkflow({
            phase: "selected",
            sources: [{path: "/private/notes.txt", name: "notes.txt", size: 12, regular: true, symlink: false}],
        }),
    }), NOW));
    assert.equal(findActors(root, (actor) => actor.text === "notes.txt").length, 1);
    button(root, "Extract events from selected files").click();
    assert.deepEqual(calls.at(-1), ["startEventImport"]);
});

test("selected-document UI asks explicitly and renders only public citations", () => {
    const {calls, view, root} = harness();
    view.render(ViewModel.toViewModel(baseState({
        selectedTab: "profiles",
        documentQuestion: documentWorkflow({available: false}),
    }), NOW));
    view._openDetail("documents");
    assert.equal(button(root, "Choose documents for one question"), undefined);

    view.render(ViewModel.toViewModel(baseState({
        selectedTab: "profiles",
        documentQuestion: documentWorkflow({
            phase: "selected",
            sources: [{path: "/private/guide.pdf", name: "guide.pdf", size: 42}],
        }),
    }), NOW));
    const input = findActors(
        root, (actor) => actor.accessibleName === "Question for selected documents",
    )[0];
    input.set_text("What must I restart?");
    const ask = button(root, "Ask the explicit question over selected documents");
    assert.equal(ask.styleClasses.has("xpuwlm-primary-button"), true);
    ask.click();
    assert.deepEqual(calls.at(-1), ["startDocumentQuestion", "What must I restart?"]);

    view.render(ViewModel.toViewModel(baseState({
        selectedTab: "profiles",
        documentQuestion: documentWorkflow({
            phase: "complete",
            sources: [{path: "/private/guide.pdf", name: "guide.pdf", size: 42}],
            answer: "Restart the service.", providerId: "qwen3-gpu", accelerator: "gpu",
            citations: [{
                fileId: "selected-file-1", fileName: "guide.pdf",
                sourceSha256: "a".repeat(64), page: 3, span: {start: 10, end: 42},
                textSha256: "b".repeat(64),
            }],
        }),
    }), NOW));
    assert.equal(findActors(root, (actor) => actor.text === "Restart the service.").length, 1);
    assert.equal(findActors(root, (actor) => actor.text === "guide.pdf · page 3 · span 10–42").length, 1);
    assert.equal(findActors(root, (actor) => String(actor.text).includes("/private/")).length, 0);
    button(root, "Clear this answer and start again").click();
    assert.deepEqual(calls.at(-1), ["resetDocumentQuestion"]);
});

test("selected-document render helpers preserve every branch and actor effect", () => {
    const empty = harness();
    assert.equal(empty.view._renderDocumentQuestion(null), false);
    assert.equal(empty.view._renderDocumentQuestion(undefined), false);

    const status = harness();
    assert.equal(status.view._renderDocumentQuestionStatus({message: "Selected", progressText: "50%"}), undefined);
    assert.equal(findActors(status.root, (actor) => actor.text === "Selected").length, 1);
    assert.equal(findActors(status.root, (actor) => actor.text === "50%").length, 1);
    const beforeEmptyStatus = findActors(status.root, () => true).length;
    status.view._renderDocumentQuestionStatus({message: "", progressText: ""});
    assert.equal(findActors(status.root, () => true).length, beforeEmptyStatus);

    const sources = harness();
    assert.equal(sources.view._renderDocumentQuestionSources({sources: []}), false);
    assert.equal(sources.view._renderDocumentQuestionSources({
        sources: [{name: "one.pdf"}, {name: "two.txt"}],
    }), true);
    assert.equal(findActors(sources.root, (actor) => actor.text === "2 files").length, 1);
    assert.equal(findActors(sources.root, (actor) => actor.text === "one.pdf").length, 1);
    assert.equal(findActors(sources.root, (actor) => actor.text === "two.txt").length, 1);

    const entry = harness();
    assert.equal(entry.view._documentQuestionEntry({phase: "idle"}), null);
    const question = entry.view._documentQuestionEntry({phase: "selected"});
    assert.equal(question.accessibleName, "Question for selected documents");
    assert.equal(question.xpuwlmIdentity, "document-question-input");

    const result = harness();
    assert.equal(result.view._renderDocumentQuestionResult({complete: false}), false);
    assert.equal(result.view._renderDocumentQuestionResult({
        complete: true,
        providerId: "qwen3-gpu",
        accelerator: "gpu",
        answer: "Restart service",
        citations: [{text: "guide.pdf · page 1 · span 0–4"}],
    }), true);
    assert.equal(findActors(result.root, (actor) => actor.text === "qwen3-gpu · GPU").length, 1);
    assert.equal(findActors(result.root, (actor) => actor.text === "Restart service").length, 1);
    assert.equal(findActors(result.root, (actor) => actor.text === "guide.pdf · page 1 · span 0–4").length, 1);

    const actions = harness();
    assert.equal(actions.view._renderDocumentQuestionActions({
        phase: "running", chooserEnabled: false, askEnabled: false,
        cancelEnabled: true, complete: false,
    }, null), true);
    assert.equal(button(actions.root, "Cancel document question").reactive, true);
    assert.equal(button(actions.root, "Choose documents for one question"), undefined);
    assert.equal(button(actions.root, "Clear this answer and start again"), undefined);

    const full = harness();
    const model = ViewModel.documentQuestionModel({documentQuestion: documentWorkflow({
        phase: "selected", message: "Ready", sources: [{name: "guide.pdf"}],
    })});
    assert.equal(full.view._renderDocumentQuestion(model), true);
    assert.equal(findActors(full.root, (actor) => actor.text === "Ready").length, 1);
    assert.equal(button(full.root, "Choose documents for one question").reactive, true);
    assert.equal(button(full.root, "Ask the explicit question over selected documents").reactive, true);
});

test("selected-text UI reads once on operation click and exposes review-only results", () => {
    const {calls, view, root} = harness();
    view.render(ViewModel.toViewModel(baseState({
        selectedTab: "profiles",
        selectedText: selectedTextWorkflow(),
    }), NOW));
    view._openDetail("text");
    button(root, "Summarize the explicit clipboard selection").click();
    assert.deepEqual(calls.at(-1), ["startSelectedText", "summarize", null]);
    const language = findActors(
        root, (actor) => actor.accessibleName === "Translation target language",
    )[0];
    language.set_text("Italian");
    button(root, "Translate the explicit clipboard selection").click();
    assert.deepEqual(calls.at(-1), ["startSelectedText", "translate", "Italian"]);

    view.render(ViewModel.toViewModel(baseState({
        selectedTab: "profiles",
        selectedText: selectedTextWorkflow({phase: "running", message: "Generating"}),
    }), NOW));
    button(root, "Cancel selected-text request").click();
    assert.deepEqual(calls.at(-1), ["cancelSelectedText"]);

    view.render(ViewModel.toViewModel(baseState({
        selectedTab: "profiles",
        selectedText: selectedTextWorkflow({
            phase: "complete",
            result: "A concise explanation.",
            tasks: ["Review the change"],
            providerId: "qwen3-gpu",
            accelerator: "gpu",
            evidence: {
                selectionSha256: "a".repeat(64), textSha256: "a".repeat(64),
                span: {start: 0, end: 24},
            },
        }),
    }), NOW));
    for (const text of [
        "A concise explanation.", "Review the change",
        "Selection digest aaaaaaaaaaaa · span 0–24",
    ]) {
        assert.equal(findActors(root, (actor) => actor.text === text).length, 1);
    }
    assert.equal(button(root, "Apply selected-text result"), undefined);
    assert.equal(button(root, "Paste selected-text result"), undefined);
    assert.equal(button(root, "Create extracted tasks"), undefined);
    button(root, "Clear selected-text result").click();
    assert.deepEqual(calls.at(-1), ["resetSelectedText"]);
});

test("selected-text render helpers preserve hidden, unavailable, and empty branches", () => {
    const empty = harness();
    assert.equal(empty.view._renderSelectedText(null), false);
    assert.equal(empty.view._renderSelectedText(undefined), false);
    const unavailable = harness();
    assert.equal(unavailable.view._renderSelectedText(ViewModel.selectedTextModel({
        selectedText: selectedTextWorkflow({
            available: false, phase: "error", availabilityDetail: "Provider missing",
        }),
    })), true);
    assert.equal(findActors(unavailable.root, (actor) => actor.text === "Provider missing").length, 0);
    assert.equal(button(unavailable.root, "Clear selected-text result").reactive, true);

    const status = harness();
    status.view._renderSelectedTextStatus({
        available: false, phase: "idle", availabilityDetail: "Provider missing",
        message: "", progressText: "",
    });
    assert.equal(findActors(status.root, (actor) => actor.text === "Provider missing").length, 1);
    const before = findActors(status.root, () => true).length;
    status.view._renderSelectedTextStatus({
        available: true, phase: "idle", availabilityDetail: "", message: "", progressText: "",
    });
    assert.equal(findActors(status.root, () => true).length, before);

    const detailed = harness();
    detailed.view._layout = {...detailed.view._layout, wrapText: true};
    assert.equal(detailed.view._renderSelectedTextStatus({
        available: true, phase: "running", availabilityDetail: "",
        message: "Generating", progressText: "50% · Qwen",
    }), true);
    for (const text of ["Generating", "50% · Qwen"]) {
        const actor = findActors(detailed.root, (candidate) => candidate.text === text)[0];
        assert.equal(actor.clutter_text.line_wrap, true);
    }

    const actions = harness();
    assert.equal(actions.view._renderSelectedTextActions({
        cancelEnabled: false, complete: false, phase: "idle",
    }), true);
    assert.equal(button(actions.root, "Cancel selected-text request"), undefined);
    assert.equal(button(actions.root, "Clear selected-text result"), undefined);
    assert.equal(actions.view._renderSelectedTextActions({
        cancelEnabled: true, complete: false, phase: "running",
    }), true);
    assert.equal(button(actions.root, "Cancel selected-text request").reactive, true);

    const operations = harness();
    assert.equal(operations.view._renderSelectedTextOperations({operationEnabled: true}), true);
    for (const name of [
        "Explain the explicit clipboard selection",
        "Summarize the explicit clipboard selection",
        "Rewrite the explicit clipboard selection",
        "Extract tasks the explicit clipboard selection",
        "Translate the explicit clipboard selection",
    ]) {
        assert.equal(button(operations.root, name).reactive, true, name);
    }

    const result = harness();
    result.view._layout = {...result.view._layout, wrapText: true};
    assert.equal(result.view._renderSelectedTextResult({
        providerId: "qwen3-gpu", accelerator: "gpu", result: "Summary",
        tasks: [], evidenceText: "Selection digest aaaaaaaaaaaa · span 0–7",
    }), true);
    assert.equal(findActors(result.root, (actor) => actor.text === "qwen3-gpu · GPU").length, 1);
    assert.equal(findActors(result.root, (actor) => actor.text === "Extracted tasks").length, 0);
    for (const text of ["Summary", "Selection digest aaaaaaaaaaaa · span 0–7"]) {
        const actor = findActors(result.root, (candidate) => candidate.text === text)[0];
        assert.equal(actor.clutter_text.line_wrap, true);
    }

    const disabled = harness();
    disabled.view._renderSelectedText({
        title: "Selected-text tools", available: true, phase: "running",
        availabilityDetail: "", message: "", progressText: "",
        operationEnabled: false, cancelEnabled: true, complete: false,
    });
    assert.equal(button(disabled.root, "Explain the explicit clipboard selection"), undefined);
    assert.equal(findActors(disabled.root, (actor) => actor.text === "Review result").length, 0);
});

test("file organizer UI displays evidence-backed advice and exposes no apply action", () => {
    const source = {
        path: "/private/guide.pdf", name: "guide.pdf", size: 12,
        regular: true, symlink: false,
    };
    const plan = [{
        fileId: "selected-file-1", fileName: "guide.pdf", sourceSha256: "a".repeat(64),
        tags: ["project-notes"], proposedName: "mars-guide.pdf",
        proposedFolder: "Projects/Mars", duplicateGroup: "duplicate-group-1",
        reason: "The content describes the Mars project.",
        evidence: [{
            fileId: "selected-file-1", fileName: "guide.pdf",
            sourceSha256: "a".repeat(64), page: 3, span: {start: 10, end: 42},
            textSha256: "b".repeat(64),
        }],
    }];
    const {calls, view, root} = harness();
    view.render(ViewModel.toViewModel(baseState({
        selectedTab: "profiles",
        fileOrganizer: fileOrganizerWorkflow({phase: "selected", sources: [source]}),
    }), NOW));
    view._openDetail("organizer");
    button(root, "Choose files for a review-only organization plan").click();
    const createPlan = button(root, "Suggest organization without changing files");
    assert.equal(createPlan.styleClasses.has("xpuwlm-primary-button"), true);
    createPlan.click();
    assert.deepEqual(calls.slice(-2), [["chooseOrganizerFiles"], ["startFileOrganizer"]]);

    view.render(ViewModel.toViewModel(baseState({
        selectedTab: "profiles",
        fileOrganizer: fileOrganizerWorkflow({
            phase: "complete", sources: [source], providerId: "qwen3-gpu",
            accelerator: "gpu", message: "Review-only plan ready; no files changed", plan,
        }),
    }), NOW));
    for (const text of [
        "guide.pdf", "project-notes", "Suggested name: mars-guide.pdf",
        "Suggested folder: Projects/Mars", "Exact duplicate group: duplicate-group-1",
        "The content describes the Mars project.", "guide.pdf · page 3 · span 10–42",
    ]) {
        assert.ok(findActors(root, (actor) => actor.text === text).length >= 1, text);
    }
    for (const forbidden of [
        "Apply organization plan", "Move selected files", "Rename selected files",
        "Delete duplicates", "Run organizer command",
    ]) {
        assert.equal(button(root, forbidden), undefined, forbidden);
    }
    button(root, "Clear the review-only organization plan").click();
    assert.deepEqual(calls.at(-1), ["resetFileOrganizer"]);
});

test("file organizer render helpers preserve hidden, unavailable, empty, and cancel branches", () => {
    const hidden = harness();
    assert.equal(hidden.view._renderFileOrganizer(null), false);
    assert.equal(hidden.view._renderFileOrganizer(undefined), false);

    const unavailable = harness();
    unavailable.view._layout = {...unavailable.view._layout, wrapText: true};
    assert.equal(unavailable.view._renderFileOrganizerStatus({
        available: false, phase: "idle", availabilityDetail: "Provider missing",
        message: "", progressText: "",
    }), true);
    const missing = findActors(unavailable.root, (actor) => actor.text === "Provider missing")[0];
    assert.equal(missing.clutter_text.line_wrap, true);

    const fallback = harness();
    fallback.view._renderFileOrganizerStatus({
        available: false, phase: "idle", availabilityDetail: "",
        message: "", progressText: "",
    });
    assert.equal(findActors(fallback.root, (actor) =>
        actor.text === "A qualified file-organizer provider is not configured").length, 1);

    const inactive = harness();
    inactive.view._renderFileOrganizerStatus({
        available: false, phase: "error", availabilityDetail: "Provider missing",
        message: "", progressText: "",
    });
    assert.equal(findActors(inactive.root, (actor) => actor.text === "Provider missing").length, 0);

    const status = harness();
    status.view._layout = {...status.view._layout, wrapText: true};
    assert.equal(status.view._renderFileOrganizerStatus({
        available: true, phase: "running", availabilityDetail: "",
        message: "Planning", progressText: "50% · Qwen",
    }), true);
    for (const [text, style] of [
        ["Planning", "xpuwlm-event-message"], ["50% · Qwen", "xpuwlm-event-progress"],
    ]) {
        const actor = findActors(status.root, (candidate) => candidate.text === text)[0];
        assert.equal(actor.styleClasses.has(style), true);
        assert.equal(actor.clutter_text.line_wrap, true);
    }

    const sources = harness();
    sources.view._layout = {...sources.view._layout, wrapText: true};
    assert.equal(sources.view._renderFileOrganizerSources({sources: []}), false);
    assert.equal(sources.view._renderFileOrganizerSources({
        sources: [{name: "guide.pdf"}],
    }), true);
    const renderedSource = findActors(sources.root, (actor) => actor.text === "guide.pdf")[0];
    assert.equal(renderedSource.styleClasses.has("xpuwlm-event-source"), true);
    assert.equal(renderedSource.clutter_text.line_wrap, true);

    const incomplete = harness();
    assert.equal(incomplete.view._renderFileOrganizerPlan({complete: false}), false);

    const complete = harness();
    complete.view._layout = {...complete.view._layout, wrapText: true};
    assert.equal(complete.view._renderFileOrganizerPlan({
        complete: true, providerId: "qwen3-gpu", accelerator: "gpu",
        plan: [{
            fileName: "guide.pdf", tagsText: "project-notes",
            nameText: "Suggested name: mars-guide.pdf",
            folderText: "Suggested folder: Projects/Mars",
            duplicateText: "No exact duplicate in this selection",
            reason: "Grounded reason", evidence: [{text: "guide.pdf · page 3 · span 10–42"}],
        }],
    }), true);
    assert.equal(findActors(complete.root, (actor) => actor.text === "qwen3-gpu · GPU").length, 1);
    for (const text of [
        "Suggested name: mars-guide.pdf", "Suggested folder: Projects/Mars",
        "No exact duplicate in this selection", "Grounded reason",
        "guide.pdf · page 3 · span 10–42",
    ]) {
        const actor = findActors(complete.root, (candidate) => candidate.text === text)[0];
        assert.equal(actor.clutter_text.line_wrap, true, text);
    }

    const actions = harness();
    assert.equal(actions.view._renderFileOrganizerActions({
        phase: "running", chooserEnabled: false, startEnabled: false,
        cancelEnabled: true, complete: false,
    }), true);
    const cancel = button(actions.root, "Cancel file organization");
    assert.equal(cancel.reactive, true);
    cancel.click();
    assert.deepEqual(actions.calls.at(-1), ["cancelFileOrganizer"]);

    const phases = [
        ["idle", false, ["Choose files for a review-only organization plan"]],
        ["selected", false, [
            "Choose files for a review-only organization plan",
            "Suggest organization without changing files",
        ]],
        ["complete", true, [
            "Choose files for a review-only organization plan",
            "Clear the review-only organization plan",
        ]],
        ["error", false, [
            "Choose files for a review-only organization plan",
            "Clear the review-only organization plan",
        ]],
    ];
    const organizerActions = new Set([
        "Choose files for a review-only organization plan",
        "Suggest organization without changing files",
        "Cancel file organization",
        "Clear the review-only organization plan",
    ]);
    for (const [phase, completePlan, expected] of phases) {
        const current = harness();
        assert.equal(current.view._renderFileOrganizerActions({
            phase, chooserEnabled: true, startEnabled: phase === "selected",
            cancelEnabled: false, complete: completePlan,
        }), true);
        const buttons = findActors(current.root, (actor) => actor instanceof FakeButton)
            .map((actor) => actor.accessibleName)
            .filter((name) => organizerActions.has(name));
        assert.deepEqual(buttons, expected, phase);
        for (const actor of findActors(current.root, (candidate) => candidate instanceof FakeButton
            && organizerActions.has(candidate.accessibleName))) {
            assert.equal(actor.reactive, true, phase);
        }
    }
});

test("event preview exposes grounded evidence, labelled edits, decisions, and confirmation", () => {
    const {calls, view, root} = harness();
    const source = {path: "/private/notes.pdf", name: "notes.pdf", size: 12, regular: true, symlink: false};
    view.render(ViewModel.toViewModel(baseState({
        selectedTab: "profiles",
        eventImport: eventWorkflow({
            phase: "preview",
            sources: [source],
            candidates: [eventCandidate({confirmation: "confirmed"})],
        }),
    }), NOW));
    view._openDetail("events");

    for (const label of ["Title", "Starts", "Ends", "Timezone", "Location"]) {
        assert.equal(findActors(root, (actor) => actor.text === label).length, 1, label);
    }
    assert.equal(findActors(root, (actor) => /notes\.pdf · page 2 · characters 12–40/u.test(actor.text)).length, 1);
    const title = findActors(root, (actor) => actor.xpuwlmIdentity === "event-title:event-1")[0];
    title.set_text("Edited planning review");
    button(root, "Apply edits to Planning review").click();
    button(root, "Keep Planning review").click();
    button(root, "Reject Planning review").click();
    button(root, "Review confirmed events before export").click();
    assert.equal(calls[0][0], "editEventCandidate");
    assert.equal(calls[0][2].title, "Edited planning review");
    assert.equal(calls[0][2].end, "2026-08-11T11:00:00+02:00");
    assert.equal(calls[0][2].location, "Studio");
    assert.deepEqual(calls.slice(1), [
        ["decideEventCandidate", "event-1", "confirmed"],
        ["decideEventCandidate", "event-1", "rejected"],
        ["beginEventExport"],
    ]);

    view.render(ViewModel.toViewModel(baseState({
        selectedTab: "profiles",
        eventImport: eventWorkflow({
            phase: "confirm-export",
            sources: [source],
            candidates: [eventCandidate({confirmation: "confirmed"})],
        }),
    }), NOW));
    assert.equal(findActors(root, (actor) => /No source file is changed or removed/u.test(actor.text)).length, 1);
    button(root, "Confirm and write a new calendar file").click();
    button(root, "Return to event preview").click();
    assert.deepEqual(calls.slice(-2), [["confirmEventExport"], ["backEventPreview"]]);
});

test("event progress is cancellable and decisions are announced without color alone", () => {
    const {calls, view, root} = harness();
    view.render(ViewModel.toViewModel(baseState({
        selectedTab: "profiles",
        eventImport: eventWorkflow({
            phase: "running",
            progress: {fraction: 0.5, detail: "Reading sources"},
            message: "Working",
        }),
    }), NOW));
    view._openDetail("events");
    assert.equal(findActors(root, (actor) => /50% · Reading sources/u.test(actor.text)).length, 1);
    button(root, "Cancel event extraction").click();
    assert.deepEqual(calls, [["cancelEventImport"]]);

    view.render(ViewModel.toViewModel(baseState({
        selectedTab: "profiles",
        eventImport: eventWorkflow({
            phase: "preview",
            sources: [{path: "/a.txt", name: "a.txt", size: 1, regular: true, symlink: false}],
            candidates: [eventCandidate({confirmation: "confirmed"})],
        }),
    }), NOW));
    const keep = button(root, "Keep Planning review");
    assert.equal(keep.accessibleRole, "toggle-button");
    assert.equal(keep.accessibleStates.has("checked"), true);
    assert.equal(button(root, "Reject Planning review").accessibleStates.has("checked"), false);

    const nullable = eventCandidate({
        candidateId: "event-2",
        end: null,
        location: null,
        evidence: [{
            ...eventCandidate().evidence[0],
            sourceRef: "private:job:source:1",
            page: null,
        }],
    });
    view.render(ViewModel.toViewModel(baseState({
        selectedTab: "profiles",
        eventImport: eventWorkflow({
            phase: "preview",
            sources: [{path: "/a.txt", name: "a.txt", size: 1, regular: true, symlink: false}],
            candidates: [nullable],
            duplicatesDropped: 2,
        }),
    }), NOW));
    assert.equal(findActors(root, (actor) => actor.text === "2 duplicates removed").length, 1);
    assert.equal(findActors(root, (actor) => actor.text === "Decide whether to keep or reject every candidate").length, 1);
    assert.equal(findActors(root, (actor) => actor.text === "Evidence: a.txt · characters 12–40").length, 1);
    assert.equal(findActors(root, (actor) => actor.xpuwlmIdentity === "event-end:event-2")[0].get_text(), "");
    assert.equal(findActors(root, (actor) => actor.xpuwlmIdentity === "event-location:event-2")[0].get_text(), "");
    button(root, "Apply edits to Planning review").click();
    assert.equal(calls.at(-1)[0], "editEventCandidate");
    assert.equal(calls.at(-1)[2].end, null);
    assert.equal(calls.at(-1)[2].location, null);
});

test("event render helpers preserve exact phase structure and return contracts", () => {
    assert.equal(Menu.optionalAction(null, "missing")(), false);
    assert.equal(Menu.optionalAction({}, "missing")(), false);
    assert.equal(Menu.optionalAction({run: (value) => value + 1}, "run")(2), 3);

    const projected = (workflow) => ViewModel.toViewModel(baseState({
        selectedTab: "profiles",
        eventImport: workflow,
    }), NOW).eventImport;
    const idle = projected(eventWorkflow());
    const unavailable = {
        ...projected(eventWorkflow({available: false, phase: "error", message: "setup"})),
        availabilityDetail: "",
    };

    {
        const {view} = harness();
        view._layout = {...view._layout, wrapText: true};
        view._body = new FakeActor();
        assert.equal(view._renderEventImport(null), false);
        assert.equal(view._renderEventImport(undefined), false);
        assert.equal(view._renderEventImport(idle), true);
        assert.equal(findActors(view._body, (actor) => actor.styleClasses.has("xpuwlm-event-message")).length, 0);
        assert.equal(findActors(view._body, (actor) => actor.styleClasses.has("xpuwlm-event-progress")).length, 0);
        assert.deepEqual(identities(view._body), ["event-choose-files", "event-choose-folder"]);
        view._body = new FakeActor();
        const running = projected(eventWorkflow({
            phase: "running",
            message: "Working",
            progress: {fraction: 0.5, detail: "Reading"},
        }));
        assert.equal(view._renderEventImport(running), true);
        assert.equal(findActors(view._body, (actor) => actor.text === "Working")[0].clutter_text.line_wrap, true);
        assert.equal(findActors(view._body, (actor) => actor.text === "50% · Reading")[0]
            .clutter_text.line_wrap, true);
        assert.equal(findActors(view._body, (actor) => actor.text === "Confirm calendar export").length, 0);
    }
    {
        const {view} = harness();
        view._layout = {...view._layout, wrapText: true};
        view._body = new FakeActor();
        assert.equal(view._renderEventSources(unavailable), false);
        const note = findActors(view._body, (actor) => actor.text === "A qualified event model is not configured")[0];
        assert.equal(note.clutter_text.line_wrap, true);
        const availableNoSources = {...idle, sources: []};
        view._body = new FakeActor();
        assert.equal(view._renderEventSources(availableNoSources), false);
        assert.equal(findActors(view._body, (actor) => actor.styleClasses.has("xpuwlm-run-note")).length, 0);
    }
    {
        const {view} = harness();
        view._layout = {...view._layout, wrapText: true};
        view._body = new FakeActor();
        const selected = projected(eventWorkflow({
            phase: "selected",
            message: "Sources selected",
            sources: [
                {path: "/a.txt", name: "a.txt", size: 1, regular: true, symlink: false},
                {path: "/b.txt", name: "b.txt", size: 1, regular: true, symlink: false},
            ],
        }));
        assert.equal(view._renderEventImport(selected), true);
        assert.deepEqual(
            findActors(view._body, (actor) => actor.styleClasses.has("xpuwlm-event-source")).map((actor) => actor.text),
            ["a.txt", "b.txt"],
        );
        assert.equal(findActors(view._body, (actor) => actor.text === "2 files").length, 1);
        assert.equal(findActors(view._body, (actor) => actor.text === "Sources selected")[0].clutter_text.line_wrap, true);
        assert.deepEqual(identities(view._body), ["event-choose-files", "event-choose-folder", "event-start"]);
    }
});

test("event preview and confirmation render only grounded consequential content", () => {
    const source = {path: "/a.txt", name: "a.txt", size: 1, regular: true, symlink: false};
    const pending = eventCandidate({candidateId: "pending"});
    const kept = eventCandidate({candidateId: "kept", title: "Kept event", confirmation: "confirmed"});
    const rejected = eventCandidate({candidateId: "rejected", title: "Rejected event", confirmation: "rejected"});
    const projected = (phase, candidates, overrides = {}) => ViewModel.toViewModel(baseState({
        selectedTab: "profiles",
        eventImport: eventWorkflow({phase, sources: [source], candidates, ...overrides}),
    }), NOW).eventImport;

    const {view} = harness();
    view._layout = {...view._layout, wrapText: true};
    view._body = new FakeActor();
    const preview = projected("preview", [pending, kept, rejected], {duplicatesDropped: 0});
    assert.equal(view._renderEventPreview(preview), true);
    assert.equal(findActors(view._body, (actor) => actor.styleClasses.has("xpuwlm-event-dedup")).length, 0);
    assert.equal(findActors(view._body, (actor) => actor.styleClasses.has("xpuwlm-event-card")).length, 3);
    assert.equal(findActors(view._body, (actor) => actor.styleClasses.has("xpuwlm-event-card"))[0].vertical, true);
    assert.equal(findActors(view._body, (actor) => actor.styleClasses.has("xpuwlm-event-field"))[0].vertical, true);
    assert.equal(findActors(view._body, (actor) => actor.styleClasses.has("xpuwlm-event-evidence"))[0]
        .clutter_text.line_wrap, true);
    assert.equal(findActors(view._body, (actor) => actor.styleClasses.has("xpuwlm-run-note")).length, 1);

    view._body = new FakeActor();
    const decided = projected("preview", [kept, rejected]);
    assert.equal(view._renderEventPreview(decided), true);
    assert.equal(findActors(view._body, (actor) => actor.styleClasses.has("xpuwlm-run-note")).length, 0);

    view._body = new FakeActor();
    const confirm = projected("confirm-export", [kept, rejected]);
    assert.equal(view._renderEventConfirmation(confirm), true);
    assert.equal(findActors(view._body, (actor) => typeof actor.text === "string"
        && actor.text.startsWith("Kept event · ")).length, 1);
    assert.equal(findActors(view._body, (actor) => typeof actor.text === "string"
        && actor.text.startsWith("Rejected event · ")).length, 0);
    assert.equal(findActors(view._body, (actor) => actor.styleClasses.has("xpuwlm-event-confirmation"))[0]
        .clutter_text.line_wrap, true);
    assert.equal(findActors(view._body, (actor) => actor.styleClasses.has("xpuwlm-event-confirmed"))[0]
        .clutter_text.line_wrap, true);
});

test("event action matrix and editable fields pin enablement and accessibility", () => {
    const {view} = harness();
    const base = {
        available: true,
        chooserEnabled: true,
        startEnabled: false,
        cancelEnabled: false,
        exportRefusal: "",
        complete: false,
    };
    const cases = [
        ["idle", {}, ["event-choose-files", "event-choose-folder"]],
        ["selected", {startEnabled: true}, ["event-choose-files", "event-choose-folder", "event-start"]],
        ["submitting", {cancelEnabled: true}, ["event-cancel"]],
        ["running", {cancelEnabled: true}, ["event-cancel"]],
        ["preview", {}, ["event-choose-files", "event-choose-folder", "event-review-export"]],
        ["confirm-export", {}, ["event-confirm-export", "event-back-preview"]],
        ["complete", {complete: true}, ["event-choose-files", "event-choose-folder", "event-reset"]],
        ["error", {}, ["event-choose-files", "event-choose-folder"]],
        ["exporting", {}, []],
    ];
    for (const [phase, overrides, expected] of cases) {
        view._body = new FakeActor();
        assert.equal(view._renderEventActions({...base, phase, ...overrides}), true, phase);
        assert.deepEqual(identities(view._body), expected, phase);
        for (const actor of findActors(view._body, (candidate) => expected.includes(candidate.xpuwlmIdentity))) {
            assert.equal(actor.reactive, true, `${phase}:${actor.xpuwlmIdentity}`);
            assert.equal(actor.can_focus, true, `${phase}:${actor.xpuwlmIdentity}`);
            assert.equal(actor.accessibleStates.has("sensitive"), true, `${phase}:${actor.xpuwlmIdentity}`);
            const primary = ["event-start", "event-review-export", "event-confirm-export"]
                .includes(actor.xpuwlmIdentity);
            assert.equal(
                actor.styleClasses.has(primary ? "xpuwlm-primary-button" : "xpuwlm-secondary-button"),
                true,
                `${phase}:${actor.xpuwlmIdentity}:hierarchy`,
            );
        }
    }

    view._body = new FakeActor();
    view._renderEventActions({...base, phase: "preview", exportRefusal: "Decide first"});
    const refused = findActors(view._body, (actor) => actor.xpuwlmIdentity === "event-review-export")[0];
    assert.equal(refused.reactive, false);
    assert.equal(refused.can_focus, false);
    assert.equal(refused.styleClasses.has("xpuwlm-button-disabled"), true);
    assert.equal(refused.accessibleStates.has("sensitive"), false);

    const entry = view._entry(null, "Empty event title", "event-title:empty");
    assert.equal(entry.text, "");
    assert.equal(entry.can_focus, true);
    assert.equal(entry.styleClasses.has("xpuwlm-event-entry"), true);
    assert.equal(entry.accessibleName, "Empty event title");
    assert.equal(entry.xpuwlmIdentity, "event-title:empty");
});

test("pending runtime control is announced and disables policy controls", () => {
    const {view, root} = harness();
    view.render(ViewModel.toViewModel(baseState({
        selectedTab: "profiles",
        control: {pending: true, message: "Applying change in runtime…"},
    }), NOW));
    view._openDetail("profiles");
    assert.equal(findActors(root, (actor) => actor.text === "Applying change in runtime…").length, 1);
    for (const accessibleName of [
        "Decrease Hardware health weight",
        "Increase Hardware health weight",
        "Disable Hardware health",
    ]) {
        assert.equal(control(root, accessibleName).reactive, false, accessibleName);
    }

    view.render(ViewModel.toViewModel(baseState({
        selectedTab: "profiles",
        control: {pending: false, message: "Runtime rejected the change; retry"},
    }), NOW));
    const feedback = findActors(root, (actor) => actor.text === "Runtime rejected the change; retry")[0];
    assert.equal(feedback.styleClasses.has("xpuwlm-control-error"), true);
    assert.equal(control(root, "Disable Hardware health").reactive, true);
});

test("alerts screen renders empty, active, resolved, and fallback evidence", () => {
    const {view, root} = harness();
    view.render(ViewModel.toViewModel(baseState({
        selectedTab: "alerts",
        metrics: {load: 42, queueDepth: 0, runningProfiles: 0},
    }), NOW));
    assert.equal(findActors(root, (actor) => actor.text === "No active jobs").length, 2);

    const alerts = [
        {id: "active", profileId: "hardware-health", title: "Voltage drift", summary: "", severity: "warning", timestamp: NOW, confidence: null, riskScore: 0.7, resolved: false},
        {id: "done", profileId: "hardware-health", title: "Temperature stable", summary: "Resolved", severity: "advisory", timestamp: NOW, confidence: 0.9, riskScore: 0.1, resolved: true},
    ];
    view.render(ViewModel.toViewModel(baseState({selectedTab: "alerts", alerts, attentionCount: 1}), NOW));
    assert.equal(findActors(root, (actor) => actor.text === "Voltage drift").length, 1);
    assert.equal(findActors(root, (actor) => actor.text === "No additional detail was supplied.").length, 1);
    assert.equal(findActors(root, (actor) => actor.text === "Temperature stable").length, 1);

    const changedAlerts = [
        {
            ...alerts[0],
            title: "Critical voltage drift",
            summary: "Disconnect the supply",
            severity: "critical",
            confidence: 0.8,
            riskScore: 0.9,
        },
        alerts[1],
    ];
    view.render(ViewModel.toViewModel(baseState({
        selectedTab: "alerts",
        alerts: changedAlerts,
        attentionCount: 1,
    }), NOW));
    assert.equal(findActors(root, (actor) => actor.text === "Voltage drift").length, 0);
    assert.equal(findActors(root, (actor) => actor.text === "No additional detail was supplied.").length, 0);
    assert.equal(findActors(root, (actor) => actor.text === "Critical voltage drift").length, 1);
    assert.equal(findActors(root, (actor) => actor.text === "Disconnect the supply").length, 1);
    assert.equal(findActors(root, (actor) => actor.text === "critical").length, 1);
    assert.equal(findActors(root, (actor) => actor.text === "80%").length, 1);
    assert.equal(findActors(root, (actor) => actor.text === "90%").length, 1);
    assert.equal(findActors(root, (actor) => actor.styleClasses.has("xpuwlm-alert-critical")).length, 1);
});

test("alerts screen renders critical and newer alerts before lower priorities", () => {
    const {view, root} = harness();
    const alerts = [
        {id: "advisory", profileId: "hardware-health", title: "Advisory", summary: "", severity: "advisory", timestamp: NOW, confidence: null, riskScore: null, resolved: false},
        {id: "warning-old", profileId: "hardware-health", title: "Warning old", summary: "", severity: "warning", timestamp: NOW - 1000, confidence: null, riskScore: null, resolved: false},
        {id: "critical", profileId: "hardware-health", title: "Critical", summary: "", severity: "critical", timestamp: NOW - 5000, confidence: null, riskScore: null, resolved: false},
        {id: "warning-new", profileId: "hardware-health", title: "Warning new", summary: "", severity: "warning", timestamp: NOW, confidence: null, riskScore: null, resolved: false},
    ];
    view.render(ViewModel.toViewModel(baseState({
        selectedTab: "alerts",
        alerts,
        attentionCount: alerts.length,
    }), NOW));

    const titles = findActors(root, (actor) => actor.styleClasses.has("xpuwlm-alert-title"))
        .map((actor) => actor.text);
    assert.deepEqual(titles, ["Critical", "Warning new", "Warning old", "Advisory"]);
});

test("paused screen invokes resume independently of button presentation text", () => {
    const {calls, view, root} = harness();
    view.render(ViewModel.toViewModel(baseState({paused: true}), NOW));
    const bodyResume = button(root, "Resume all workloads");
    const label = bodyResume.children[0];
    label.set_text("Localized resume text");
    bodyResume.click();
    assert.deepEqual(calls, [["resumeAll"]]);
    assert.equal(findActors(root, (actor) => actor.text === "Local policy paused").length, 1);
    assert.equal(findActors(root, (actor) => actor.styleClasses.has("xpuwlm-tabs"))[0].visible, false);
    assert.equal(view._footer.visible, false);
});

test("unavailable screen hides tabs and offers recovery", () => {
    const {calls, view, root} = harness();
    view.render(ViewModel.toViewModel(baseState({
        device: {available: false, name: "No TPU", kind: "unknown", reason: "Reconnect device"},
    }), NOW));
    assert.equal(findActors(root, (actor) => actor.styleClasses.has("xpuwlm-tabs"))[0].visible, false);
    assert.equal(view._footer.visible, false);
    assert.equal(findActors(root, (actor) => actor.text === "Reconnect device").length, 1);
    button(root, "Retry accelerator detection").click();
    assert.deepEqual(calls, [["refresh"]]);
});

test("unavailable screen omits unrelated pause controls", () => {
    const {view, root} = harness();
    const device = {available: false, name: "No TPU", kind: "unknown", reason: "Reconnect device"};
    view.render(ViewModel.toViewModel(baseState({paused: true, device}), NOW));

    assert.equal(findActors(root, (actor) => actor.text === "Reconnect device").length, 1);
    view.render(ViewModel.toViewModel(baseState({paused: false, device}), NOW));
    assert.equal(button(root, "Pause all workloads"), undefined);
    assert.equal(button(root, "Resume all workloads"), undefined);
});

test("body rendering skips unchanged content and destroy is idempotent", () => {
    const {view, root} = harness();
    const model = ViewModel.toViewModel(baseState(), NOW);
    view.render(model);
    const body = findActors(root, (actor) => actor.styleClasses.has("xpuwlm-body"))[0];
    const originalChildren = body.children.slice();
    view.render(model);
    assert.deepEqual(body.children, originalChildren);
    assert.equal(view.destroy(), true);
    assert.equal(root.destroyed, true);
    assert.equal(view.destroy(), false);
});

test("labels tolerate actors without a clutter text delegate", () => {
    const {view} = harness();
    view._St = {...view._St, Label: FakeActor};
    const label = view._label("Accessible text", "copy");
    assert.equal(label.text, "Accessible text");
    assert.equal(view._label(null, "copy").text, "");
    view.destroy();
});

// Plug-in installs, upgrades, and removals were computed and discarded. The
// popup now states them above the workload data they affect, in words, and
// keeps the notice until the user acknowledges it.
test("the catalog notice appears with named plug-ins and dismisses on demand", () => {
    const {calls, view, root} = harness();
    const notice = findActors(root, (actor) => actor.styleClasses
        && actor.styleClasses.has("xpuwlm-catalog-notice"))[0];
    assert.equal(notice.visible, false);

    view.render(ViewModel.toViewModel(baseState({
        catalogChanges: {
            installed: ["hardware-health"],
            upgraded: [],
            removed: ["third-party-workload"],
        },
    }), NOW));
    assert.equal(notice.visible, true);
    assert.equal(
        notice.accessibleName,
        "Workload catalog changed: Installed: Hardware health · Removed: third-party-workload",
    );
    const texts = findActors(notice, (actor) => typeof actor.text === "string").map((actor) => actor.text);
    assert.deepEqual(texts, [
        "2 workload plug-ins changed",
        "Installed: Hardware health · Removed: third-party-workload",
        "Dismiss",
    ]);
    // The copy stacks title over detail and takes the free width, so the
    // dismiss control keeps its own edge instead of floating mid-row.
    assert.equal(notice.children[0].vertical, true);
    assert.equal(notice.children[0].x_expand, true);

    button(root, "Dismiss the workload catalog change notice").click();
    assert.deepEqual(calls, [["acknowledgeCatalogChanges"]]);

    // Acknowledgement clears the projection, and the next render hides the row
    // without rebuilding the body underneath it.
    view.render(ViewModel.toViewModel(baseState(), NOW));
    assert.equal(notice.visible, false);

    // A model built before this notice existed carries no field at all; the
    // row must stay hidden rather than render an undefined change set.
    view.render({...ViewModel.toViewModel(baseState(), NOW), catalogNotice: undefined});
    assert.equal(notice.visible, false);
});

// Three blockers, three remedies. A host is normally missing more than one
// thing at a time, so the group has to keep them apart rather than average
// them into one sentence.
function blockedState(selectedTab = "profiles") {
    const blockers = {
        "hardware-health": "Ready on gpu; no model bundled",
        "desktop-context": "gpu: ncnn is not installed",
        "storage-intelligence": "tpu: No Coral Edge TPU device detected",
        "build-advisor": "gpu: a reason nobody wrote a label for",
    };
    const state = baseState({selectedTab});
    state.profiles = state.profiles.map((profile) => (Object.hasOwn(blockers, profile.id)
        ? {...profile, status: "unavailable", detail: blockers[profile.id]}
        : profile));
    return state;
}

test("the snapshot reason code survives normalization into blocker classification", () => {
    const portfolio = new Domain.WorkloadPortfolio(null, BuiltIns.coreCatalog());
    const profiles = portfolio.list({
        "resource-scheduler": {
            status: "unavailable",
            queued: 0,
            detail: "texte localisé sans phrase anglaise",
            reason: "no-model",
        },
    });
    const resource = ViewModel.profileModel(
        profiles.find((profile) => profile.id === "resource-scheduler"),
    );

    assert.equal(resource.reason, "no-model");
    assert.equal(resource.blocker.kind, "model");
    assert.equal(resource.blocker.reason, "No model installed");
});

function disclosure(root) {
    return findActors(root, (actor) => actor.xpuwlmIdentity === "blocked-disclosure")[0];
}

function blockedList(root) {
    return findActors(root, (actor) => actor.styleClasses
        && actor.styleClasses.has("xpuwlm-disclosure-list"))[0];
}

test("profiles that cannot run collapse into one group under the ones that can", () => {
    const {view, root} = harness();
    view.render(ViewModel.toViewModel(blockedState(), NOW));
    view._openDetail("profiles");

    const body = findActors(root, (actor) => actor.styleClasses.has("xpuwlm-body"))[0];
    const list = blockedList(root);
    assert.equal(body.children.at(-1), list, "the group is last, under the runnable profiles");
    assert.equal(list.visible, false, "it starts collapsed");
    assert.equal(list.children.length, 4);

    // Each blocked profile states its own reason; the recognised ones are
    // labelled and the unrecognised one is quoted exactly.
    assert.deepEqual(
        findActors(list, (actor) => actor.styleClasses
            && actor.styleClasses.has("xpuwlm-profile-limitation")).map((actor) => actor.text),
        [
            "No model installed · see Diagnostics",
            "No supported accelerator present · see Diagnostics",
            "gpu: a reason nobody wrote a label for · see Diagnostics",
            "Accelerator runtime not installed · see Diagnostics",
        ],
    );

    // Runnable profiles stay in their own groups and carry no limitation.
    const runnable = findActors(root, (actor) => actor.styleClasses
        && actor.styleClasses.has("xpuwlm-profile-row") && actor.parent === body);
    assert.equal(runnable.length, 4);
    assert.equal(
        findActors(root, (actor) => actor.styleClasses
            && actor.styleClasses.has("xpuwlm-profile-limitation")).length,
        4,
    );
});

test("Advanced profiles expands and focuses the readiness disclosure", () => {
    const {view, root} = harness();
    view.render(ViewModel.toViewModel(blockedState("profiles"), NOW));
    button(root, "Open advanced workload profiles").click();
    view._focusBlockedDisclosure();
    assert.equal(blockedList(root).visible, true);
    assert.equal(disclosure(root).focused, true);
    assert.equal(disclosure(root).accessibleName, "Needs setup, 4 profiles, expanded");
    assert.equal(disclosure(root).accessibleStates.has("expanded"), true);
    disclosure(root).click();
    assert.equal(blockedList(root).visible, false, "the disclosure remains independently operable");
});

test("profile-management focus survives guarded actors", () => {
    const delayed = harness();
    delayed.view.render(ViewModel.toViewModel(blockedState("profiles"), NOW));
    delayed.view._openDetail("profiles");
    const staleDisclosure = disclosure(delayed.root);
    assert.equal(delayed.view._focusBlockedDisclosure(), true);
    assert.equal(staleDisclosure.focused, true);

    const guarded = harness();
    assert.equal(guarded.view._focusBlockedDisclosure(), false);
    guarded.view.render(ViewModel.toViewModel(blockedState("profiles"), NOW));
    guarded.view._openDetail("profiles");
    guarded.view._blocked.disclosure.grab_key_focus = null;
    assert.equal(guarded.view._focusBlockedDisclosure(), true);
    assert.equal(guarded.view._blockedExpanded, true);
    assert.equal(guarded.view.destroy(), true);
});

test("the collapsed group is operable and announces its own state", () => {
    const {view, root} = harness();
    view.render(ViewModel.toViewModel(blockedState(), NOW));
    view._openDetail("profiles");

    const toggle = disclosure(root);
    const list = blockedList(root);
    const arrow = findActors(toggle, (actor) => actor.styleClasses
        && actor.styleClasses.has("xpuwlm-disclosure-arrow"))[0];
    const title = findActors(toggle, (actor) => actor.styleClasses
        && actor.styleClasses.has("xpuwlm-disclosure-title"))[0];

    assert.equal(toggle.accessibleRole, "toggle-button");
    assert.equal(toggle.can_focus, true);
    assert.equal(toggle.accessibleName, "Needs setup, 4 profiles, collapsed");
    assert.equal(toggle.accessibleStates.has("expanded"), false);
    assert.equal(title.text, "Needs setup (4)");
    assert.equal(arrow.text, "▸");
    assert.equal(
        findActors(toggle, (actor) => actor.text === "4 profiles cannot run yet").length,
        1,
    );

    toggle.click();
    assert.equal(list.visible, true);
    assert.equal(arrow.text, "▾");
    assert.equal(toggle.accessibleName, "Needs setup, 4 profiles, expanded");
    assert.equal(toggle.accessibleStates.has("expanded"), true);
    assert.equal(toggle.styleClasses.has("xpuwlm-disclosure-open"), true);

    // The reading position survives a refresh that rebuilds the body.
    const changed = blockedState();
    changed.profiles = changed.profiles.map((profile) => ({...profile, queued: 7}));
    view.render(ViewModel.toViewModel(changed, NOW));
    assert.equal(blockedList(root).visible, true);
    assert.equal(disclosure(root).accessibleName, "Needs setup, 4 profiles, expanded");

    disclosure(root).click();
    assert.equal(blockedList(root).visible, false);
});

test("controls on a profile that cannot run are disabled and say why", () => {
    const {calls, tooltips, view, root} = harness();
    view.render(ViewModel.toViewModel(blockedState(), NOW));
    view._openDetail("profiles");

    const reason = "No model installed · see Diagnostics";
    const inert = control(root, "Disable Hardware health");
    assert.equal(inert.accessibleName, `Disable Hardware health — ${reason}`);
    assert.equal(inert.reactive, false, "a control that changes nothing is not offered");
    assert.equal(inert.can_focus, false);
    assert.equal(inert.styleClasses.has("xpuwlm-button-disabled"), true);
    assert.equal(inert.accessibleStates.has("sensitive"), false);

    for (const name of ["Decrease Hardware health weight", "Increase Hardware health weight"]) {
        const weight = control(root, name);
        assert.equal(weight.reactive, false, name);
        assert.equal(weight.can_focus, false, name);
        assert.equal(weight.styleClasses.has("xpuwlm-button-disabled"), true, name);
    }

    // The pointer falls through the dead controls to the row, which carries a
    // tooltip with the same words the row prints.
    const row = findActors(root, (actor) => actor.styleClasses
        && actor.styleClasses.has("xpuwlm-profile-inert"))[0];
    assert.equal(row.reactive, true);
    assert.equal(tooltips.filter((tooltip) => tooltip.actor === row)[0].text, reason);
    assert.equal(tooltips.length, 4);

    const runnable = control(root, "Enable Network & peripherals");
    assert.equal(runnable.accessibleName, "Enable Network & peripherals");
    assert.equal(runnable.reactive, true);
    runnable.click();
    assert.deepEqual(calls, [["toggleProfile", "network-peripherals"]]);
});

test("a catalog the runtime serves whole carries no group and no limitation", () => {
    const {view, root} = harness();
    view.render(ViewModel.toViewModel(baseState({selectedTab: "profiles"}), NOW));
    view._openDetail("profiles");

    assert.equal(disclosure(root), undefined);
    assert.equal(blockedList(root), undefined);
    assert.equal(
        findActors(root, (actor) => actor.styleClasses
            && actor.styleClasses.has("xpuwlm-profile-limitation")).length,
        0,
    );
    assert.equal(
        findActors(root, (actor) => actor.styleClasses
            && actor.styleClasses.has("xpuwlm-empty-note")).length,
        0,
    );
});

test("a catalog nothing can run says so instead of showing an empty tab", () => {
    const {view, root} = harness();
    const state = baseState({selectedTab: "profiles"});
    state.profiles = state.profiles.map((profile) => ({
        ...profile,
        status: "unavailable",
        detail: "gpu: ncnn is not installed",
    }));
    view.render(ViewModel.toViewModel(state, NOW));
    view._openDetail("profiles");

    const note = findActors(root, (actor) => actor.styleClasses
        && actor.styleClasses.has("xpuwlm-empty-note"))[0];
    assert.match(note.text, /No workload profile can run on this machine yet/u);
    assert.match(note.text, /Diagnostics/u);
    assert.equal(blockedList(root).children.length, state.profiles.length);
});

test("the collapsed group and the setup tab report what they did", () => {
    const {view, root} = harness();
    const blocked = ViewModel.toViewModel(blockedState(), NOW);

    // No group on a screen that has none, and no stale reference left behind
    // by the screen that did.
    view.render(ViewModel.toViewModel(baseState(), NOW));
    assert.equal(view._applyBlockedExpansion(), false);
    assert.equal(view._toggleBlockedProfiles(), false);
    assert.equal(view._renderBlockedProfiles({blockedGroup: null}), false);
    assert.equal(view._renderBlockedProfiles({blockedGroup: undefined}), false);

    view.render(blocked);
    view._openDetail("profiles");
    assert.equal(view._applyBlockedExpansion(), false, "the group starts collapsed");
    assert.equal(view._toggleBlockedProfiles(), true);

    // The disclosure stacks its title over its summary and takes the free
    // width, so the arrow keeps its own edge.
    const copy = findActors(root, (actor) => actor.styleClasses
        && actor.styleClasses.has("xpuwlm-disclosure-title"))[0].parent;
    assert.equal(copy.vertical, true);
    assert.equal(copy.x_expand, true);
    // The arrow sits beside that column, and the rows stack under the button.
    const arrowRow = findActors(root, (actor) => actor.styleClasses
        && actor.styleClasses.has("xpuwlm-disclosure-row"))[0];
    assert.equal(arrowRow.vertical, false);
    assert.equal(blockedList(root).vertical, true);

    view.render(ViewModel.toViewModel(blockedState("setup"), NOW));
    view._openDetail("setup");
    const setupCopy = findActors(root, (actor) => actor.styleClasses
        && actor.styleClasses.has("xpuwlm-setup-row"))[0].children[0];
    assert.equal(setupCopy.vertical, true);
    assert.equal(setupCopy.x_expand, true);

    assert.equal(view._renderSetup(blocked), true);
    assert.equal(view._renderSetup(ViewModel.toViewModel(allToolsState(), NOW)), false);
    assert.equal(view._renderBlockedProfiles(blocked), true);
    assert.deepEqual(
        blocked.setup.sections.map((section) => view._renderSetupSection(section)),
        ["runtime", "model-design", "hardware", "unknown"],
    );
});

test("the setup tab explains each remedy once, for every profile that needs it", () => {
    const {view, root} = harness();
    view.render(ViewModel.toViewModel(blockedState("setup"), NOW));
    view._openDetail("setup");

    const titles = findActors(root, (actor) => actor.styleClasses
        && actor.styleClasses.has("xpuwlm-group-title")).map((actor) => actor.text);
    assert.deepEqual(titles, [
        "Unavailable tools",
        "Install the accelerator runtime",
        "No qualified model is available",
        "Connect supported hardware",
        "Reported by the runtime",
    ]);
    const counts = findActors(root, (actor) => actor.styleClasses
        && actor.styleClasses.has("xpuwlm-group-value")).map((actor) => actor.text);
    assert.deepEqual(counts, ["5 tools", "1 profile", "1 profile", "1 profile", "1 profile"]);

    // Every affected profile is named under its own remedy.
    const rows = findActors(root, (actor) => actor.styleClasses
        && actor.styleClasses.has("xpuwlm-setup-row"));
    assert.deepEqual(
        rows.map((row) => findActors(row, (actor) => actor.styleClasses
            && actor.styleClasses.has("xpuwlm-profile-title"))[0].text),
        ["Desktop context", "Hardware health", "Storage intelligence", "Build advisor"],
    );
    assert.equal(
        findActors(root, (actor) => actor.text === "gpu: a reason nobody wrote a label for").length,
        1,
        "an unrecognised reason reaches the tab that explains it, unaltered",
    );

    // Only the two remedies that have a reference carry a note; the section
    // for hardware that cannot be installed adds nothing after its rows.
    assert.equal(
        findActors(root, (actor) => actor.styleClasses
            && actor.styleClasses.has("xpuwlm-setup-note")).length,
        2,
    );
    assert.equal(
        findActors(root, (actor) => actor.styleClasses
            && actor.styleClasses.has("xpuwlm-setup-description")).length,
        4,
    );

    // Only the runtime remedy has a command; no model-design command is faked.
    const commands = findActors(root, (actor) => actor.styleClasses
        && actor.styleClasses.has("xpuwlm-command"));
    assert.deepEqual(commands.map((actor) => actor.text), [
        "pip install 'omnitensor[gpu]'",
    ]);
    // Selectable rather than a Copy button St cannot honour, and never
    // ellipsized: a truncated command is one the user cannot retype.
    for (const command of commands) {
        assert.equal(command.reactive, true);
        assert.equal(command.can_focus, true);
        assert.equal(command.clutter_text.selectable, true);
        assert.equal(command.clutter_text.editable, false);
        assert.equal(command.clutter_text.line_wrap, true);
        assert.equal(command.clutter_text.ellipsize, 0);
    }
});

test("resource scheduler setup renders the supported local forecast entry point", () => {
    const {view, root} = harness();
    const snapshot = baseState({selectedTab: "setup"});
    snapshot.profiles = snapshot.profiles.map((profile) => (profile.id === "resource-scheduler"
        ? {
            ...profile,
            status: "unavailable",
            detail: "localized missing-model detail",
            reason: "no-model",
        }
        : profile));

    view.render(ViewModel.toViewModel(snapshot, NOW));
    view._openDetail("setup");

    assert.equal(
        findActors(root, (actor) => actor.text === "Train a local Resource Scheduler forecast").length,
        1,
    );
    const commands = findActors(root, (actor) => actor.styleClasses
        && actor.styleClasses.has("xpuwlm-command"));
    assert.deepEqual(commands.map((actor) => actor.text), [
        "omnitensor-record-runtime-snapshot --profile resource-scheduler"
        + " --selector queueDepth --selector runningProfiles",
    ]);
    const notes = findActors(root, (actor) => actor.styleClasses
        && actor.styleClasses.has("xpuwlm-setup-note"));
    assert.match(notes[0].text, /omnitensor-train-model/u);
    assert.match(notes[0].text, /omnitensor-install-trained-model/u);
    assert.match(notes[0].text, /omnitensor-run-forecast/u);
});

test("the setup tab says so when nothing needs installing", () => {
    const {view, root} = harness();
    view.render(ViewModel.toViewModel(allToolsState({selectedTab: "setup"}), NOW));
    view._openDetail("setup");

    assert.equal(findActors(root, (actor) => actor.text === "Every workload profile can run").length, 1);
    assert.equal(
        findActors(root, (actor) => actor.text === "Tools and workload profiles are ready").length,
        1,
    );
    assert.equal(
        findActors(root, (actor) => actor.styleClasses && actor.styleClasses.has("xpuwlm-command")).length,
        0,
    );
    assert.equal(
        findActors(root, (actor) => actor.styleClasses && actor.styleClasses.has("xpuwlm-setup-row")).length,
        0,
    );
});

test("Diagnostics joins the strip and exposes setup from its status row", () => {
    const {calls, view, root} = harness();
    view.render(ViewModel.toViewModel(blockedState(), NOW));
    view._openDetail("profiles");

    // The profile limitation points to Diagnostics, which is a tab the user
    // can reach. Setup remains a focused drill-in from that screen.
    const limitation = findActors(root, (actor) => actor.styleClasses
        && actor.styleClasses.has("xpuwlm-profile-limitation"))[0];
    assert.match(limitation.text, /see Diagnostics$/u);
    button(root, "Diagnostics tab").click();
    assert.deepEqual(calls, [["selectTab", "setup"]]);

    const diagnostics = ViewModel.toViewModel(blockedState("setup"), NOW);
    view.render(diagnostics);
    assert.equal(button(root, "Diagnostics tab, selected").styleClasses.has("xpuwlm-tab-active"), true);
    button(root, `Open setup details, ${diagnostics.diagnostics.setupStatus}`).click();
    assert.equal(findActors(root, (actor) => actor.text === "What needs setup").length, 1);
});

test("the alerts screen states runtime content it could not render", () => {
    const {view, root} = harness();
    const sectionTitles = () => findActors(root, (actor) => actor.styleClasses
        && actor.styleClasses.has("xpuwlm-section-title")).map((actor) => actor.text);

    view.render(ViewModel.toViewModel(baseState({
        selectedTab: "alerts",
        unknownContent: {profiles: 1, alerts: 2},
    }), NOW));
    const notice = sectionTitles().find((text) => text.includes("not installed here"));
    assert.equal(notice, "3 runtime items name workloads that are not installed here");
    const heading = findActors(root, (actor) => actor.accessibleName
        && actor.accessibleName.includes("Install the missing workload plug-in"));
    assert.equal(heading.length, 1);

    view.render(ViewModel.toViewModel(baseState({selectedTab: "alerts"}), NOW));
    assert.equal(sectionTitles().some((text) => text.includes("not installed here")), false);

    // A model built before this notice existed carries no field at all.
    view.render({
        ...ViewModel.toViewModel(baseState({selectedTab: "alerts"}), NOW),
        unknownContent: undefined,
        bodyKey: "forced-rebuild",
    });
    assert.equal(sectionTitles().some((text) => text.includes("not installed here")), false);
});

// The notice sits outside the tab body so a plug-in change is still reported
// while the popup is showing a safety state.
test("the catalog notice survives the unavailable and paused screens", () => {
    const {view, root} = harness();
    const notice = findActors(root, (actor) => actor.styleClasses
        && actor.styleClasses.has("xpuwlm-catalog-notice"))[0];
    for (const overrides of [
        {paused: true},
        {device: {available: false, state: "absent", name: "No device", kind: "unknown", reason: "No accelerator detected"}},
    ]) {
        view.render(ViewModel.toViewModel(baseState({
            ...overrides,
            catalogChanges: {installed: ["desktop-context"], upgraded: [], removed: []},
        }), NOW));
        assert.equal(notice.visible, true);
    }
});
