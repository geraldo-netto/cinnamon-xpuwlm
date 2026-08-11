"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const Domain = require("../../files/cinnamon-xpuwlm@geraldo-netto/lib/domain.js");
const BuiltIns = require("../helpers/built-in-workloads.js");
const Menu = require("../../files/cinnamon-xpuwlm@geraldo-netto/lib/menu-view.js");
const ViewModel = require("../../files/cinnamon-xpuwlm@geraldo-netto/lib/view-model.js");
const {
    FakeMenu,
    createAtk,
    createClutter,
    createSt,
    findActors,
} = require("../helpers/fakes.js");

const NOW = 1_700_000_000_000;

function alert(id, severity, resolved = false) {
    return {
        id,
        profileId: "hardware-health",
        title: `Alert ${id}`,
        summary: "",
        severity,
        timestamp: NOW,
        confidence: null,
        riskScore: null,
        resolved,
    };
}

function state(alerts, overrides = {}) {
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
        metrics: {queueDepth: 0, runningProfiles: 1},
        alerts,
        attentionCount: alerts.filter((candidate) => !candidate.resolved).length,
        stale: false,
        source: "runtime",
        generatedAt: NOW,
        ...overrides,
    };
}

function renderedTexts(alerts) {
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
        Clutter: createClutter(),
        Atk: createAtk(),
        menu,
        actions,
    });
    view.render(ViewModel.toViewModel(state(alerts), NOW));
    return findActors(menu.actors[0], (actor) => typeof actor.text === "string")
        .map((actor) => actor.text);
}

test("regression: the highest active severity wins regardless of arrival order", () => {
    assert.equal(ViewModel.highestActiveSeverity([]), null);
    assert.equal(
        ViewModel.highestActiveSeverity([alert("a", "advisory"), alert("b", "critical")]),
        "critical",
    );
    assert.equal(
        ViewModel.highestActiveSeverity([alert("a", "critical"), alert("b", "advisory")]),
        "critical",
    );
    assert.equal(
        ViewModel.highestActiveSeverity([alert("a", "advisory"), alert("b", "warning")]),
        "warning",
    );
    assert.equal(ViewModel.severityText(null), "none");
    assert.equal(ViewModel.severityText(undefined), "none");
    assert.equal(ViewModel.severityText("future"), "none");
    assert.deepEqual(ViewModel.SEVERITY_LABELS, {
        advisory: "advisory",
        warning: "warning",
        critical: "critical",
    });
});

test("regression: resolved and unknown alerts cannot raise the reported severity", () => {
    assert.equal(
        ViewModel.highestActiveSeverity([alert("a", "advisory"), alert("b", "critical", true)]),
        "advisory",
    );
    assert.equal(ViewModel.highestActiveSeverity([alert("a", "critical", true)]), null);
    assert.equal(
        ViewModel.highestActiveSeverity([alert("a", "warning"), alert("b", "catastrophic")]),
        "warning",
    );
});

test("regression: the panel states severity in text, not only in colour", () => {
    const critical = ViewModel.panelModel(state([alert("a", "warning"), alert("b", "critical")]));
    assert.equal(critical.status, "attention");
    assert.equal(critical.severity, "critical");
    assert.equal(critical.label, "TPU 42% · critical");
    assert.match(critical.accessibleName, /highest severity critical/u);
    assert.match(critical.tooltip, /2 items need review, highest severity critical/u);

    const advisory = ViewModel.panelModel(state([alert("a", "advisory")]));
    assert.equal(advisory.severity, "advisory");
    assert.match(advisory.accessibleName, /1 item needs review, highest severity advisory/u);

    const clear = ViewModel.panelModel(state([]));
    assert.equal(clear.status, "online");
    assert.equal(clear.severity, null);
    assert.equal(clear.label, "TPU 42%");
});

test("regression: the popup summary repeats the severity as text", () => {
    const model = ViewModel.toViewModel(state([alert("a", "warning"), alert("b", "critical")]), NOW);
    assert.equal(model.highestSeverity, "critical");
    assert.equal(model.highestSeverityText, "critical");
    assert.equal(model.metrics.at(-1).suffix, "items · critical");

    const texts = renderedTexts([alert("a", "warning"), alert("b", "critical")]);
    assert.equal(
        texts.includes("2 active · highest severity critical · no automatic action"),
        true,
    );
    assert.equal(texts.includes("2 items · critical"), true);
});

test("regression: a cleared alert list reports no severity anywhere", () => {
    const model = ViewModel.toViewModel(state([alert("a", "critical", true)]), NOW);
    assert.equal(model.highestSeverity, null);
    assert.equal(model.highestSeverityText, "none");
    assert.equal(model.metrics.at(-1).suffix, "items");
    assert.equal(renderedTexts([]).includes("No active alerts"), true);
});
