"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const Domain = require("../../files/cinnamon-tpuwm@geraldo-netto/lib/domain.js");
const BuiltIns = require("../helpers/built-in-workloads.js");
const Manager = require("../../files/cinnamon-tpuwm@geraldo-netto/lib/manager.js");
const Menu = require("../../files/cinnamon-tpuwm@geraldo-netto/lib/menu-view.js");
const ViewModel = require("../../files/cinnamon-tpuwm@geraldo-netto/lib/view-model.js");
const {
    FakeButton,
    FakeMenu,
    createSt,
    findActors,
} = require("../helpers/fakes.js");

const NOW = 1_700_000_000_000;

function generator(seed) {
    let state = seed >>> 0;
    return () => {
        state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
        return state / 0x1_0000_0000;
    };
}

test("fuzz: pause control follows policy across effective-screen transitions", () => {
    const random = generator(0x50415553);
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
    ].map((name) => [name, () => calls.push(name)]));
    const menu = new FakeMenu();
    const view = new Menu.MenuView({
        St: createSt(),
        Clutter: {ActorAlign: {CENTER: "center"}},
        Atk: {Role: {PUSH_BUTTON: "push-button"}},
        menu,
        actions,
    });
    const tabs = [...Manager.TABS, "invalid"];
    const profiles = new Domain.WorkloadPortfolio(null, BuiltIns.coreCatalog()).list({});

    for (let index = 0; index < 1000; index += 1) {
        const paused = random() < 0.5;
        const available = random() < 0.5;
        const selectedTab = tabs[Math.floor(random() * tabs.length)];
        const model = ViewModel.toViewModel({
            selectedTab,
            paused,
            profiles,
            device: {
                available,
                name: available ? "Coral" : "No TPU",
                kind: available ? "usb" : "unknown",
                reason: available ? "" : "Disconnected",
            },
            metrics: {load: available ? 42 : null, queueDepth: 0, runningProfiles: 0},
            alerts: [],
            attentionCount: 0,
            stale: false,
            source: available ? "runtime" : "fallback",
            generatedAt: NOW,
        }, NOW);

        const expectedAction = paused ? "resumeAll" : "pauseAll";
        const expectedName = paused ? "Resume all workloads" : "Pause all workloads";
        assert.equal(model.policyPaused, paused);
        assert.equal(model.screen, available
            ? (paused ? "paused" : Manager.sanitizeTab(selectedTab))
            : "unavailable");
        view.render(model);
        const control = findActors(menu.actors[0], (actor) => (
            actor instanceof FakeButton && actor.accessibleName === expectedName
        ))[0];
        assert.ok(control);
        control.click();
        assert.equal(calls.at(-1), expectedAction);
    }
});
