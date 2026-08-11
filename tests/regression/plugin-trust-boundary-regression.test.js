"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const Cinnamon = require("../../files/cinnamon-xpuwlm@geraldo-netto/lib/cinnamon-runtime.js");
const Fixtures = require("../helpers/workload-manifest-fixtures.js");

// The declarative plug-in boundary: workload manifests are discovered from the
// filesystem, so their reads must never follow a symlink out of the plug-in
// directory, never block on a special file, and never trust a declared size.

function trustEnvironment(entries) {
    const environment = {
        ByteArray: {toString: (bytes) => String(bytes)},
        GLib: {get_home_dir: () => "/home/tester"},
        Gio: {
            FileQueryInfoFlags: {NONE: 0, NOFOLLOW_SYMLINKS: 1},
            IOErrorEnum: {NOT_FOUND: 1, CANCELLED: 19},
            FileType: {REGULAR: 1, DIRECTORY: 2, SYMBOLIC_LINK: 3, SPECIAL: 4},
            File: {
                new_for_path: (path) => fakeFile(path, entries[path], environment),
            },
        },
    };
    return environment;
}

function fakeFile(path, entry, environment) {
    return {
        query_exists: () => entry !== undefined,
        query_info(_attributes, flags, _cancellable) {
            if (entry === undefined) {
                throw {matches: (enumeration, code) => enumeration === environment.Gio.IOErrorEnum
                    && code === environment.Gio.IOErrorEnum.NOT_FOUND};
            }
            assert.equal(
                flags,
                environment.Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS,
                `Manifest preflight must not follow symlinks: ${path}`,
            );
            return {
                get_file_type: () => entry.type ?? environment.Gio.FileType.REGULAR,
                get_size: () => entry.size ?? String(entry.contents ?? "").length,
                get_attribute_uint64: () => 1,
                get_attribute_uint32: () => 1,
            };
        },
        read() {
            return {
                query_info: () => ({
                    get_file_type: () => entry.type ?? environment.Gio.FileType.REGULAR,
                    get_size: () => 0,
                    get_attribute_uint64: () => 1,
                    get_attribute_uint32: () => 1,
                }),
                read_bytes: (() => {
                    let consumed = false;
                    return (count) => {
                        const text = consumed ? "" : String(entry.contents ?? "").slice(0, count);
                        consumed = true;
                        return {get_data: () => text};
                    };
                })(),
                close() {},
            };
        },
        enumerate_children() {
            const names = Object.keys(entries)
                .filter((candidate) => candidate.startsWith(`${path}/`))
                .map((candidate) => candidate.slice(path.length + 1).split("/")[0]);
            const unique = [...new Set(names)];
            let index = 0;
            return {
                next_file: () => {
                    if (index >= unique.length) {
                        return null;
                    }
                    const name = unique[index];
                    index += 1;
                    return {
                        get_name: () => name,
                        get_file_type: () => environment.Gio.FileType.DIRECTORY,
                    };
                },
                close() {},
            };
        },
    };
}

let entries = {};

function registryFor(map) {
    entries = map;
    return Cinnamon.createWorkloadRegistry("/plugins", trustEnvironment(entries));
}

test("regression: a symlinked plug-in manifest is rejected instead of followed", () => {
    const registry = registryFor({
        "/plugins": {},
        "/plugins/evil-workload/manifest.json": {
            contents: JSON.stringify(Fixtures.validWorkloadManifest({id: "evil-workload"})),
            type: 3,
        },
    });
    assert.throws(() => registry.descriptors(), /regular file/u);
});

test("regression: a special-file plug-in manifest fails loudly instead of blocking", () => {
    const registry = registryFor({
        "/plugins": {},
        "/plugins/fifo-workload/manifest.json": {contents: "", type: 4},
    });
    assert.throws(() => registry.descriptors(), /regular file/u);
});

test("regression: a manifest larger than its declared size is still bounded", () => {
    const oversize = JSON.stringify(Fixtures.validWorkloadManifest({id: "large-workload"}))
        .padEnd(64 * 1024 + 1, " ");
    const registry = registryFor({
        "/plugins": {},
        "/plugins/large-workload/manifest.json": {contents: oversize, size: 10},
    });
    assert.throws(() => registry.descriptors(), /maximum size/u);
});

test("regression: a missing manifest in a plug-in directory is reported as missing", () => {
    const registry = registryFor({
        "/plugins": {},
        "/plugins/empty-workload/other.json": {contents: "{}"},
    });
    assert.throws(() => registry.descriptors(), /missing/u);
});

test("regression: valid plug-in manifests still load through the hardened reader", () => {
    const manifest = Fixtures.validWorkloadManifest({id: "good-workload"});
    const registry = registryFor({
        "/plugins": {},
        "/plugins/good-workload/manifest.json": {contents: JSON.stringify(manifest)},
    });
    assert.deepEqual(registry.descriptors().map((descriptor) => descriptor.id), ["good-workload"]);
});
