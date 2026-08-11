"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const EventImport = require("../../files/cinnamon-xpuwlm@geraldo-netto/lib/event-import.js");
const Port = require("../../files/cinnamon-xpuwlm@geraldo-netto/lib/event-source-port.js");

function environment(entries = {}) {
    const files = new Map(Object.entries(entries));
    const env = {
        writes: [],
        closed: 0,
        ByteArray: {fromString: (text) => ({text})},
        Gio: {
            FileType: {REGULAR: 1, DIRECTORY: 2, SYMBOLIC_LINK: 3},
            FileQueryInfoFlags: {NOFOLLOW_SYMLINKS: 1},
            FileCreateFlags: {PRIVATE: 1},
        },
    };
    class File {
        constructor(path) { this.path = path; }
        get_path() { return this.path; }
        get_basename() { return this.path.split("/").pop(); }
        get_child(name) { return new File(`${this.path}/${name}`); }
        query_info() {
            const entry = files.get(this.path);
            if (!entry) { throw new Error(`missing ${this.path}`); }
            return info(entry, this.get_basename());
        }
        enumerate_children() {
            const entry = files.get(this.path);
            let index = 0;
            return {
                next_file() {
                    const name = entry.children[index];
                    index += 1;
                    return name === undefined ? null : info(files.get(`${entry.path}/${name}`), name);
                },
                close() { env.closed += 1; },
            };
        }
        create(flags) {
            assert.equal(flags, env.Gio.FileCreateFlags.PRIVATE);
            if (files.has(this.path)) { throw new Error("file exists"); }
            files.set(this.path, {type: env.Gio.FileType.REGULAR, size: 0});
            return {
                write_all(bytes) { env.writes.push({path: this.path, bytes}); },
                close() { env.closed += 1; },
                path: this.path,
            };
        }
    }
    function info(entry, name) {
        return {
            get_name: () => name,
            get_file_type: () => entry.type,
            get_size: () => entry.size || 0,
        };
    }
    env.Gio.File = {new_for_path: (path) => new File(path)};
    env.Gtk = fakeGtk();
    return env;
}

function fakeGtk() {
    const dialogs = [];
    class Dialog {
        constructor(options) {
            this.options = options;
            this.buttons = [];
            this.filenames = [];
            this.filters = [];
            this.signals = {};
            dialogs.push(this);
        }
        add_button(label, response) { this.buttons.push({label, response}); }
        set_select_multiple(value) { this.multiple = value; }
        add_filter(filter) { this.filters.push(filter); }
        set_current_name(name) { this.currentName = name; }
        connect(signal, callback) { this.signals[signal] = callback; }
        show_all() { this.shown = true; }
        destroy() { this.destroyed = true; }
        get_filenames() { return this.filenames; }
        get_filename() { return this.filenames[0]; }
        respond(response) { this.signals.response(this, response); }
    }
    class Filter {
        constructor() { this.patterns = []; }
        set_name(name) { this.name = name; }
        add_pattern(pattern) { this.patterns.push(pattern); }
    }
    return {
        FileChooserAction: {OPEN: 1, SELECT_FOLDER: 2, SAVE: 3},
        ResponseType: {ACCEPT: 1, OK: 2, CANCEL: 3},
        FileChooserDialog: Dialog,
        FileFilter: Filter,
        dialogs,
    };
}

function tree() {
    return environment({
        "/events": {path: "/events", type: 2, children: ["one.txt", "skip.exe", "link.pdf"]},
        "/events/one.txt": {type: 1, size: 10},
        "/events/skip.exe": {type: 1, size: 10},
        "/events/link.pdf": {type: 3, size: 10},
    });
}

test("source descriptions use no-follow type and retain only metadata", () => {
    const env = tree();
    assert.deepEqual(Port.describeSourcePaths(["/events/one.txt"], env), [{
        path: "/events/one.txt", name: "one.txt", size: 10, regular: true, symlink: false,
    }]);
    assert.deepEqual(Port.folderSources("/events", env), [
        {path: "/events/one.txt", name: "one.txt", size: 10, regular: true, symlink: false},
        {path: "/events/link.pdf", name: "link.pdf", size: 10, regular: false, symlink: true},
    ]);
    assert.equal(env.closed, 1);
    assert.throws(() => Port.folderSources("/events/one.txt", env), /directory/u);
    assert.throws(
        () => Port.describeSourcePaths("/events/one.txt", env),
        (error) => error instanceof TypeError && error.message === "Selected event paths must be an array",
    );
    assert.deepEqual(Port.describeSourcePaths([], env), []);
    assert.deepEqual(Port.sourceDescription({
        get_path: () => "/events/fallback.txt",
        get_basename: () => "fallback.txt",
        query_info: () => ({
            get_file_type: () => env.Gio.FileType.REGULAR,
            get_name: () => "",
            get_size: () => 2,
        }),
    }, env).name, "fallback.txt");
});

test("folder enumeration is non-recursive and bounded", () => {
    const entries = {
        "/many": {path: "/many", type: 2, children: []},
    };
    for (let index = 0; index <= EventImport.MAX_SOURCES; index += 1) {
        const name = `${index}.txt`;
        entries["/many"].children.push(name);
        entries[`/many/${name}`] = {type: 1, size: 1};
    }
    const env = environment(entries);
    assert.throws(() => Port.folderSources("/many", env), /more than 32/u);
    assert.equal(env.closed, 1);
});

