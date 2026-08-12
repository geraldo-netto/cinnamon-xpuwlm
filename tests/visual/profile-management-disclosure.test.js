"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const Menu = require("../../files/cinnamon-xpuwlm@geraldo-netto/lib/menu-view.js");
const {
    FakeActor,
    FakeMenu,
    createAtk,
    createSt,
    findActors,
} = require("../helpers/fakes.js");

function viewHarness() {
    const actions = Object.fromEntries([
        "selectTab", "toggleProfile", "changeWeight", "pauseAll", "resumeAll", "refresh",
        "openSettings", "acknowledgeCatalogChanges", "submitJob",
    ].map((name) => [name, () => true]));
    const menu = new FakeMenu();
    const view = new Menu.MenuView({
        St: createSt(),
        Clutter: {ActorAlign: {CENTER: "center"}},
        Atk: createAtk(),
        menu,
        actions,
    });
    view._selectedTab = "profiles";
    view._body = new FakeActor();
    return view;
}

test("visual: Advanced profiles reveals the complete Needs setup group", () => {
    const view = viewHarness();
    const model = {
        blockedGroup: {
            label: "Needs setup (2)",
            summary: "2 profiles cannot run yet",
            collapsedName: "Needs setup, 2 profiles, collapsed",
            expandedName: "Needs setup, 2 profiles, expanded",
        },
        blockedProfiles: [],
    };
    assert.equal(view._renderBlockedProfiles(model), true);
    assert.equal(view._blocked.list.visible, false);

    assert.equal(view._focusBlockedDisclosure(), true);

    const disclosure = view._blocked.disclosure;
    const texts = findActors(disclosure, (actor) => typeof actor.text === "string")
        .map((actor) => actor.text);
    assert.deepEqual(texts, ["▾", "Needs setup (2)", "2 profiles cannot run yet"]);
    assert.equal(view._body.children[0], disclosure);
    assert.equal(view._body.children[1], view._blocked.list);
    assert.equal(view._blocked.list.visible, true);
    assert.equal(disclosure.styleClasses.has("xpuwlm-disclosure-open"), true);
    assert.equal(disclosure.focused, true);
});
