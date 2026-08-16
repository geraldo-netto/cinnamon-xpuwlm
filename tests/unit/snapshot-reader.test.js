"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const Reader = require("../../files/cinnamon-xpuwlm@geraldo-netto/lib/snapshot-reader.js");

const NOW = 1_700_000_000_000;

function document(overrides = {}) {
    return {
        version: 1,
        generatedAt: NOW,
        devices: [{
            id: "gpu-renderD128",
            backend: "gpu",
            available: true,
            name: "AMD GPU",
            kind: "dri",
            vendor: "AMD",
            load: 42,
            reason: "",
        }],
        metrics: {queueDepth: 3, runningProfiles: 1},
        profiles: {},
        alerts: [],
        ...overrides,
    };
}

function environment({contents = null, throws = null} = {}) {
    return {
        GLib: {get_home_dir: () => "/home/tester"},
        Gio: {
            IOErrorEnum: {NOT_FOUND: 1},
            File: {
                new_for_path: (target) => ({
                    path: target,
                    load_contents() {
                        if (throws) {
                            throw throws;
                        }
                        return [true, Buffer.from(contents)];
                    },
                }),
            },
        },
        decode: (buffer) => buffer.toString("utf8"),
    };
}

test("a published snapshot yields exactly the fields the panel draws", () => {
    const state = Reader.readSnapshot(
        environment({contents: JSON.stringify(document())}),
        "~/state.json",
        NOW,
    );

    assert.equal(state.runtime, "connected");
    assert.equal(state.available, true);
    assert.equal(state.backend, "gpu");
    assert.equal(state.queued, 3);
    assert.equal(state.running, 1);
    assert.equal(state.attention, 0);
});

test("home-relative paths resolve against the session's home directory", () => {
    assert.equal(
        Reader.expandHome(environment(), "~/state.json"),
        "/home/tester/state.json",
    );
    assert.equal(Reader.expandHome(environment(), "/tmp/x.json"), "/tmp/x.json");
});

test("a snapshot nobody has republished is stale, not current", () => {
    const state = Reader.stateFromDocument(document(), NOW + Reader.STALE_AFTER_MS + 1);

    assert.equal(state.runtime, "stale");
    assert.equal(state.available, false);
});

test("a missing file is the runtime not running, not a failure to report", () => {
    const missing = Object.assign(new Error("gone"), {code: 1});
    const state = Reader.readSnapshot(environment({throws: missing}), "~/state.json", NOW);

    assert.equal(state.runtime, "absent");
    assert.equal(state.detail, "The runtime is not running");
});

test("an unreadable file is named as unreadable rather than as absent", () => {
    const denied = Object.assign(new Error("denied"), {code: 14});
    const state = Reader.readSnapshot(environment({throws: denied}), "~/state.json", NOW);

    assert.equal(state.runtime, "unreadable");
});

test("a document that is not JSON, or not an object, is malformed", () => {
    assert.equal(
        Reader.readSnapshot(environment({contents: "{nope"}), "~/x.json", NOW).runtime,
        "malformed",
    );
    assert.equal(Reader.stateFromDocument("scalar", NOW).runtime, "malformed");
    assert.equal(Reader.stateFromDocument([], NOW).runtime, "malformed");
});

test("the device the panel speaks for follows the runtime's backend order", () => {
    const devices = [
        {backend: "gpu", available: true, load: 10},
        {backend: "tpu", available: true, load: 90},
        {backend: "npu", available: true, load: 50},
    ];

    assert.equal(Reader.primaryDevice(devices).backend, "tpu");
    assert.deepEqual([...Reader.BACKEND_ORDER], ["tpu", "npu", "gpu"]);
});

test("an unavailable device is still reported rather than hidden", () => {
    const state = Reader.stateFromDocument(document({
        devices: [{backend: "gpu", available: false, load: null, reason: "no driver"}],
    }), NOW);

    assert.equal(state.available, false);
    assert.equal(state.reason, "no driver");
});

test("the device's busy percentage is not read at all", () => {
    // The panel is not a load meter: the client's Health page keeps a minute
    // of samples and shows the percentile, which is the honest form of it.
    const state = Reader.stateFromDocument(document(), NOW);

    assert.equal(Object.hasOwn(state, "load"), false);
});

test("counters outside their bounds are clamped, not trusted", () => {
    const state = Reader.stateFromDocument(document({
        metrics: {queueDepth: -4, runningProfiles: "many"},
    }), NOW);

    assert.equal(state.queued, 0);
    assert.equal(state.running, 0);
});

test("only unresolved alerts count as needing review", () => {
    const state = Reader.stateFromDocument(document({
        alerts: [{id: "a", resolved: false}, {id: "b", resolved: true}, "junk"],
    }), NOW);

    assert.equal(state.attention, 1);
});

test("a device that is not a record contributes nothing rather than throwing", () => {
    assert.deepEqual(Reader.deviceFields(null), {available: false, backend: null, reason: ""});
    assert.deepEqual(Reader.deviceFields({}), {available: false, backend: null, reason: ""});
});

test("a snapshot with no timestamp is read rather than judged stale", () => {
    const state = Reader.stateFromDocument(document({generatedAt: "soon"}), NOW);

    assert.equal(state.runtime, "connected");
    assert.equal(state.generatedAt, null);
});

test("missing devices and metrics degrade to empty rather than to an error", () => {
    const state = Reader.stateFromDocument({version: 1, generatedAt: NOW}, NOW);

    assert.equal(state.runtime, "connected");
    assert.equal(state.available, false);
    assert.equal(state.queued, 0);
    assert.equal(state.attention, 0);
});

test("no available device falls back to the first one published", () => {
    assert.equal(
        Reader.primaryDevice([{backend: "gpu", available: false, id: "first"}]).id,
        "first",
    );
    assert.equal(Reader.primaryDevice([]), null);
    assert.equal(Reader.primaryDevice(["junk"]), null);
});

test("a read the platform reports as unsuccessful is unreadable", () => {
    const failing = {
        GLib: {get_home_dir: () => "/home/tester"},
        Gio: {IOErrorEnum: {NOT_FOUND: 1}, File: {new_for_path: () => ({load_contents: () => [false, null]})}},
        decode: () => "",
    };

    assert.equal(Reader.readSnapshot(failing, "/state.json", NOW).runtime, "unreadable");
});

test("a snapshot larger than the panel reads is refused before parsing", () => {
    const oversized = Buffer.alloc(Reader.MAX_SNAPSHOT_BYTES + 1, "x");
    const huge = {
        GLib: {get_home_dir: () => "/home/tester"},
        Gio: {IOErrorEnum: {NOT_FOUND: 1}, File: {new_for_path: () => ({load_contents: () => [true, oversized]})}},
        decode: (value) => value.toString("utf8"),
    };

    assert.equal(Reader.readSnapshot(huge, "/state.json", NOW).runtime, "malformed");
});