test("GTK pickers open only when invoked and report accept or cancel once", () => {
    const env = tree();
    const picker = Port.createGtkEventSourcePicker(env);
    assert.equal(env.Gtk.dialogs.length, 0);
    let files = null;
    assert.equal(picker.chooseFiles((error, selected) => { assert.equal(error, null); files = selected; }), true);
    const fileDialog = env.Gtk.dialogs[0];
    assert.equal(fileDialog.multiple, true);
    assert.equal(fileDialog.shown, true);
    assert.deepEqual(fileDialog.options, {title: "Choose event source files", action: env.Gtk.FileChooserAction.OPEN});
    assert.deepEqual(fileDialog.buttons, [
        {label: "Cancel", response: env.Gtk.ResponseType.CANCEL},
        {label: "Choose files", response: env.Gtk.ResponseType.ACCEPT},
    ]);
    assert.equal(fileDialog.filters[0].name, "Documents, calendars, and images");
    assert.deepEqual(fileDialog.filters[0].patterns, EventImport.SOURCE_SUFFIXES.flatMap(
        (suffix) => [`*${suffix}`, `*${suffix.toUpperCase()}`],
    ));
    fileDialog.filenames = ["/events/one.txt"];
    fileDialog.respond(env.Gtk.ResponseType.ACCEPT);
    assert.equal(files[0].name, "one.txt");
    assert.equal(fileDialog.destroyed, true);

    let folder = null;
    assert.equal(picker.chooseFolder((error, selected) => { assert.equal(error, null); folder = selected; }), true);
    const folderDialog = env.Gtk.dialogs[1];
    assert.deepEqual(folderDialog.options, {
        title: "Choose one event source folder", action: env.Gtk.FileChooserAction.SELECT_FOLDER,
    });
    assert.deepEqual(folderDialog.buttons, [
        {label: "Cancel", response: env.Gtk.ResponseType.CANCEL},
        {label: "Choose folder", response: env.Gtk.ResponseType.ACCEPT},
    ]);
    folderDialog.filenames = ["/events"];
    folderDialog.respond(env.Gtk.ResponseType.CANCEL);
    assert.deepEqual(folder, []);

    picker.chooseFolder((error, selected) => { assert.equal(error, null); folder = selected; });
    env.Gtk.dialogs[2].filenames = ["/events"];
    env.Gtk.dialogs[2].respond(env.Gtk.ResponseType.OK);
    assert.deepEqual(folder.map((item) => item.name), ["one.txt", "link.pdf"]);
});

test("export creates a private new file and refuses source replacement", () => {
    const env = tree();
    const exporter = Port.createGtkEventExporter(env);
    let saved = null;
    exporter.saveIcs("BEGIN:VCALENDAR\r\n", ["/events/one.txt"], (error, path) => {
        assert.equal(error, null);
        saved = path;
    });
    const dialog = env.Gtk.dialogs[0];
    assert.deepEqual(dialog.options, {title: "Save confirmed events", action: env.Gtk.FileChooserAction.SAVE});
    assert.deepEqual(dialog.buttons, [
        {label: "Cancel", response: env.Gtk.ResponseType.CANCEL},
        {label: "Save new file", response: env.Gtk.ResponseType.ACCEPT},
    ]);
    assert.equal(dialog.currentName, "confirmed-events.ics");
    dialog.filenames = ["/events/new.ics"];
    dialog.respond(env.Gtk.ResponseType.ACCEPT);
    assert.equal(saved, "/events/new.ics");
    assert.equal(env.writes.length, 1);
    assert.deepEqual(env.writes[0], {
        path: "/events/new.ics", bytes: {text: "BEGIN:VCALENDAR\r\n"},
    });

    let refusal = null;
    exporter.saveIcs("x", ["/events/one.txt"], (error) => { refusal = error; });
    env.Gtk.dialogs[1].filenames = ["/events/one.txt"];
    env.Gtk.dialogs[1].respond(env.Gtk.ResponseType.ACCEPT);
    assert.match(String(refusal), /output must differ/u);

    let cancelled = "pending";
    exporter.saveIcs("x", [], (error, path) => { cancelled = [error, path]; });
    env.Gtk.dialogs[2].respond(env.Gtk.ResponseType.CANCEL);
    assert.deepEqual(cancelled, [null, []]);
});

test("ports validate dependencies and chooser callbacks surface I/O failures", () => {
    for (const candidate of [null, {}, {Gtk: {}}, {Gtk: {}, Gio: {}}, {Gtk: {}, Gio: {}, ByteArray: null}]) {
        assert.throws(
            () => Port.requireEnvironment(candidate),
            (error) => error instanceof TypeError
                && error.message === "GTK, GIO, and ByteArray are required for event file access",
        );
    }
    const env = tree();
    assert.throws(
        () => Port.connectChooser({}, env, null, () => {}),
        (error) => error instanceof TypeError
            && error.message === "Chooser selection and callback functions are required",
    );
    assert.throws(
        () => Port.connectChooser({}, env, () => [], null),
        (error) => error instanceof TypeError
            && error.message === "Chooser selection and callback functions are required",
    );
    let failure = null;
    Port.createGtkEventSourcePicker(env).chooseFiles((error) => { failure = error; });
    env.Gtk.dialogs[0].filenames = ["/missing.txt"];
    env.Gtk.dialogs[0].respond(env.Gtk.ResponseType.ACCEPT);
    assert.match(String(failure), /missing/u);
    assert.equal(Port.responseAccepted(env.Gtk, env.Gtk.ResponseType.OK), true);
    assert.equal(Port.responseAccepted(env.Gtk, env.Gtk.ResponseType.CANCEL), false);
});

test("environment and private writer return and close their exact resources", () => {
    const env = tree();
    assert.equal(Port.requireEnvironment(env), env);
    const closedBefore = env.closed;
    assert.equal(Port.writeNewPrivateFile("/events/new.ics", "calendar", env), "/events/new.ics");
    assert.equal(env.closed, closedBefore + 1);
    assert.deepEqual(env.writes, [{path: "/events/new.ics", bytes: {text: "calendar"}}]);
});
