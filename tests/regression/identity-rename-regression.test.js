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
            get_user_config_dir: () => "/home/user/.config",
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
        "refresh-interval": 1,
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

test("regression: the former two-second default remains an explicit user choice", () => {
    const legacyPath = "/home/user/legacy-settings.json";
    const environment = environmentOf({
        [legacyPath]: JSON.stringify({
            "refresh-interval": {value: 17},
        }),
    });
    const settings = settingsOf({"refresh-interval": 2});

    assert.equal(Cinnamon.migrateLegacyAppletSettings(settings, environment, legacyPath), false);
    assert.equal(settings.values["refresh-interval"], 2);
    assert.deepEqual(settings.writes, [["identity-migration-version", 1]]);
});

test("regression: Cinnamon schema upgrades preserve the inclusive scale maximum", () => {
    const uuid = "cinnamon-xpuwlm@geraldo-netto";
    const settingsInstanceId = uuid;
    const currentPath = `/home/user/.config/cinnamon/spices/${uuid}/${uuid}.json`;
    const environment = environmentOf({
        [currentPath]: JSON.stringify({
            "refresh-interval": {value: 60},
        }),
    });
    const snapshot = Cinnamon.readCurrentIdentitySettings(uuid, settingsInstanceId, environment);
    const settings = settingsOf({"refresh-interval": 1});

    assert.equal(Cinnamon.currentAppletSettingsPath(uuid, settingsInstanceId, environment), currentPath);
    assert.deepEqual(snapshot, {"refresh-interval": 60});
    assert.equal(Cinnamon.restoreCurrentRefreshInterval(settings, snapshot), true);
    assert.equal(settings.values["refresh-interval"], 60);
    assert.deepEqual(settings.writes, [["refresh-interval", 60]]);
    assert.equal(Cinnamon.restoreCurrentRefreshInterval(settings, snapshot), false);
});

test("regression: Cinnamon schema upgrades preserve legacy instance settings", () => {
    const uuid = "cinnamon-xpuwlm@geraldo-netto";
    const settingsInstanceId = uuid;
    const modernPath = `/home/user/.config/cinnamon/spices/${uuid}/${uuid}.json`;
    const legacyPath = `/home/user/.cinnamon/configs/${uuid}/${uuid}.json`;
    const legacy = JSON.stringify({"refresh-interval": {value: 60}});

    const legacyEnvironment = environmentOf({[legacyPath]: legacy});
    assert.equal(
        Cinnamon.currentAppletSettingsPath(uuid, settingsInstanceId, legacyEnvironment),
        legacyPath,
    );
    assert.deepEqual(
        Cinnamon.readCurrentIdentitySettings(uuid, settingsInstanceId, legacyEnvironment),
        {"refresh-interval": 60},
    );

    const modern = JSON.stringify({"refresh-interval": {value: 17}});
    const bothEnvironment = environmentOf({[legacyPath]: legacy, [modernPath]: modern});
    assert.equal(
        Cinnamon.currentAppletSettingsPath(uuid, settingsInstanceId, bothEnvironment),
        modernPath,
    );
    assert.deepEqual(
        Cinnamon.readCurrentIdentitySettings(uuid, settingsInstanceId, bothEnvironment),
        {"refresh-interval": 17},
    );
});

test("regression: current-settings recovery rejects unsafe paths and values", () => {
    const environment = environmentOf();
    for (const uuid of [null, "", "bad/path", "bad\\path", "bad\0id"]) {
        assert.equal(Cinnamon.currentAppletSettingsPath(uuid, 8, environment), null);
        assert.deepEqual(Cinnamon.readCurrentIdentitySettings(uuid, 8, environment), {});
    }
    for (const instanceId of [null, -1, 1.5, "", "bad/path", "bad\\path", "bad\0id"]) {
        assert.equal(Cinnamon.currentAppletSettingsPath("safe@id", instanceId, environment), null);
        assert.deepEqual(Cinnamon.readCurrentIdentitySettings("safe@id", instanceId, environment), {});
    }
    const settings = settingsOf();
    for (const value of [undefined, null, true, "60", 0, 61, 1.5]) {
        assert.equal(Cinnamon.restoreCurrentRefreshInterval(
            settings,
            {"refresh-interval": value},
        ), false);
    }
    assert.deepEqual(settings.writes, []);
});

test("regression: numeric Cinnamon instance zero resolves to its settings file", () => {
    const environment = environmentOf();
    assert.equal(
        Cinnamon.currentAppletSettingsPath("safe@id", 0, environment),
        "/home/user/.config/cinnamon/spices/safe@id/0.json",
    );
});

test("regression: current settings require the complete Cinnamon file API", () => {
    const home = {get_home_dir: () => "/home/user"};
    const file = {File: {new_for_path: () => ({query_exists: () => false})}};
    for (const environment of [
        null,
        {},
        {GLib: home},
        {Gio: file},
        {GLib: {}, Gio: file},
        {GLib: {get_home_dir: "/home/user"}, Gio: file},
        {GLib: home, Gio: {}},
        {GLib: home, Gio: {File: null}},
        {GLib: home, Gio: {File: {}}},
        {GLib: home, Gio: {File: {new_for_path: "/home/user"}}},
    ]) {
        assert.equal(Cinnamon.currentAppletSettingsPath("safe@id", 0, environment), null);
    }
});

test("regression: current-settings recovery tolerates a settings lookup race", () => {
    const environment = environmentOf();
    environment.Gio.File.new_for_path = () => ({
        query_exists() {
            throw new Error("settings file moved");
        },
    });

    assert.equal(Cinnamon.currentAppletSettingsPath("safe@id", 8, environment), null);
    assert.deepEqual(Cinnamon.readCurrentIdentitySettings("safe@id", 8, environment), {});
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
