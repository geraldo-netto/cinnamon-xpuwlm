"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const Cinnamon = require("../../files/cinnamon-tpuwm@geraldo-netto/lib/cinnamon-runtime.js");

function fileEnvironment({contents = null, homeDirectory = "/home/user"} = {}) {
    const written = [];
    const directories = [];
    const state = {contents};
    const environment = {
        GLib: {
            get_home_dir: () => homeDirectory,
            file_get_contents: (path) => [state.contents !== null, state.contents, path][0] === false
                ? [false, null]
                : [true, state.contents],
        },
        ByteArray: {toString: (value) => String(value)},
        Gio: {
            FileCreateFlags: {REPLACE_DESTINATION: 2},
            FileQueryInfoFlags: {NONE: 0},
            File: {
                new_for_path: (path) => ({
                    path,
                    query_exists: () => state.contents !== null,
                    query_info: () => ({get_size: () => String(state.contents ?? "").length}),
                    get_parent: () => ({
                        query_exists: () => directories.length > 0,
                        make_directory_with_parents: () => directories.push(path),
                    }),
                    replace_contents: (text, etag, backup, flags) => {
                        written.push({path, text, flags});
                        state.contents = text;
                    },
                }),
            },
        },
    };
    return {environment, written, directories, state};
}

function legacyOf(payload) {
    return {
        load: () => payload,
        save() { throw new Error("the legacy settings store must never be written"); },
    };
}

test("regression: profile intent is stored in an applet-owned atomically replaced file", () => {
    const {environment, written, directories} = fileEnvironment();
    const repository = new Cinnamon.FileStateRepository({
        path: "~/.config/tpu-workload-manager/applet-state.json",
        environment,
    });
    repository.save({portfolio: {paused: false, profiles: {}}, selectedTab: "overview"});
    assert.equal(directories.length, 1, "the parent directory is created on demand");
    assert.equal(written.length, 1);
    assert.equal(written[0].path, "/home/user/.config/tpu-workload-manager/applet-state.json");
    assert.equal(written[0].flags, environment.Gio.FileCreateFlags.REPLACE_DESTINATION);
    assert.deepEqual(JSON.parse(written[0].text), {
        portfolio: {paused: false, profiles: {}},
        selectedTab: "overview",
    });
});

test("regression: the state file wins over lagging legacy xlet settings", () => {
    const fresh = {portfolio: {paused: false, profiles: {"hardware-health": {enabled: true, weight: 2}}}, selectedTab: "profiles"};
    const {environment} = fileEnvironment({contents: JSON.stringify(fresh)});
    const repository = new Cinnamon.FileStateRepository({
        path: "~/.config/tpu-workload-manager/applet-state.json",
        environment,
        legacy: legacyOf({portfolio: {paused: true, profiles: {}}, selectedTab: "overview"}),
    });
    assert.deepEqual(repository.load(), fresh);
});

test("regression: a missing state file migrates from the legacy settings once", () => {
    const legacyState = {portfolio: {paused: false, profiles: {"visual-library": {enabled: true, weight: 3}}}, selectedTab: "alerts"};
    const {environment} = fileEnvironment();
    const repository = new Cinnamon.FileStateRepository({
        path: "~/.config/tpu-workload-manager/applet-state.json",
        environment,
        legacy: legacyOf(legacyState),
    });
    assert.deepEqual(repository.load(), legacyState);
});

test("regression: malformed or unreadable state files degrade to defaults, never throw", () => {
    for (const contents of ["{nope", "42", "\"text\"", ""]) {
        const {environment} = fileEnvironment({contents});
        const repository = new Cinnamon.FileStateRepository({
            path: "~/.config/tpu-workload-manager/applet-state.json",
            environment,
        });
        const loaded = repository.load();
        assert.deepEqual(
            {portfolio: loaded.portfolio ?? null, selectedTab: loaded.selectedTab ?? null},
            {portfolio: null, selectedTab: null},
            JSON.stringify(contents),
        );
    }
});

test("regression: the repository validates its construction inputs", () => {
    assert.throws(() => new Cinnamon.FileStateRepository({path: "", environment: {}}), /required/u);
    assert.throws(() => new Cinnamon.FileStateRepository({path: "/x", environment: null}), /required/u);
});

test("regression: an oversize state file falls back to the legacy store instead of throwing", () => {
    const {environment} = fileEnvironment({contents: "x".repeat(70 * 1024)});
    const legacyState = {portfolio: {paused: true, profiles: {}}, selectedTab: "overview"};
    const repository = new Cinnamon.FileStateRepository({
        path: "~/.config/tpu-workload-manager/applet-state.json",
        environment,
        legacy: legacyOf(legacyState),
    });
    assert.deepEqual(repository.load(), legacyState);
});
