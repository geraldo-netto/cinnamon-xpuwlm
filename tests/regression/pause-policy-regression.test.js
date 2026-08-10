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
    createSt,
    findActors,
} = require("../helpers/fakes.js");

const NOW = 1_700_000_000_000;

test("regression: a paused policy can be resumed while the device is unavailable", () => {
    const calls = [];
    const actions = Object.fromEntries([
        "selectTab",
        "toggleProfile",
        "changeWeight",
        "pauseAll",
        "resumeAll",
        "refresh",
        "openSettings",
        "acknowledgeCatalogChanges",
        "submitJob",
    ].map((name) => [name, () => calls.push(name)]));
    const menu = new FakeMenu();
    const view = new Menu.MenuView({
        St: createSt(),
        Clutter: {ActorAlign: {CENTER: "center"}},
        Atk: {Role: {PUSH_BUTTON: "push-button"}},
        menu,
        actions,
    });
    const model = ViewModel.toViewModel({
        selectedTab: "overview",
        paused: true,
        profiles: new Domain.WorkloadPortfolio(null, BuiltIns.coreCatalog()).list({}),
        device: {available: false, name: "No TPU", kind: "unknown", reason: "Disconnected"},
        metrics: {load: null, queueDepth: 0, runningProfiles: 0},
        alerts: [],
        attentionCount: 0,
        stale: false,
        source: "fallback",
        generatedAt: NOW,
    }, NOW);

    view.render(model);

    assert.equal(model.screen, "unavailable");
    assert.equal(findActors(menu.actors[0], (actor) => actor.text === "Disconnected").length, 1);
    const resume = findActors(menu.actors[0], (actor) => (
        actor instanceof FakeButton && actor.accessibleName === "Resume all workloads"
    ))[0];
    assert.ok(resume);
    resume.click();
    assert.deepEqual(calls, ["resumeAll"]);
});
