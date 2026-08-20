"use strict";

/* global print */

const ByteArray = imports.byteArray;
const Gio = imports.gi.Gio;
const GLib = imports.gi.GLib;
const sourceFiles = imports.system.programArgs.map((filename) => (
    GLib.canonicalize_filename(filename, GLib.get_current_dir())
));
const sourceSet = new Set(sourceFiles);
const modules = Object.create(null);

function readSource(filename) {
    const [ok, contents] = GLib.file_get_contents(filename);
    if (!ok) {
        throw new Error(`Unable to read production source: ${filename}`);
    }
    return ByteArray.toString(contents);
}

function compile(filename) {
    return new Function(
        "require",
        "module",
        "exports",
        `${readSource(filename)}\n//# sourceURL=${filename}`,
    );
}

function resolveModule(parentFilename, request) {
    if (!request.startsWith("./") && !request.startsWith("../")) {
        throw new Error(`Production module imports must be relative: ${request}`);
    }
    const parentDirectory = GLib.path_get_dirname(parentFilename);
    const requestedPath = request.endsWith(".js") ? request : `${request}.js`;
    const resolved = GLib.canonicalize_filename(requestedPath, parentDirectory);
    if (!sourceSet.has(resolved)) {
        throw new Error(`Production module was not declared by the smoke command: ${request}`);
    }
    return resolved;
}

function loadModule(filename) {
    if (modules[filename]) {
        return modules[filename].exports;
    }

    const loaded = {exports: {}};
    modules[filename] = loaded;
    const localRequire = (request) => loadModule(resolveModule(filename, request));
    compile(filename)(localRequire, loaded, loaded.exports);
    return loaded.exports;
}

if (sourceFiles.length === 0) {
    throw new Error("At least one production JavaScript file is required");
}

for (const filename of sourceFiles) {
    compile(filename);
}

for (const filename of sourceFiles) {
    if (GLib.path_get_basename(filename) !== "applet.js") {
        loadModule(filename);
    }
}

// Compiling and loading says every module parses and every name in it
// resolves under the engine Cinnamon runs. It says nothing about the one thing
// this payload does with that engine: read the runtime's published snapshot
// through Gio, on a mainloop, and turn the bytes into a state the panel can
// draw. Node's tests drive that path against doubles — a real `Gio.File`, a
// real `load_contents_async` and a real `ByteArray.toString` are only here.
//
// This replaces a smoke for a state *write*, which the helper no longer has:
// the module that owned it left with the GJS product, and the panel reads.
function verifyNativeSnapshotRead() {
    const readerPath = sourceFiles.find((filename) => (
        GLib.path_get_basename(filename) === "snapshot-reader.js"
    ));
    if (!readerPath) {
        throw new Error("snapshot-reader.js is required for the CJS snapshot smoke");
    }
    const SnapshotReader = loadModule(readerPath);
    const directory = GLib.dir_make_tmp("xpuwlm-cjs-snapshot-XXXXXX");
    const snapshotPath = GLib.build_filenamev([directory, "state.json"]);
    const generatedAt = Math.floor(GLib.get_real_time() / 1000);
    GLib.file_set_contents(snapshotPath, JSON.stringify({
        version: SnapshotReader.SNAPSHOT_VERSION,
        generatedAt,
        devices: [{backend: "gpu", available: true, reason: ""}],
        metrics: {queueDepth: 3, runningProfiles: 1},
        alerts: [{resolved: false}],
        policy: {paused: false},
    }));
    const loop = GLib.MainLoop.new(null, false);
    let state = null;
    const asynchronous = SnapshotReader.readSnapshotAsync(
        {ByteArray, Gio, GLib, decode: (contents) => ByteArray.toString(contents)},
        snapshotPath,
        () => generatedAt,
        (delivered) => {
            state = delivered;
            loop.quit();
        },
    );
    if (!asynchronous) {
        throw new Error("CJS snapshot smoke did not use the asynchronous GIO path");
    }
    loop.run();
    try {
        if (!state || state.runtime !== "connected") {
            throw new Error(`CJS snapshot smoke read ${state && state.runtime}: ${state && state.detail}`);
        }
        if (state.backend !== "gpu" || state.queued !== 3 || state.attention !== 1) {
            throw new Error("CJS snapshot smoke did not read the fields the panel draws");
        }
    } finally {
        Gio.File.new_for_path(snapshotPath).delete(null);
        Gio.File.new_for_path(directory).delete(null);
    }
}

verifyNativeSnapshotRead();

print(`CJS production smoke: ${sourceFiles.length} files compiled; ${Object.keys(modules).length} modules loaded`);
