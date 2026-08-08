"use strict";

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

    add(child) {
        this.add_child(child);
    }

    set_child(child) {
        for (const current of this.children) {
            current.parent = null;
        }
        this.children = child ? [child] : [];
        if (child) {
            child.parent = this;
        }
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

    connect(signal, callback) {
        const id = this._nextSignalId;
        this._nextSignalId += 1;
        this._signals.set(id, {signal, callback});
        return id;
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

class FakeLabel extends FakeActor {
    constructor(properties = {}) {
        super(properties);
        this.text = properties.text || "";
        this.clutter_text = {line_wrap: true, ellipsize: 0};
    }

    set_text(text) {
        this.text = text;
    }

    get_text() {
        return this.text;
    }
}

class FakeButton extends FakeActor {
    click() {
        this.emit("clicked");
    }
}

class FakeScrollView extends FakeActor {
    set_policy(horizontal, vertical) {
        this.policy = [horizontal, vertical];
    }

    set_auto_scrolling(enabled) {
        this.autoScrolling = enabled;
    }
}

class FakeMenu {
    constructor() {
        this.actors = [];
        this.toggleCount = 0;
        this.destroyed = false;
    }

    addActor(actor) {
        this.actors.push(actor);
    }

    toggle() {
        this.toggleCount += 1;
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

function createSt() {
    return {
        Align: {START: "start"},
        PolicyType: {NEVER: "never", AUTOMATIC: "automatic"},
        IconType: {SYMBOLIC: "symbolic"},
        BoxLayout: FakeActor,
        Label: FakeLabel,
        Button: FakeButton,
        Icon: FakeActor,
        ScrollView: FakeScrollView,
    };
}

function findActors(root, predicate) {
    const found = [];
    const visit = (actor) => {
        if (predicate(actor)) {
            found.push(actor);
        }
        for (const child of actor.children || []) {
            visit(child);
        }
    };
    visit(root);
    return found;
}

module.exports = {
    FakeActor,
    FakeButton,
    FakeLabel,
    FakeMenu,
    FakeMenuManager,
    FakeScrollView,
    FakeSettings,
    createSt,
    findActors,
};
