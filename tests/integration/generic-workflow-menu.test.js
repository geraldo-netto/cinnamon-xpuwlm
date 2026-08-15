"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const Domain = require("../../files/cinnamon-xpuwlm@geraldo-netto/lib/domain.js");
const BuiltIns = require("../helpers/built-in-workloads.js");
const Menu = require("../../files/cinnamon-xpuwlm@geraldo-netto/lib/menu-view.js");
const Surface = require("../../files/cinnamon-xpuwlm@geraldo-netto/lib/generic-workflow-surface.js");
const ViewModel = require("../../files/cinnamon-xpuwlm@geraldo-netto/lib/view-model.js");
const WorkflowViewModel = require("../../files/cinnamon-xpuwlm@geraldo-netto/lib/workflow-view-model.js");
const {
    FakeMenu,
    createAtk,
    createClutter,
    createSt,
    findActors,
} = require("../helpers/fakes.js");

const NOW = 1_700_000_000_000;

const DEFINITION = Object.freeze({
    version: 1,
    id: "hardware-health",
    title: "Hardware health",
    description: "Review local anomaly evidence",
    consentPurpose: "Reads local sensors",
    supportsBackground: true,
    retentionText: "Results stay on this computer.",
    reviewOnly: true,
});

function surfaceState(overrides = {}) {
    return {
        available: true,
        unavailableReason: "",
        consent: "granted",
        backgroundEnabled: false,
        phase: "complete",
        progress: null,
        warning: "",
        retainedCount: 1,
        result: {
            version: 1,
            kind: "risk-score",
            workloadId: "hardware-health",
            operationId: "op-1",
            createdAt: 1,
            payload: {label: "Fan", score: 0.4, threshold: 0.8, evidenceIds: ["e1"]},
        },
        ...overrides,
    };
}

function baseState(genericWorkflows) {
    return {
        selectedTab: "overview",
        paused: false,
        profiles: new Domain.WorkloadPortfolio(null, BuiltIns.coreCatalog())
            .list(BuiltIns.servingProfiles()),
        device: {available: true, state: "present", name: "Coral USB", kind: "usb", reason: ""},
        health: {device: "present", runtime: "connected", detail: ""},
        metrics: {load: 42, queueDepth: 2, runningProfiles: 1},
        alerts: [],
        attentionCount: 0,
        stale: false,
        source: "runtime",
        generatedAt: NOW,
        genericWorkflows,
    };
}

