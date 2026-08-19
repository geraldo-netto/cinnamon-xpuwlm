"use strict";

// The desktop the applet's tests build it against.
//
// Only what the applet actually touches: an actor with style classes and an
// accessible name, the popup menu and its manager, and Cinnamon's settings
// binding. This helper used to carry entry, button and scroll-view actors, a
// keyboard symbol table and a whole GIO stream double — the scaffolding of the
// GJS screens and the reader that moved to the Python client. A fake for a
// surface nothing builds is a fake nobody can see is dead, and that goes for
// members as much as for classes: the actor's signal and child plumbing, the
// menu's actor list, and the settings double's value accessors were all
// unreachable from the one test file that builds any of this.

class FakeActor {
    constructor(properties = {}) {
        Object.assign(this, properties);
        this.styleClasses = new Set(String(properties.style_class || "").split(/\s+/).filter(Boolean));
        this.visible = properties.visible !== false;
        this.accessibleName = "";
        this.accessibleRole = null;
    }

    add_style_class_name(name) {
        this.styleClasses.add(name);
    }

    remove_style_class_name(name) {
        this.styleClasses.delete(name);
    }

    set_accessible_name(name) {
        this.accessibleName = name;
    }

    set_accessible_role(role) {
        this.accessibleRole = role;
    }

    set_style(style) {
        this.style = style;
    }
}

class FakeMenu {
    constructor() {
        this.toggleCount = 0;
        this.closeCount = 0;
        this.isOpen = false;
        this.destroyed = false;
    }

    toggle() {
        this.toggleCount += 1;
        this.isOpen = !this.isOpen;
    }

    close() {
        this.closeCount += 1;
        this.isOpen = false;
    }

    destroy() {
        this.destroyed = true;
    }
}

class FakeMenuManager {
    constructor() {
        this.menus = [];
    }

    addMenu(menu) {
        this.menus.push(menu);
    }

    removeMenu(menu) {
        this.menus = this.menus.filter((candidate) => candidate !== menu);
    }
}

class FakeSettings {
    constructor(owner, values) {
        this.owner = owner;
        this.values = structuredClone(values);
        this.bindings = new Map();
        this.finalized = false;
    }

    bind(key, property, callback) {
        this.owner[property] = this.values[key];
        this.bindings.set(key, {property, callback});
    }

    finalize() {
        this.finalized = true;
    }
}

// The one accessible role the applet sets on its panel actor.
function createAtk() {
    return {Role: {PUSH_BUTTON: "push-button"}};
}

// The one St symbol the applet names, for the icon of its menu item.
function createSt() {
    return {IconType: {SYMBOLIC: "symbolic"}};
}

module.exports = {
    FakeActor,
    FakeMenu,
    FakeMenuManager,
    FakeSettings,
    createAtk,
    createSt,
};
