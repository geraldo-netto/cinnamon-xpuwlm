"use strict";

/* global print */

const ByteArray = imports.byteArray;
const GLib = imports.gi.GLib;
const sourceFiles = imports.system.programArgs.map((filename) => (
    GLib.canonicalize_filename(filename, GLib.get_current_dir())
));
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
    return GLib.canonicalize_filename(requestedPath, parentDirectory);
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

print(`CJS production smoke: ${sourceFiles.length} files compiled; ${Object.keys(modules).length} modules loaded`);
