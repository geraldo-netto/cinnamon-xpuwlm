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

// GJS raises a GError, which knows its own domain. A bare `code` comparison
// does not: the first enumerated value of any other domain is also 1, and a
// permission failure drawn as "the runtime is not running" is the one picture
// this panel exists to tell apart from a real absence.
test("an error from another domain is not read as the runtime being absent", () => {
    const foreign = Object.assign(new Error("markup"), {
        code: 1,
        matches: (domain, code) => domain === "GLib.MarkupError" && code === 1,
    });
    const state = Reader.readSnapshot(environment({throws: foreign}), "~/state.json", NOW);

    assert.equal(state.runtime, "unreadable");
});

test("a GError that names the not-found code in the IO domain is absence", () => {
    const missing = Object.assign(new Error("gone"), {
        matches: (domain, code) => domain !== undefined && code === 1,
    });
    const state = Reader.readSnapshot(environment({throws: missing}), "~/state.json", NOW);

    assert.equal(state.runtime, "absent");
});

test("a platform that publishes no IO error domain reports a failure to read", () => {
    const environmentWithoutErrors = {
        GLib: {get_home_dir: () => "/home/tester"},
        Gio: {File: {new_for_path: () => ({load_contents() { throw new Error("boom"); }})}},
        decode: (value) => String(value),
    };

    assert.equal(
        Reader.readSnapshot(environmentWithoutErrors, "/state.json", NOW).runtime,
        "unreadable",
    );
});

test("an unreadable file is named as unreadable rather than as absent", () => {
    const denied = Object.assign(new Error("denied"), {code: 14});
    const state = Reader.readSnapshot(environment({throws: denied}), "~/state.json", NOW);

    assert.equal(state.runtime, "unreadable");
});

