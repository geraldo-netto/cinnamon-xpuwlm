"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const Menu = require("../../files/cinnamon-xpuwlm@geraldo-netto/lib/menu-view.js");
const {FakeMenu, createSt} = require("../helpers/fakes.js");

function actions() {
    const required = [
        "selectTab", "toggleProfile", "changeWeight", "pauseAll", "resumeAll",
        "refresh", "openSettings", "acknowledgeCatalogChanges", "submitJob",
    ];
    return Object.fromEntries(required.map((name) => [name, () => true]));
}

function pseudoRandom(seed) {
    let state = seed >>> 0;
    return () => {
        state = (state * 1664525 + 1013904223) >>> 0;
        return state;
    };
}

test("fuzz: activation bursts dispatch once or cancel cleanly", () => {
    for (let seed = 1; seed <= 200; seed += 1) {
        const random = pseudoRandom(seed);
        const queued = [];
        const cancelled = new Set();
        const menu = new FakeMenu();
        const view = new Menu.MenuView({
            St: createSt(), Clutter: {ActorAlign: {CENTER: "center"}}, menu,
            actions: actions(),
            actionScheduler: {
                schedule(_delayMs, callback) {
                    const handle = queued.length + 1;
                    queued.push({handle, callback});
                    return handle;
                },
                cancel(handle) { cancelled.add(handle); return true; },
            },
        });
        let calls = 0;
        const button = view._button("test", "Test action", () => { calls += 1; });
        view._body.add_child(button);
        const activations = 1 + random() % 50;
        for (let index = 0; index < activations; index += 1) {
            button.click();
        }
        assert.equal(queued.length, 1, `seed ${seed}`);
        const destroyFirst = random() % 2 === 0;
        if (destroyFirst) {
            view.destroy();
        }
        queued[0].callback();
        assert.equal(calls, destroyFirst ? 0 : 1, `seed ${seed}`);
        assert.equal(cancelled.has(queued[0].handle), destroyFirst, `seed ${seed}`);
        if (!destroyFirst) {
            view.destroy();
        }
    }
});
