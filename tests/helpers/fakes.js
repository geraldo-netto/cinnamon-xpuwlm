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
        this.accessibleStates = new Set();
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

    set_style(style) {
        this.style = style;
    }

    grab_key_focus() {
        this.focused = true;
        this.emit("key-focus-in");
    }

    add_accessible_state(state) {
        this.accessibleStates.add(state);
    }

    remove_accessible_state(state) {
        this.accessibleStates.delete(state);
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

    pressKey(keySymbol) {
        const results = [];
        for (const entry of this._signals.values()) {
            if (entry.signal === "key-press-event") {
                results.push(entry.callback(this, {get_key_symbol: () => keySymbol}));
            }
        }
        return results;
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
        this.signals = new Map();
        this.nextSignalId = 1;
    }

    addActor(actor) {
        this.actors.push(actor);
    }

    connect(signal, callback) {
        const id = this.nextSignalId;
        this.nextSignalId += 1;
        this.signals.set(id, {signal, callback});
        return id;
    }

    emit(signal, ...args) {
        for (const entry of this.signals.values()) {
            if (entry.signal === signal) {
                entry.callback(this, ...args);
            }
        }
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

const GIO_ERRORS = Object.freeze({NOT_FOUND: 1, CANCELLED: 19});

function gioError(code) {
    return {
        matches: (enumeration, candidate) => enumeration === GIO_ERRORS && candidate === code,
    };
}

// A GIO surface with just enough of the real shape to exercise the no-follow
// preflight, the opened-stream identity check, and the bounded byte read.
function createGio(entries = {}) {
    const opened = [];
    const Gio = {
        IOErrorEnum: GIO_ERRORS,
        FileType: {REGULAR: 1, SYMBOLIC_LINK: 3, DIRECTORY: 2, SPECIAL: 4},
        FileQueryInfoFlags: {NONE: 0, NOFOLLOW_SYMLINKS: 1},
        Cancellable: class { cancel() { this.cancelled = true; } },
        opened,
        File: {
            new_for_path(path) {
                const entry = entries[path];
                const info = (identity) => ({
                    get_file_type: () => (entry.type === undefined ? Gio.FileType.REGULAR : entry.type),
                    get_size: () => (entry.size === undefined ? String(entry.contents || "").length : entry.size),
                    get_attribute_uint64: () => identity.inode,
                    get_attribute_uint32: () => identity.device,
                });
                return {
                    query_info_async(attributes, flags, priority, cancellable, callback) {
                        opened.push({path, flags});
                        callback(this, {});
                    },
                    query_info_finish() {
                        if (!entry) {
                            throw gioError(GIO_ERRORS.NOT_FOUND);
                        }
                        if (entry.queryError) {
                            throw entry.queryError;
                        }
                        return info({inode: entry.inode ?? 1, device: entry.device ?? 1});
                    },
                    read_async(priority, cancellable, callback) { callback(this, {}); },
                    read_finish() {
                        if (entry.openError) {
                            throw entry.openError;
                        }
                        return {
                            query_info: () => info({
                                inode: entry.openedInode ?? entry.inode ?? 1,
                                device: entry.openedDevice ?? entry.device ?? 1,
                            }),
                            read_bytes_async(count, priority, cancellable, bytesCallback) {
                                bytesCallback(this, {count});
                            },
                            read_bytes_finish() {
                                if (entry.readError) {
                                    throw entry.readError;
                                }
                                return {get_data: () => String(entry.contents || "")};
                            },
                        };
                    },
                };
            },
        },
    };
    return Gio;
}

function createGioEnvironment(entries = {}) {
    return {
        ByteArray: {toString: (bytes) => String(bytes)},
        GLib: {get_home_dir: () => "/home/tester", PRIORITY_DEFAULT: 0},
        Gio: createGio(entries),
    };
}

// The production reader is asynchronous; these fakes complete synchronously so
// the tests stay deterministic while still exercising the callback contract.
function textReader(value) {
    return (path, options, callback) => {
        const resolved = typeof value === "function" ? value(path, options) : value;
        if (resolved instanceof Error) {
            callback(resolved, null);
            return;
        }
        callback(null, resolved);
    };
}

function readSnapshot(gateway, options = {}) {
    let captured = null;
    gateway.read(options, (snapshot) => { captured = snapshot; });
    return captured;
}

function snapshotGateway(snapshot) {
    return {
        reads: [],
        cancelled: 0,
        read(options, callback) {
            this.reads.push(options);
            callback(typeof snapshot === "function" ? snapshot(options) : snapshot);
            return true;
        },
        cancel() {
            this.cancelled += 1;
            return true;
        },
    };
}

function createClutter() {
    return {
        ActorAlign: {CENTER: "center"},
        EVENT_STOP: true,
        EVENT_PROPAGATE: false,
        KEY_Left: 0xff51,
        KEY_Up: 0xff52,
        KEY_Right: 0xff53,
        KEY_Down: 0xff54,
        KEY_Home: 0xff50,
        KEY_End: 0xff57,
        KEY_Return: 0xff0d,
    };
}

function createAtk() {
    return {
        Role: {
            PUSH_BUTTON: "push-button",
            PAGE_TAB: "page-tab",
            PAGE_TAB_LIST: "page-tab-list",
            TOGGLE_BUTTON: "toggle-button",
        },
        StateType: {
            SELECTED: "selected",
            CHECKED: "checked",
            SENSITIVE: "sensitive",
        },
    };
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
    createAtk,
    createClutter,
    createGio,
    createGioEnvironment,
    createSt,
    findActors,
    gioError,
    readSnapshot,
    snapshotGateway,
    textReader,
};