// The panel used to hand the platform's own error to the tooltip for every
// refusal but not-found, so a state file owned by another account read
// "Gio.IOErrorEnum: Error opening file /home/…/state.json: Permission denied"
// where a sentence belongs.
test("the refusals a desk meets are named rather than quoted", () => {
    const platform = (contents = null, throws = null) => ({
        GLib: {get_home_dir: () => "/home/tester"},
        Gio: {
            IOErrorEnum: {NOT_FOUND: 1, IS_DIRECTORY: 21, PERMISSION_DENIED: 14},
            File: {
                new_for_path: () => ({
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
    });
    const gerror = (code) => Object.assign(new Error("platform text"), {
        code,
        matches: (domain, expected) => domain !== undefined && expected === code,
    });

    const denied = Reader.readSnapshot(platform(null, gerror(14)), "~/state.json", NOW);
    assert.equal(denied.runtime, "unreadable");
    assert.equal(denied.detail, "The runtime snapshot cannot be read: permission denied");

    const directory = Reader.readSnapshot(platform(null, gerror(21)), "~/state", NOW);
    assert.equal(directory.runtime, "unreadable");
    assert.equal(directory.detail, "The runtime snapshot path names a directory, not a file");

    // A refusal nobody predicted keeps the platform's own words rather than
    // being renamed into one of these.
    const unexpected = Reader.readSnapshot(platform(null, gerror(30)), "~/state.json", NOW);
    assert.equal(unexpected.runtime, "unreadable");
    assert.match(unexpected.detail, /could not be read: /u);

    // And an IO domain that does not enumerate a code matches nothing through
    // it, rather than matching every error that carries no code of its own.
    assert.equal(
        Reader.matchesCode(
            {Gio: {IOErrorEnum: {NOT_FOUND: 1}}},
            new Error("bare"),
            "PERMISSION_DENIED",
        ),
        false,
    );
    assert.equal(Reader.refusalFor({Gio: {IOErrorEnum: {NOT_FOUND: 1}}}, null), null);
    assert.deepEqual(
        Reader.READ_REFUSALS.map((refusal) => refusal.code),
        ["NOT_FOUND", "PERMISSION_DENIED", "IS_DIRECTORY"],
    );
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

    assert.equal(Reader.primaryDevice(devices).backend, "gpu");
    assert.deepEqual([...Reader.BACKEND_ORDER], ["gpu", "npu", "tpu"]);
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

test("counters outside their bounds are refused, not clamped to zero", () => {
    // Clamping a negative or non-integer count to zero published a figure the
    // runtime never did, in the place the panel draws its busiest fact.
    const state = Reader.stateFromDocument(document({
        metrics: {queueDepth: -4, runningProfiles: "many"},
    }), NOW);

    assert.equal(state.runtime, "malformed");
    assert.equal(state.detail, "The runtime snapshot's metrics.queueDepth is not a count");
    assert.equal(
        Reader.stateFromDocument(
            document({metrics: {queueDepth: 4, runningProfiles: "many"}}),
            NOW,
        ).detail,
        "The runtime snapshot's metrics.runningProfiles is not a count",
    );
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

// This used to read "degrade to empty rather than to an error", and empty is
// the lie: a document with no metrics drew "online, ready" with Queued 0,
// Running 0 and nothing to review, which is what a healthy idle desk looks
// like. Absent is not zero, so a document missing a member the panel draws
// from is refused and the member is named.
test("a document missing the figures the panel draws is refused, and names them", () => {
    const state = Reader.stateFromDocument({version: 1, generatedAt: NOW}, NOW);

    assert.equal(state.runtime, "malformed");
    assert.equal(state.detail, "The runtime snapshot publishes no devices");

    const {metrics, ...metricless} = document();
    assert.equal(metrics.queueDepth, 3);
    assert.equal(
        Reader.stateFromDocument(metricless, NOW).detail,
        "The runtime snapshot publishes no metrics",
    );
    assert.equal(
        Reader.stateFromDocument(document({alerts: undefined}), NOW).detail,
        "The runtime snapshot publishes no alerts",
    );
    assert.equal(
        Reader.stateFromDocument(document({metrics: {runningProfiles: 0}}), NOW).detail,
        "The runtime snapshot publishes no metrics.queueDepth",
    );
});

test("a member the runtime publishes with the wrong type is refused too", () => {
    // The failure this catches is a rename or a retyping on the writer's side,
    // which is silent by construction: a quoted count read as zero draws an
    // empty queue on a busy runtime.
    assert.equal(
        Reader.stateFromDocument(document({devices: {}}), NOW).detail,
        "The runtime snapshot's devices is not an array",
    );
    assert.equal(
        Reader.stateFromDocument(document({metrics: []}), NOW).detail,
        "The runtime snapshot's metrics is not an object",
    );
    assert.equal(
        Reader.stateFromDocument(document({alerts: "none"}), NOW).detail,
        "The runtime snapshot's alerts is not an array",
    );
    assert.equal(
        Reader.stateFromDocument(
            document({metrics: {queueDepth: "3", runningProfiles: 1}}),
            NOW,
        ).detail,
        "The runtime snapshot's metrics.queueDepth is not a count",
    );
    assert.equal(Reader.unreadableMember(document()), null);
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

test("every state a read produces names the file it was read from", () => {
    const missing = Object.assign(new Error("gone"), {code: 1});
    const expanded = "/home/tester/.local/state/xpu-workload-manager/state.json";
    const filename = "~/.local/state/xpu-workload-manager/state.json";

    assert.equal(
        Reader.readSnapshot(environment({throws: missing}), filename, NOW).source,
        expanded,
    );
    assert.equal(
        Reader.readSnapshot(
            environment({contents: JSON.stringify(document())}),
            filename,
            NOW,
        ).source,
        expanded,
    );
    // The empty state names no file, because no read produced it.
    assert.equal(Reader.EMPTY_STATE.source, "");
    assert.equal(Reader.readFrom(Reader.EMPTY_STATE, "/state.json").source, "/state.json");
});

test("a snapshot larger than any guessed ceiling is still read", () => {
    // The runtime publishes one entry per installed workload with no cap, so a
    // size limit here would report a working runtime as absent.
    const published = JSON.stringify({
        version: 1,
        generatedAt: NOW,
        devices: [{backend: "gpu", available: true}],
        metrics: {queueDepth: 0, runningProfiles: 0},
        profiles: {},
        alerts: [],
        padding: "x".repeat(2 * 1024 * 1024),
    });
    const huge = {
        GLib: {get_home_dir: () => "/home/tester"},
        Gio: {
            IOErrorEnum: {NOT_FOUND: 1},
            File: {new_for_path: () => ({load_contents: () => [true, Buffer.from(published)]})},
        },
        decode: (value) => value.toString("utf8"),
    };

    assert.equal(Reader.MAX_SNAPSHOT_BYTES, null);
    assert.equal(Reader.readSnapshot(huge, "/state.json", NOW).runtime, "connected");
});

test("a ceiling, when one is set, is still enforced before parsing", () => {
    // The ceiling is off by default, not deleted: a caller that sets one is
    // still held to it, so re-imposing a bound stays a one-line change.
    const contents = Buffer.alloc(64, "x");

    assert.equal(Reader.tooLargeFor(contents, null), null);
    assert.equal(Reader.tooLargeFor(contents, 1024), null);
    assert.equal(Reader.tooLargeFor(contents, 16).runtime, "malformed");
});

// Pause is service state: the runtime enforces it with or without a client
// attached, and publishes it as policy. A panel that inferred it from an
// empty queue would draw a hold on an idle desk.
test("the reader takes the hold from the runtime's own policy", () => {
    const held = Reader.stateFromDocument({
        version: 1,
        generatedAt: 10,
        devices: [{backend: "gpu", available: true}],
        metrics: {queueDepth: 3, runningProfiles: 0},
        alerts: [],
        policy: {revision: 7, paused: true, profiles: {}},
    }, 10);

    assert.equal(held.paused, true);
    assert.equal(held.runtime, "connected");
    assert.equal(held.queued, 3);
});

test("a runtime that publishes no policy is not held", () => {
    const running = Reader.stateFromDocument({
        version: 1,
        generatedAt: 10,
        devices: [{backend: "gpu", available: true}],
        metrics: {queueDepth: 0, runningProfiles: 1},
        alerts: [],
    }, 10);

    assert.equal(running.paused, false);
    assert.equal(Reader.EMPTY_STATE.paused, false);
    assert.equal(Reader.stateFromDocument(document({policy: "held"}), NOW).paused, false);
    assert.equal(
        Reader.stateFromDocument(document({policy: {paused: "yes"}}), NOW).paused,
        false,
    );
});

// The deployment order is reader before writer, so an unrecognised version is
// this panel being older than the runtime — a fact worth saying. Rendered
// field by field instead, a document whose metrics were renamed draws a
// healthy runtime with nothing queued and nothing to review, which is exactly
// what an idle desk looks like.
test("a snapshot version the panel does not know is refused, and named", () => {
    const future = Reader.stateFromDocument(document({version: 2}), NOW);

    assert.equal(future.runtime, "malformed");
    assert.match(future.detail, /version 2, not 1/u);
    assert.equal(future.queued, 0);
});

test("a snapshot with no version at all is not read as version one", () => {
    const {version, ...versionless} = document();

    assert.equal(version, Reader.SNAPSHOT_VERSION);
    assert.equal(Reader.stateFromDocument(versionless, NOW).runtime, "malformed");
    assert.equal(Reader.stateFromDocument(document({version: "1"}), NOW).runtime, "malformed");
});

// The mismatch line is what `docs/deployment.md` sends an installer to read
// after a half-finished upgrade, so it has to name a mismatch. A template
// renders the string "1" and the number 1 identically, and the report read
// "snapshot version 1, not 1"; a document with no version named a JavaScript
// value, "undefined", rather than a fact about the runtime.
test("the version a document publishes is named as it was published", () => {
    assert.equal(
        Reader.stateFromDocument(document({version: "1"}), NOW).detail,
        'The runtime publishes snapshot version "1", not 1',
    );
    assert.equal(
        Reader.versionMismatch(2),
        "The runtime publishes snapshot version 2, not 1",
    );
    assert.equal(
        Reader.versionMismatch(undefined),
        "The runtime publishes a snapshot with no version, and this panel reads version 1",
    );
    // A value no JSON document can carry is still named rather than dropped.
    assert.equal(
        Reader.versionMismatch(Symbol("one")),
        "The runtime publishes snapshot version Symbol(one), not 1",
    );
});

// The applet runs on the compositor thread, so the read it performs once a
// tick has to hand the waiting to the mainloop rather than to the desktop.
function asyncEnvironment({
    contents = null,
    throws = null,
    finishThrows = null,
    startThrows = null,
    immediate = false,
} = {}) {
    const pending = [];
    const file = {
        load_contents_async(_cancellable, callback) {
            if (startThrows) {
                throw startThrows;
            }
            if (immediate) {
                callback(file, {});
                return;
            }
            pending.push(() => callback(file, {}));
        },
        load_contents_finish() {
            if (finishThrows) {
                throw finishThrows;
            }
            return [true, Buffer.from(contents)];
        },
    };
    return {
        pending,
        environment: {
            GLib: {get_home_dir: () => "/home/tester"},
            Gio: {
                IOErrorEnum: {NOT_FOUND: 1},
                File: {
                    new_for_path() {
                        if (throws) {
                            throw throws;
                        }
                        return file;
                    },
                },
            },
            decode: (buffer) => buffer.toString("utf8"),
        },
    };
}

test("an asynchronous read delivers its state on the callback, not on the call", () => {
    const {pending, environment: async} = asyncEnvironment({
        contents: JSON.stringify(document()),
    });
    const delivered = [];

    const deferred = Reader.readSnapshotAsync(async, "~/state.json", NOW, (state) => {
        delivered.push(state);
    });

    assert.equal(deferred, true);
    assert.deepEqual(delivered, []);
    pending.pop()();
    assert.equal(delivered.length, 1);
    assert.equal(delivered[0].runtime, "connected");
    assert.equal(delivered[0].queued, 3);
});

test("a failure to finish an asynchronous read is a state, not a throw", () => {
    const denied = Object.assign(new Error("denied"), {code: 14});
    const {pending, environment: async} = asyncEnvironment({finishThrows: denied});
    const delivered = [];

    Reader.readSnapshotAsync(async, "~/state.json", NOW, (state) => delivered.push(state));
    pending.pop()();

    assert.equal(delivered[0].runtime, "unreadable");
});

test("a file that cannot even be named is delivered before the call returns", () => {
    const missing = Object.assign(new Error("gone"), {code: 1});
    const {environment: async} = asyncEnvironment({throws: missing});
    const delivered = [];

    const deferred = Reader.readSnapshotAsync(async, "~/state.json", NOW, (state) => {
        delivered.push(state);
    });

    assert.equal(deferred, false);
    assert.equal(delivered[0].runtime, "absent");
});

// The applet drops its read latch only when a state arrives, so a throw from
// arming the read — rather than from finishing it — used to freeze the panel
// on its last picture for the rest of the session.
test("a read that cannot even be started is a state, not a throw", () => {
    const refused = Object.assign(new Error("refused"), {code: 14});
    const {pending, environment: async} = asyncEnvironment({startThrows: refused});
    const delivered = [];

    const deferred = Reader.readSnapshotAsync(
        async,
        "~/state.json",
        NOW,
        (state) => delivered.push(state),
    );

    assert.equal(deferred, false);
    assert.deepEqual(pending, []);
    assert.equal(delivered.length, 1);
    assert.equal(delivered[0].runtime, "unreadable");
});

// Cinnamon's Gio always offers the asynchronous form; a harness handing in a
// double that does not must still be answered rather than left waiting.
test("a platform without an asynchronous load falls back to the blocking read", () => {
    const delivered = [];

    const deferred = Reader.readSnapshotAsync(
        environment({contents: JSON.stringify(document())}),
        "~/state.json",
        NOW,
        (state) => delivered.push(state),
    );

    assert.equal(deferred, false);
    assert.equal(delivered[0].runtime, "connected");
});

// Delivering a state is a call into the panel, and drawing can throw: a
// destroyed actor, a tooltip already gone. Caught as though the read had
// failed, that throw invented a second state — so the panel that had just been
// handed a working runtime was immediately handed an unreadable one.
test("a consumer that throws while drawing is not answered with a second state", () => {
    const {pending, environment: async} = asyncEnvironment({
        contents: JSON.stringify(document()),
    });
    const delivered = [];

    Reader.readSnapshotAsync(async, "~/state.json", NOW, (state) => {
        delivered.push(state);
        throw new Error("the actor is gone");
    });

    assert.throws(() => pending.pop()(), /the actor is gone/u);
    assert.equal(delivered.length, 1);
    assert.equal(delivered[0].runtime, "connected");
});

// The same throw, from a Gio whose callback runs before the call that armed it
// returns: the guard around arming the read is the one that would have caught
// it and delivered again.
test("a read that answers before it returns still delivers exactly one state", () => {
    const {environment: async} = asyncEnvironment({
        contents: JSON.stringify(document()),
        immediate: true,
    });
    const delivered = [];

    const deferred = Reader.readSnapshotAsync(async, "~/state.json", NOW, (state) => {
        delivered.push(state);
        throw new Error("the actor is gone");
    });

    assert.equal(deferred, false);
    assert.equal(delivered.length, 1);
    assert.equal(delivered[0].runtime, "connected");
});
