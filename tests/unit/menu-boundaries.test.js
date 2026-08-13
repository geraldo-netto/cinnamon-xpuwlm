"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const ROOT = path.resolve(__dirname, "../../files/cinnamon-xpuwlm@geraldo-netto/lib");
const ActorUtils = require(path.join(ROOT, "menu-actor-utils.js"));
const Menu = require(path.join(ROOT, "menu-view.js"));
const MenuFocus = require(path.join(ROOT, "menu-focus.js"));

function actors(...enabled) {
    return enabled.map((value) => ({reactive: value}));
}

test("menu focus navigation wraps among enabled items", () => {
    const items = actors(true, true, true, true);
    assert.equal(MenuFocus.movedFocusableIndex("next", 3, items), 0);
    assert.equal(MenuFocus.movedFocusableIndex("previous", 0, items), 3);
    assert.equal(MenuFocus.movedFocusableIndex("first", 2, items), 0);
    assert.equal(MenuFocus.movedFocusableIndex("last", 1, items), 3);
});

test("menu focus navigation skips disabled items in both directions", () => {
    const items = actors(true, false, false, true, false);
    assert.equal(MenuFocus.movedFocusableIndex("next", 0, items), 3);
    assert.equal(MenuFocus.movedFocusableIndex("next", 3, items), 0);
    assert.equal(MenuFocus.movedFocusableIndex("previous", 3, items), 0);
    assert.equal(MenuFocus.movedFocusableIndex("previous", 0, items), 3);
    assert.equal(MenuFocus.movedFocusableIndex("first", 3, items), 0);
    assert.equal(MenuFocus.movedFocusableIndex("last", 0, items), 3);
    assert.equal(MenuFocus.movedFocusableIndex("unknown", 1, items), 0);
    assert.equal(MenuFocus.movedFocusableIndex("next", -1, items), 3);
    assert.equal(MenuFocus.movedFocusableIndex("previous", 99, items), 3);
    assert.equal(MenuFocus.movedFocusableIndex("next", 0, actors(false, false)), -1);
    assert.equal(MenuFocus.movedFocusableIndex("next", 0, []), -1);
});

test("menu-view preserves focus and actor utility exports", () => {
    for (const name of [
        "focusableControls", "movedFocusableIndex", "movedTabIndex", "tabKeyMove",
    ]) {
        assert.equal(Menu[name], MenuFocus[name], name);
    }
    for (const name of ["destroyChildren", "setStyleClass"]) {
        assert.equal(Menu[name], ActorUtils[name], name);
    }
});

test("menu-view contains no extracted helper bodies", () => {
    const source = fs.readFileSync(path.join(ROOT, "menu-view.js"), "utf8");
    for (const name of [
        "destroyChildren", "focusableControls", "movedTabIndex", "setStyleClass", "tabKeyMove",
    ]) {
        assert.doesNotMatch(source, new RegExp(`^function ${name}\\(`, "mu"), name);
    }
});
