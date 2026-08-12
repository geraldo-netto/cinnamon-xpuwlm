"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const Cinnamon = require("../../files/cinnamon-xpuwlm@geraldo-netto/lib/cinnamon-runtime.js");

function environmentOf(entries = {}) {
    const contents = new Map(Object.entries(entries));
    return {
        ByteArray: {toString: (value) => String(value)},
        GLib: {
            get_home_dir: () => "/home/user",
            file_get_contents: (path) => contents.has(path)
                ? [true, contents.get(path)]
                : [false, null],
        },
        Gio: {
            FileQueryInfoFlags: {NONE: 0},
            File: {
                new_for_path: (path) => ({
                    query_exists: () => contents.has(path),
                    query_info: () => ({get_size: () => String(contents.get(path) || "").length}),
                }),
            },
        },
    };
}

function settingsOf(overrides = {}) {
    const values = {
        "show-panel-label": false,
        "refresh-interval": 2,
        "runtime-state-path": Cinnamon.RUNTIME_STATE_PATH,
        "identity-migration-version": 0,
        ...overrides,
    };
    const writes = [];
    return {
        values,
        writes,
        getValue: (key) => values[key],
        setValue(key, value) {
            values[key] = value;
            writes.push([key, value]);
        },
    };
}

test("regression: the renamed applet imports bounded legacy settings exactly once", () => {
    const legacyPath = "/home/user/.config/cinnamon/spices/cinnamon-tpuwm@geraldo-netto/cinnamon-tpuwm@geraldo-netto.json";
    const environment = environmentOf({
        [legacyPath]: JSON.stringify({
            "show-panel-label": {value: true},
            "refresh-interval": {value: 17},
            "runtime-state-path": {value: Cinnamon.OLD_RUNTIME_STATE_PATH},
            "profile-state": {value: {paused: true, profiles: {}}},
            injected: {value: "must not migrate"},
        }),
    });
    const settings = settingsOf();

    assert.equal(Cinnamon.migrateLegacyAppletSettings(settings, environment), true);
    assert.equal(settings.values["show-panel-label"], true);
    assert.equal(settings.values["refresh-interval"], 17);
    assert.equal(settings.values["runtime-state-path"], Cinnamon.RUNTIME_STATE_PATH);
    assert.equal(settings.values["profile-state"], undefined);
    assert.equal(settings.values.injected, undefined);
    assert.equal(settings.values["identity-migration-version"], 1);

    const writes = settings.writes.length;
    assert.equal(Cinnamon.migrateLegacyAppletSettings(settings, environment), false);
    assert.equal(settings.writes.length, writes, "the migration marker prevents repeated writes");
});

test("regression: identity migration never overwrites a setting changed under the new UUID", () => {
    const legacyPath = "/home/user/legacy-settings.json";
    const environment = environmentOf({
        [legacyPath]: JSON.stringify({
            "show-panel-label": {value: true},
            "refresh-interval": {value: 17},
            "runtime-state-path": {value: "/srv/legacy-runtime.json"},
        }),
    });
    const settings = settingsOf({
        "refresh-interval": 9,
        "runtime-state-path": "/srv/new-runtime.json",
    });

    assert.equal(Cinnamon.migrateLegacyAppletSettings(settings, environment, legacyPath), true);
    assert.equal(settings.values["show-panel-label"], true);
    assert.equal(settings.values["refresh-interval"], 9);
    assert.equal(settings.values["runtime-state-path"], "/srv/new-runtime.json");
});

test("regression: malformed, missing, and oversize legacy settings fail closed", () => {
    for (const contents of [null, "{broken", "x".repeat(65 * 1024)]) {
        const path = "/home/user/legacy-settings.json";
        const environment = environmentOf(contents === null ? {} : {[path]: contents});
        const settings = settingsOf();
        assert.equal(Cinnamon.migrateLegacyAppletSettings(settings, environment, path), false);
        assert.deepEqual(settings.writes, [["identity-migration-version", 1]]);
    }
});

test("regression: legacy setting projection enforces every type and boundary", () => {
    for (const root of [null, [], "settings", 1]) {
        assert.deepEqual(Cinnamon.migratedIdentitySettings(root), {});
    }
    assert.deepEqual(Cinnamon.migratedIdentitySettings({
        "show-panel-label": null,
        "refresh-interval": [],
        "runtime-state-path": "not a setting record",
    }), {});
    for (const value of [0, 61, 1.5, "2", null]) {
        assert.deepEqual(Cinnamon.migratedIdentitySettings({
            "refresh-interval": {value},
        }), {});
    }
    for (const value of [1, 60]) {
        assert.deepEqual(Cinnamon.migratedIdentitySettings({
            "refresh-interval": {value},
        }), {"refresh-interval": value});
    }
    for (const value of [null, "", " ", "bad\0path", "x".repeat(4097)]) {
        assert.deepEqual(Cinnamon.migratedIdentitySettings({
            "runtime-state-path": {value},
        }), {});
    }
    const longestPath = `/${"x".repeat(4095)}`;
    assert.deepEqual(Cinnamon.migratedIdentitySettings({
        "runtime-state-path": {value: longestPath},
    }), {"runtime-state-path": longestPath});
});

test("regression: the settings migration rejects an incomplete port", () => {
    const environment = environmentOf();
    assert.throws(() => Cinnamon.migrateLegacyAppletSettings(null, environment), /required/u);
    assert.throws(() => Cinnamon.migrateLegacyAppletSettings({}, environment), /required/u);
    assert.throws(() => Cinnamon.migrateLegacyAppletSettings({getValue() {}}, environment), /required/u);
    assert.throws(() => Cinnamon.migrateLegacyAppletSettings({setValue() {}}, environment), /required/u);
});

test("regression: new applet state wins, otherwise the old identity is a read-only fallback", () => {
    const currentPath = "/home/user/.config/xpu-workload-manager/applet-state.json";
    const legacyPath = "/home/user/.config/tpu-workload-manager/applet-state.json";
    const legacyState = {portfolio: {paused: true, profiles: {}}, selectedTab: "alerts"};
    const currentState = {portfolio: {paused: false, profiles: {}}, selectedTab: "profiles"};

    const migrated = new Cinnamon.FileStateRepository({
        path: currentPath,
        legacyPath,
        environment: environmentOf({[legacyPath]: JSON.stringify(legacyState)}),
    });
    assert.deepEqual(migrated.load(), {...legacyState, activityClearedAt: null});

    const current = new Cinnamon.FileStateRepository({
        path: currentPath,
        legacyPath,
        environment: environmentOf({
            [legacyPath]: JSON.stringify(legacyState),
            [currentPath]: JSON.stringify(currentState),
        }),
    });
    assert.deepEqual(current.load(), {...currentState, activityClearedAt: null});
});

test("regression: an absent current state never probes a null legacy path", () => {
    const repository = new Cinnamon.FileStateRepository({
        path: "/home/user/.config/xpu-workload-manager/applet-state.json",
        environment: environmentOf(),
    });
    const reads = [];
    repository._readStateText = (path) => {
        reads.push(path);
        return null;
    };
    assert.deepEqual(repository.load(), {
        portfolio: null, selectedTab: null, activityClearedAt: null,
    });
    assert.deepEqual(reads, ["/home/user/.config/xpu-workload-manager/applet-state.json"]);
});