function harness() {
    const dispatched = [];
    const actions = {
        dispatchGenericWorkflow: (...args) => dispatched.push(args),
    };
    for (const name of [
        "selectTab", "toggleProfile", "changeWeight", "pauseAll", "resumeAll",
        "refresh", "openSettings", "acknowledgeCatalogChanges", "submitJob",
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
    view.setOpen(true);
    return {dispatched, menu, view, root: menu.actors[0]};
}

function labels(root) {
    return findActors(root, (actor) => typeof actor.text === "string").map((actor) => actor.text);
}

test("a registered generic workflow becomes an openable tool row", () => {
    const {view, root} = harness();
    const model = Surface.createSurfaceModel(DEFINITION, surfaceState());
    view.render(ViewModel.toViewModel(baseState([model]), NOW));

    const row = findActors(root, (actor) => actor.xpuwlmIdentity === "tool:generic:hardware-health")[0];
    assert.notEqual(row, undefined, "the workflow is listed among the tools");
    assert.equal(labels(root).includes("Hardware health"), true);
});

test("opening one renders its evidence, retention, consent, and controls", () => {
    const {dispatched, view, root} = harness();
    const model = Surface.createSurfaceModel(DEFINITION, surfaceState());
    view.render(ViewModel.toViewModel(baseState([model]), NOW));
    view._openDetail("generic:hardware-health");

    const text = labels(root).join("\n");
    assert.match(text, /Hardware health/u);
    assert.match(text, /Reads local sensors/u, "the consent purpose is stated");
    assert.match(text, /Results stay on this computer\./u, "retention is stated");
    assert.match(text, /Review only/u, "a generic run never acts on the system");

    const run = findActors(
        root, (actor) => actor.xpuwlmIdentity === "generic-hardware-health-run-now",
    )[0];
    assert.notEqual(run, undefined, "the run control is present");
    run.emit("clicked");
    assert.deepEqual(dispatched, [["hardware-health", "run-now", true]]);
});

test("an unavailable workflow explains itself instead of offering a dead control", () => {
    const {view, root} = harness();
    const model = Surface.createSurfaceModel(DEFINITION, surfaceState({
        available: false,
        unavailableReason: "The runtime is not serving this profile",
        phase: "idle",
        result: null,
        retainedCount: 0,
    }));
    view.render(ViewModel.toViewModel(baseState([model]), NOW));
    view._openDetail("generic:hardware-health");

    const text = labels(root).join("\n");
    assert.match(text, /The runtime is not serving this profile/u);
    const run = findActors(
        root, (actor) => actor.xpuwlmIdentity === "generic-hardware-health-run-now",
    )[0];
    assert.equal(run.reactive, false, "an unavailable workflow cannot be run");
});

test("a working workflow shows its progress and offers cancellation", () => {
    const {view, root} = harness();
    const model = Surface.createSurfaceModel(DEFINITION, surfaceState({
        phase: "running",
        progress: {fraction: 0.5, detail: "Reading sensors"},
        result: null,
        retainedCount: 0,
    }));
    view.render(ViewModel.toViewModel(baseState([model]), NOW));
    view._openDetail("generic:hardware-health");

    assert.match(labels(root).join("\n"), /50% · Reading sensors/u);
    assert.notEqual(
        findActors(root, (actor) => actor.xpuwlmIdentity === "generic-hardware-health-cancel")[0],
        undefined,
    );
});

test("a warning is shown and a detail for an absent workflow renders nothing", () => {
    const {view, root} = harness();
    const model = Surface.createSurfaceModel(DEFINITION, surfaceState({
        phase: "error",
        warning: "The runtime refused the job",
        result: null,
        retainedCount: 0,
    }));
    view.render(ViewModel.toViewModel(baseState([model]), NOW));
    view._openDetail("generic:hardware-health");
    assert.match(labels(root).join("\n"), /The runtime refused the job/u);

    view._openDetail("generic:absent-workflow");
    assert.equal(labels(root).join("\n").includes("Hardware health"), false);
});

// The renderers are reachable with models `createSurfaceModel` cannot build —
// a result carrying more evidence than the surface shows, and the non-review
// wording a future non-advisory workflow would use — so they are driven
// directly here rather than left unexercised.
test("each consent state, an unexplained refusal, and a trimmed result all render", () => {
    const {view, root} = harness();
    view.render(ViewModel.toViewModel(baseState([]), NOW));

    for (const [state, expected] of [
        ["required", /Consent required/u],
        ["granted", /Consent granted/u],
        ["denied", /Consent denied/u],
        ["not-required", /Consent not required/u],
    ]) {
        view._renderGenericConsent({visible: true, purpose: "Reads local sensors", state});
        assert.match(labels(root).join("\n"), expected, state);
    }
    assert.equal(view._renderGenericConsent({visible: false, purpose: "", state: "granted"}), false);

    view._renderGenericUnavailable({visible: true, detail: ""});
    assert.match(labels(root).join("\n"), /Required service, source, or hardware is unavailable/u);
    assert.equal(view._renderGenericUnavailable({visible: false, detail: ""}), false);

    assert.equal(view._renderGenericWarning(""), false);
    assert.equal(view._renderGenericProgress({visible: false, text: ""}), false);
    assert.equal(view._renderGenericResult(null, true), false);
    assert.equal(view._renderGenericWorkflowSurface(null), false);
    assert.equal(view._renderGenericWorkflowSurface(undefined), false);

    view._renderGenericResult({
        kind: "labels",
        operationId: "op-2",
        rows: [{title: "Fan", detail: "0.400"}],
        omitted: 3,
    }, false);
    const text = labels(root).join("\n");
    assert.match(text, /3 additional evidence rows omitted/u);
    assert.equal(/Review only/u.test(text.split("op-2")[1] || ""), false);
});

test("only a generic detail key names a generic workflow", () => {
    assert.equal(WorkflowViewModel.genericDetailId("generic:hardware-health"), "hardware-health");
    assert.equal(WorkflowViewModel.genericDetailId("media"), "");
    assert.equal(WorkflowViewModel.genericDetailId(null), "");
    assert.deepEqual(WorkflowViewModel.genericSurfaceModels({}), []);
});

test("the tool row mirrors whatever the surface says about the workflow", () => {
    const ready = WorkflowViewModel.genericToolModel(
        Surface.createSurfaceModel(DEFINITION, surfaceState()),
    );
    assert.deepEqual(
        [ready.id, ready.detail, ready.available, ready.enabled, ready.phase, ready.setupDetail],
        ["generic:hardware-health", "generic:hardware-health", true, true, "idle", ""],
    );

    const working = WorkflowViewModel.genericToolModel(
        Surface.createSurfaceModel(DEFINITION, surfaceState({
            phase: "running", progress: {fraction: 0.1, detail: ""}, result: null, retainedCount: 0,
        })),
    );
    assert.equal(working.phase, "running");
    assert.equal(working.enabled, true);

    const blocked = WorkflowViewModel.genericToolModel(
        Surface.createSurfaceModel(DEFINITION, surfaceState({
            available: false, unavailableReason: "No runtime", phase: "idle",
            result: null, retainedCount: 0,
        })),
    );
    assert.equal(blocked.available, false);
    assert.equal(blocked.enabled, false);
    assert.equal(blocked.setupDetail, "No runtime");
});
