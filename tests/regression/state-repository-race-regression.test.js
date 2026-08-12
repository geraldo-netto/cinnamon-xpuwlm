"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const Cinnamon = require("../../files/cinnamon-xpuwlm@geraldo-netto/lib/cinnamon-runtime.js");

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

function asyncFileEnvironment({writeError = null, syncError = null} = {}) {
    const writes = [];
    const pending = [];
    const cancellations = [];
    const file = {
        get_parent: () => ({query_exists: () => true}),
        replace_contents_bytes_async(bytes, etag, backup, flags, cancellable, callback) {
            pending.push({text: bytes.data, bytes, etag, backup, flags, cancellable, callback});
        },
        replace_contents_finish() {
            if (writeError !== null) {
                throw writeError;
            }
            writes.push(pending.shift().text);
            return true;
        },
        replace_contents(text) {
            if (syncError !== null) {
                throw syncError;
            }
            writes.push(text);
        },
        query_exists: () => false,
    };
    class Cancellable {
        cancel() { cancellations.push(this); }
    }
    class Bytes {
        constructor(data) { this.data = data; }
    }
    const environment = {
        GLib: {
            get_home_dir: () => "/home/user",
            file_get_contents: () => [false, null],
            Bytes,
        },
        ByteArray: {
            fromString: (value) => String(value),
            toString: (value) => String(value),
        },
        Gio: {
            Cancellable,
            FileCreateFlags: {REPLACE_DESTINATION: 2},
            FileQueryInfoFlags: {NONE: 0},
            File: {new_for_path: () => file},
        },
    };
    const finish = (index = 0) => {
        const item = pending[index];
        item.callback(file, {});
    };
    return {environment, writes, pending, cancellations, finish, Bytes};
}

test("regression: profile intent is stored in an applet-owned atomically replaced file", () => {
    const {environment, written, directories} = fileEnvironment();
    const repository = new Cinnamon.FileStateRepository({
        path: "~/.config/xpu-workload-manager/applet-state.json",
        environment,
    });
    repository.save({portfolio: {paused: false, profiles: {}}, selectedTab: "overview"});
    assert.equal(directories.length, 1, "the parent directory is created on demand");
    assert.equal(written.length, 1);
    assert.equal(written[0].path, "/home/user/.config/xpu-workload-manager/applet-state.json");
    assert.equal(written[0].flags, environment.Gio.FileCreateFlags.REPLACE_DESTINATION);
    assert.deepEqual(JSON.parse(written[0].text), {
        portfolio: {paused: false, profiles: {}},
        selectedTab: "overview",
    });
});

test("regression: interactive state writes serialize and coalesce without blocking", () => {
    const io = asyncFileEnvironment();
    const repository = new Cinnamon.FileStateRepository({path: "/state.json", environment: io.environment});
    const completions = [];
    const state = (selectedTab) => ({portfolio: {paused: false}, selectedTab, activityClearedAt: 0});

    assert.equal(repository.save(state("overview"), (error) => completions.push(["overview", error])), true);
    assert.equal(repository.save(state("alerts"), (error) => completions.push(["alerts", error])), true);
    assert.equal(repository.save(state("profiles"), (error) => completions.push(["profiles", error])), true);
    assert.equal(io.pending.length, 1, "only one filesystem write is in flight");
    assert.equal(io.pending[0].bytes instanceof io.Bytes, true, "GJS receives GLib.Bytes");
    assert.deepEqual(io.writes, []);

    io.finish();
    assert.equal(io.pending.length, 1, "latest coalesced state starts after first completion");
    io.finish();

    assert.deepEqual(io.writes.map((text) => JSON.parse(text).selectedTab), ["overview", "profiles"]);
    assert.deepEqual(completions, [
        ["overview", null], ["alerts", null], ["profiles", null],
    ]);
    assert.equal(repository.flush(), false);
});

test("regression: teardown cancels an old write and flushes the newest state", () => {
    const io = asyncFileEnvironment();
    const repository = new Cinnamon.FileStateRepository({path: "/state.json", environment: io.environment});
    const completions = [];
    repository.save({selectedTab: "overview"}, (error) => completions.push(error));
    repository.save({selectedTab: "setup"}, (error) => completions.push(error));

    assert.equal(repository.flush(), true);
    assert.equal(io.cancellations.length, 1);
    assert.equal(JSON.parse(io.writes[0]).selectedTab, "setup");
    assert.deepEqual(completions, [null, null]);
    assert.doesNotThrow(() => io.finish());
    assert.equal(io.writes.length, 1, "late cancelled completion cannot replace flushed state");
});

