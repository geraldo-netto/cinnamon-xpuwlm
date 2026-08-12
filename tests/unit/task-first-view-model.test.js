"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const Domain = require("../../files/cinnamon-xpuwlm@geraldo-netto/lib/domain.js");
const ViewModel = require("../../files/cinnamon-xpuwlm@geraldo-netto/lib/view-model.js");
const BuiltIns = require("../helpers/built-in-workloads.js");

const NOW = 1_700_000_000_000;

function workflow(overrides = {}) {
    return {
        available: true, availabilityDetail: "", phase: "idle", sources: [],
        candidates: [], citations: [], plan: [], message: "", progress: null,
        evidence: null, result: "", tasks: [], operation: "", exportedPath: "",
        ...overrides,
    };
}

function state(overrides = {}) {
    return {
        selectedTab: "overview", paused: false,
        profiles: new Domain.WorkloadPortfolio(null, BuiltIns.coreCatalog()).list(
            BuiltIns.servingProfiles(),
        ),
        device: {
            backend: "gpu", available: true, name: "AMD GPU", load: 4, reason: "",
        },
        devices: [], health: {device: "present", runtime: "connected", detail: ""},
        metrics: {queueDepth: 0, runningProfiles: 0}, alerts: [], attentionCount: 0,
        source: "runtime", generatedAt: NOW,
        control: {pending: false, message: "", available: true},
        inputs: {roots: ["/inputs"], pictures: [], runnable: ["visual-library"], omitted: 0},
        eventImport: workflow(), documentQuestion: workflow(),
        selectedText: workflow(), fileOrganizer: workflow(),
        ...overrides,
    };
}

test("tool projection has fixed task order with readiness from live ports", () => {
    const projected = ViewModel.toViewModel(state({
        eventImport: workflow({available: false, availabilityDetail: "Provider missing"}),
        selectedText: workflow({phase: "running"}),
    }), NOW);

    assert.deepEqual(projected.tools.map((tool) => tool.id), [
        "documents", "events", "text", "organizer", "picture",
    ]);
    assert.deepEqual(projected.tools.map((tool) => tool.status), [
        "Ready", "Unavailable", "Working", "Ready", "Ready",
    ]);
    assert.equal(projected.tools[1].setupDetail, "Provider missing");
    assert.equal(projected.diagnostics.toolSetup[0].title, "Extract calendar events");
    assert.equal(projected.diagnostics.toolSetup[0].detail, "Provider missing");
    assert.equal(projected.diagnostics.setupCount, 1);
    assert.equal(projected.headerSubtitle, "AMD GPU · Online · 4 tools ready · 1 active job");
});

test("activity separates live, review, recent, and runtime-reported work", () => {
    const projected = ViewModel.toViewModel(state({
        metrics: {queueDepth: 0, runningProfiles: 3},
        eventImport: workflow({phase: "preview", message: "Review events"}),
        documentQuestion: workflow({phase: "complete", message: "Answer ready"}),
        fileOrganizer: workflow({phase: "error", message: "Provider failed"}),
    }), NOW).activity;

    assert.deepEqual(projected.running.map((item) => item.id), ["events", "runtime-workloads"]);
    assert.deepEqual(projected.recent.map((item) => item.id), ["documents", "organizer"]);
    assert.equal(projected.activeCount, 3);
    assert.equal(projected.canClear, true);
});

test("diagnostics report contains current health without secret or source paths", () => {
    const model = ViewModel.toViewModel(state(), NOW);
    assert.match(model.diagnostics.report, /Device: Online — AMD GPU/u);
    assert.match(model.diagnostics.report, /Ready tools: 5\/5/u);
    assert.match(model.diagnostics.report, /Workload service: Ready/u);
    assert.match(model.diagnostics.report, /Needs setup: 0/u);
    assert.doesNotMatch(model.diagnostics.report, /\/inputs/u);

    assert.deepEqual(ViewModel.workloadServiceStatus({available: false}), {
        status: "Unavailable", tone: "unavailable", detail: "Runtime controls are unavailable",
    });
    assert.equal(ViewModel.workloadServiceStatus({}).status, "Unknown");
});

test("workflow activity ignores idle state and labels every terminal branch", () => {
    assert.equal(ViewModel.workflowActivity("x", "X", workflow()), null);
    assert.equal(ViewModel.workflowActivity("x", "X", workflow({phase: "running"})).kind, "running");
    assert.equal(ViewModel.workflowActivity("x", "X", workflow({phase: "preview"})).status, "Review");
    assert.equal(ViewModel.workflowActivity("x", "X", workflow({phase: "complete"})).status, "Finished");
    assert.equal(ViewModel.workflowActivity("x", "X", workflow({phase: "error"})).status, "Failed");
    assert.equal(ViewModel.workflowActivity("x", "X", null), null);
});
