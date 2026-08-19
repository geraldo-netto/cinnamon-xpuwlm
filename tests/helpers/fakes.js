"use strict";

// The desktop the applet's tests build it against.
//
// Only what the applet actually touches: an actor with style classes and an
// accessible name, the popup menu and its manager, and Cinnamon's settings
// binding. This helper used to carry entry, button and scroll-view actors, a
// keyboard symbol table and a whole GIO stream double — the scaffolding of the
// GJS screens and the reader that moved to the Python client. A fake for a
// surface nothing builds is a fake nobody can see is dead.

class FakeActor {
    constructor(properties = {}) {
        Object.assign(this, properties);
        this.children = [];
        this.styleClasses = new Set(String(properties.style_class || "").split(/\s+/).filter(Boolean));
        this.visible = properties.visible !== false;
        this.destroyed = false;
        this.accessibleName = "";
        this.accessibleRole = null;
        this._signals = new Map();
        this._nextSignalId = 1;
    }

    add_child(child) {
        child.parent = this;
        this.children.push(child);
    }

    add_actor(child) {
        this.add_child(child);
    }

    get_children() {
        return this.children.slice();
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

    connect(signal, callback) {
        const id = this._nextSignalId;
        this._nextSignalId += 1;
        this._signals.set(id, {signal, callback});
        return id;
    }

    disconnect(id) {
        this._signals.delete(id);
    }

    emit(signal, ...args) {
        for (const entry of this._signals.values()) {
            if (entry.signal === signal) {
                entry.callback(this, ...args);
            }
        }
    }

    destroy() {
        this.destroyed = true;
        for (const child of this.children.slice()) {
            child.destroy();
        }
        this.children = [];
        this._signals.clear();
        if (this.parent) {
            this.parent.children = this.parent.children.filter((child) => child !== this);
            this.parent = null;
        }
    }
}

class FakeMenu {
    constructor() {
        this.actors = [];
        this.toggleCount = 0;
        this.closeCount = 0;
        this.openCount = 0;
        this.isOpen = false;
        this.destroyed = false;
    }

    addActor(actor) {
        this.actors.push(actor);
    }

    toggle() {
        this.toggleCount += 1;
        this.isOpen = !this.isOpen;
    }

    close() {
        this.closeCount += 1;
        this.isOpen = false;
    }

    open() {
        this.openCount += 1;
        this.isOpen = true;
    }

    destroy() {
        this.destroyed = true;
        for (const actor of this.actors) {
            actor.destroy();
        }
        this.actors = [];
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

    getValue(key) {
        return structuredClone(this.values[key]);
    }

    setValue(key, value) {
        this.values[key] = structuredClone(value);
        const binding = this.bindings.get(key);
        if (binding) {
            this.owner[binding.property] = structuredClone(value);
            binding.callback();
        }
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
