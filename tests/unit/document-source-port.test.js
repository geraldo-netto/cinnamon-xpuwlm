"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const Port = require("../../files/cinnamon-xpuwlm@geraldo-netto/lib/document-source-port.js");
const EventSourcePort = require("../../files/cinnamon-xpuwlm@geraldo-netto/lib/event-source-port.js");

class Filter {
    constructor() { this.patterns = []; this.name = ""; }
    set_name(name) { this.name = name; }
    add_pattern(pattern) { this.patterns.push(pattern); }
}

class Dialog {
    constructor(options) {
        this.options = options;
        this.buttons = [];
        this.filters = [];
        this.handlers = {};
        this.paths = [];
        this.destroyed = false;
        this.nativeWindow = {
            set_type_hint: (value) => { this.nativeTypeHint = value; },
            set_skip_taskbar_hint: (value) => { this.nativeSkipTaskbar = value; },
            set_skip_pager_hint: (value) => { this.nativeSkipPager = value; },
        };
    }
    add_button(label, response) { this.buttons.push([label, response]); }
    set_select_multiple(value) { this.multiple = value; }
    add_filter(filter) { this.filters.push(filter); }
    connect(name, callback) { this.handlers[name] = callback; return 23; }
    disconnect(signalId) { this.disconnected = signalId; delete this.handlers.response; }
    realize() { this.realized = true; }
    get_window() { return this.nativeWindow; }
    show_all() {
        assert.equal(this.realized, true);
        assert.equal(this.nativeTypeHint, 5);
        assert.equal(this.nativeSkipTaskbar, true);
        assert.equal(this.nativeSkipPager, true);
        this.shown = true;
    }
    present() { this.presented = true; }
    set_modal(value) { this.modal = value; }
    set_skip_taskbar_hint(value) { this.skipTaskbar = value; }
    set_skip_pager_hint(value) { this.skipPager = value; }
    hide() { this.hidden = true; }
    get_filenames() { return this.paths; }
    destroy() { this.destroyed = true; }
}

function lifecycle(env) {
    return new EventSourcePort.GtkChooserLifecycle(env, {
        schedule(_delayMs, callback) { callback(); return 1; },
        cancel() { return true; },
    });
}

function environment() {
    const dialogs = [];
    const infos = new Map();
    const Gtk = {
        FileFilter: Filter,
        FileChooserDialog: class extends Dialog {
            constructor(options) { super(options); dialogs.push(this); }
        },
        FileChooserAction: {OPEN: 1},
        ResponseType: {CANCEL: 0, ACCEPT: 1, OK: 2},
    };
    const Gio = {
        FileType: {REGULAR: 1, SYMBOLIC_LINK: 2},
        FileQueryInfoFlags: {NOFOLLOW_SYMLINKS: 1},
        File: {new_for_path(path) {
            return {
                get_path: () => path,
                get_basename: () => path.split("/").at(-1),
                query_info() {
                    const item = infos.get(path);
                    return {
                        get_file_type: () => item.type,
                        get_name: () => item.name,
                        get_size: () => item.size,
                    };
                },
            };
        }},
    };
    return {Gtk, Gdk: {WindowTypeHint: {UTILITY: 5}}, Gio, ByteArray: {}, dialogs, infos};
}

test("document filter matches only the explicit supported document surface", () => {
    const env = environment();
    const filter = Port.documentFilter(env.Gtk);
    assert.equal(filter.name, "Documents and images");
    assert.ok(filter.patterns.includes("*.pdf"));
    assert.ok(filter.patterns.includes("*.PDF"));
    assert.equal(filter.patterns.includes("*.ics"), false);
});

test("GTK document picker opens only on invocation and returns described files", () => {
    const env = environment();
    env.infos.set("/private/guide.pdf", {type: 1, name: "guide.pdf", size: 42});
    const picker = Port.createGtkDocumentPicker(env, lifecycle(env));
    assert.equal(env.dialogs.length, 0);
    let reply = null;
    picker.chooseFiles((error, sources) => { reply = {error, sources}; });
    const dialog = env.dialogs[0];
    assert.equal(dialog.options.title, "Choose documents to ask");
    assert.equal(dialog.multiple, true);
    assert.equal(dialog.shown, true);
    assert.equal(dialog.presented, true);
    assert.equal(dialog.modal, true);
    dialog.paths = ["/private/guide.pdf"];
    dialog.handlers.response(dialog, env.Gtk.ResponseType.ACCEPT);
    assert.deepEqual(reply, {
        error: null,
        sources: [{
            path: "/private/guide.pdf", name: "guide.pdf", size: 42,
            regular: true, symlink: false,
        }],
    });
    assert.equal(dialog.destroyed, true);
    assert.equal(dialog.hidden, true);
    assert.equal(dialog.disconnected, 23);
});

test("document picker reports cancellation without retaining a recent selection", () => {
    const env = environment();
    const picker = Port.createGtkDocumentPicker(env, lifecycle(env));
    let reply = null;
    picker.chooseFiles((error, sources) => { reply = {error, sources}; });
    const dialog = env.dialogs[0];
    dialog.handlers.response(dialog, env.Gtk.ResponseType.CANCEL);
    assert.deepEqual(reply, {error: null, sources: []});
});

test("external document picker delegates isolated selection then describes files", () => {
    const env = environment();
    env.infos.set("/private/guide.pdf", {type: 1, name: "guide.pdf", size: 42});
    let request = null;
    const externalLifecycle = {
        choose(options, callback) { request = {options, callback}; return true; },
        dispose() { return true; },
    };
    const picker = Port.createExternalDocumentPicker(env, externalLifecycle);
    let reply = null;
    assert.equal(picker.chooseFiles((error, sources) => { reply = {error, sources}; }), true);
    assert.equal(request.options.mode, "open");
    assert.equal(request.options.multiple, true);
    assert.equal(request.options.title, "Choose documents to ask");
    assert.ok(request.options.filter.patterns.includes("*.pdf"));
    request.callback(null, ["/private/guide.pdf"]);
    assert.equal(reply.error, null);
    assert.deepEqual(reply.sources.map((source) => source.name), ["guide.pdf"]);
});