test("regression: asynchronous and final state-write failures reach observers", () => {
    const asyncFailure = new Error("async disk failure");
    const asynchronous = asyncFileEnvironment({writeError: asyncFailure});
    const asyncRepository = new Cinnamon.FileStateRepository({
        path: "/state.json", environment: asynchronous.environment,
    });
    const observed = [];
    asyncRepository.save({selectedTab: "alerts"}, (error) => observed.push(error));
    asynchronous.finish();
    assert.deepEqual(observed, [asyncFailure]);

    const syncFailure = new Error("flush disk failure");
    const flushing = asyncFileEnvironment({syncError: syncFailure});
    const flushRepository = new Cinnamon.FileStateRepository({
        path: "/state.json", environment: flushing.environment,
    });
    const flushObserved = [];
    flushRepository.save({selectedTab: "profiles"}, (error) => flushObserved.push(error));
    assert.throws(() => flushRepository.flush(), /flush disk failure/u);
    assert.deepEqual(flushObserved, [syncFailure]);
});

test("regression: state-write setup and observers cannot corrupt the queue", () => {
    const started = asyncFileEnvironment();
    const original = started.environment.Gio.File.new_for_path;
    const file = original();
    file.replace_contents_bytes_async = () => { throw new Error("write could not start"); };
    started.environment.Gio.File.new_for_path = () => file;
    const repository = new Cinnamon.FileStateRepository({
        path: "/state.json", environment: started.environment,
    });
    const observed = [];
    assert.equal(repository.save({selectedTab: "alerts"}, (error) => {
        observed.push(error);
        throw new Error("observer failure");
    }), true);
    assert.match(String(observed[0]), /could not start/u);
    assert.equal(repository._finishWrite({}, null), false);
    assert.equal(repository._settleWrite({settled: true, callbacks: []}, null), false);

    const noCancellable = asyncFileEnvironment();
    delete noCancellable.environment.Gio.Cancellable;
    const pending = new Cinnamon.FileStateRepository({
        path: "/state.json", environment: noCancellable.environment,
    });
    pending.save({selectedTab: "profiles"});
    assert.equal(pending._cancelWrite(pending._activeWrite), false);
    assert.equal(pending._cancelWrite(null), false);
});

test("regression: the state file wins over lagging legacy xlet settings", () => {
    const fresh = {portfolio: {paused: false, profiles: {"hardware-health": {enabled: true, weight: 2}}}, selectedTab: "profiles"};
    const {environment} = fileEnvironment({contents: JSON.stringify(fresh)});
    const repository = new Cinnamon.FileStateRepository({
        path: "~/.config/xpu-workload-manager/applet-state.json",
        environment,
        legacy: legacyOf({portfolio: {paused: true, profiles: {}}, selectedTab: "overview"}),
    });
    assert.deepEqual(repository.load(), {...fresh, activityClearedAt: null});
});

test("regression: a missing state file migrates from the legacy settings once", () => {
    const legacyState = {portfolio: {paused: false, profiles: {"visual-library": {enabled: true, weight: 3}}}, selectedTab: "alerts"};
    const {environment} = fileEnvironment();
    const repository = new Cinnamon.FileStateRepository({
        path: "~/.config/xpu-workload-manager/applet-state.json",
        environment,
        legacy: legacyOf(legacyState),
    });
    assert.deepEqual(repository.load(), legacyState);
});

test("regression: malformed or unreadable state files degrade to defaults, never throw", () => {
    for (const contents of ["{nope", "42", "\"text\"", ""]) {
        const {environment} = fileEnvironment({contents});
        const repository = new Cinnamon.FileStateRepository({
            path: "~/.config/xpu-workload-manager/applet-state.json",
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
        path: "~/.config/xpu-workload-manager/applet-state.json",
        environment,
        legacy: legacyOf(legacyState),
    });
    assert.deepEqual(repository.load(), legacyState);
});
