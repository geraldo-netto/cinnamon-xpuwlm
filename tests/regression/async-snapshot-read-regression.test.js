"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const Cinnamon = require("../../files/cinnamon-tpuwm@geraldo-netto/lib/cinnamon-runtime.js");
const Domain = require("../../files/cinnamon-tpuwm@geraldo-netto/lib/domain.js");
const Manager = require("../../files/cinnamon-tpuwm@geraldo-netto/lib/manager.js");
const Runtime = require("../../files/cinnamon-tpuwm@geraldo-netto/lib/runtime-gateway.js");
const RuntimeSchema = require("../../files/cinnamon-tpuwm@geraldo-netto/lib/runtime-snapshot-schema-validator.js");
const {createGioEnvironment, gioError} = require("../helpers/fakes.js");

const NOW = 1_700_000_000_000;

function document(name) {
    return JSON.stringify({
        version: Domain.SNAPSHOT_VERSION,
        generatedAt: NOW,
        device: {available: true, name, kind: "usb", reason: ""},
        metrics: {load: 10, queueDepth: 0, runningProfiles: 0},
        profiles: {},
        alerts: [],
    });
}

// A reader that never completes on its own; the test decides when each pending
// read finishes, which is what a real GIO async read looks like.
function deferredReader() {
    const pending = [];
    const reader = (path, options, callback) => {
        pending.push({options, callback});
    };
    reader.pending = pending;
    return reader;
}

function gateway(readTextAsync, overrides = {}) {
    return new Runtime.RuntimeSnapshotGateway({
        path: "/run/tpuwm.json",
        clock: {now: () => NOW},
        readTextAsync,
        detectDevice: () => ({available: false}),
        snapshotValidator: new RuntimeSchema.RuntimeSnapshotSchemaValidator(),
        warningReporter: {report() {}, recover() {}},
        ...overrides,
    });
}

test("regression: only the newest read is delivered when refreshes overlap", () => {
    const reader = deferredReader();
    const subject = gateway(reader);
    const delivered = [];

    subject.read({}, (snapshot) => delivered.push(["first", snapshot.device.name]));
    subject.read({}, (snapshot) => delivered.push(["second", snapshot.device.name]));
    assert.equal(reader.pending.length, 2);

    reader.pending[1].callback(null, document("Newest"));
    reader.pending[0].callback(null, document("Stale"));

    assert.deepEqual(delivered, [["second", "Newest"]]);
});

test("regression: a completion arriving after cancellation is discarded", () => {
    const reader = deferredReader();
    const subject = gateway(reader);
    const delivered = [];

    subject.read({}, (snapshot) => delivered.push(snapshot));
    assert.equal(subject.cancel(), true);
    assert.equal(subject.cancel(), false);

    reader.pending[0].callback(null, document("Too late"));
    assert.deepEqual(delivered, []);
});

test("regression: cancelling cancels the GIO cancellable handed to the reader", () => {
    const reader = deferredReader();
    const cancellables = [];
    const subject = gateway(reader, {
        cancellableFactory: () => {
            const cancellable = {cancelled: false, cancel() { this.cancelled = true; }};
            cancellables.push(cancellable);
            return cancellable;
        },
    });

    subject.read({}, () => {});
    assert.equal(cancellables.length, 1);
    assert.equal(reader.pending[0].options.cancellable, cancellables[0]);
    subject.cancel();
    assert.equal(cancellables[0].cancelled, true);

    // Starting a read also cancels whatever was already in flight.
    subject.read({}, () => {});
    subject.read({}, () => {});
    assert.equal(cancellables[1].cancelled, true);
    assert.equal(cancellables[2].cancelled, false);
});

test("regression: reads are bounded one byte past the accepted maximum", () => {
    const reader = deferredReader();
    gateway(reader).read({}, () => {});
    assert.equal(reader.pending[0].options.maximumBytes, Runtime.MAX_SNAPSHOT_BYTES + 1);
});

test("regression: a reader that calls back twice publishes only once", () => {
    const reader = deferredReader();
    const subject = gateway(reader);
    let deliveries = 0;

    subject.read({}, () => { deliveries += 1; });
    reader.pending[0].callback(null, document("Once"));
    reader.pending[0].callback(null, document("Twice"));
    assert.equal(deliveries, 1);
});

test("regression: the manager discards a completion that lost its race", () => {
    const reader = deferredReader();
    const subject = gateway(reader);
    const manager = new Manager.WorkloadManager({
        repository: {load: () => ({}), save() {}},
        runtimeGateway: subject,
        errorReporter: {report() {}, recover() {}},
        clock: {now: () => NOW},
    });
    const names = [];
    manager.subscribe((state) => names.push(state.device.name));

    manager.start();
    manager.refresh();
    reader.pending[1].callback(null, document("Newest"));
    reader.pending[0].callback(null, document("Stale"));

    assert.deepEqual(names, ["Newest"]);
    manager.dispose();
});

test("regression: the manager guards sequencing even when the gateway does not", () => {
    const callbacks = [];
    const manager = new Manager.WorkloadManager({
        repository: {load: () => ({}), save() {}},
        runtimeGateway: {read: (options, callback) => callbacks.push(callback)},
        errorReporter: {report() {}, recover() {}},
        clock: {now: () => NOW},
    });
    const names = [];
    manager.subscribe((state) => names.push(state.device.name));

    manager.start();
    manager.refresh();
    assert.equal(callbacks.length, 2);

    callbacks[1](Domain.probeSnapshot({available: true, name: "Newest", kind: "usb"}, NOW));
    callbacks[0](Domain.probeSnapshot({available: true, name: "Stale", kind: "usb"}, NOW));

    assert.deepEqual(names, ["Newest"]);
    manager.dispose();
});

test("regression: teardown cancels a pending read and ignores its completion", () => {
    const reader = deferredReader();
    const subject = gateway(reader);
    const manager = new Manager.WorkloadManager({
        repository: {load: () => ({}), save() {}},
        runtimeGateway: subject,
        errorReporter: {report() {}, recover() {}},
        clock: {now: () => NOW},
    });
    const names = [];
    manager.subscribe((state) => names.push(state.device.name));
    manager.start();

    assert.equal(manager.dispose(), true);
    reader.pending[0].callback(null, document("After teardown"));
    assert.deepEqual(names, []);
});

test("regression: replacing the gateway cancels the read still in flight", () => {
    const reader = deferredReader();
    const subject = gateway(reader);
    const manager = new Manager.WorkloadManager({
        repository: {load: () => ({}), save() {}},
        runtimeGateway: subject,
        errorReporter: {report() {}, recover() {}},
        clock: {now: () => NOW},
    });
    const names = [];
    manager.subscribe((state) => names.push(state.device.name));
    manager.start();

    const replacement = deferredReader();
    manager.replaceRuntimeGateway(gateway(replacement));
    reader.pending[0].callback(null, document("Old gateway"));
    replacement.pending[0].callback(null, document("New gateway"));

    assert.deepEqual(names, ["New gateway"]);
    manager.dispose();
});

test("regression: a gateway without cancellation support is still replaceable", () => {
    const manager = new Manager.WorkloadManager({
        repository: {load: () => ({}), save() {}},
        runtimeGateway: {read: (options, callback) => callback(Domain.probeSnapshot({available: true, name: "First", kind: "usb"}, NOW))},
        errorReporter: {report() {}, recover() {}},
        clock: {now: () => NOW},
    });
    manager.start();
    assert.equal(manager.state().device.name, "First");
    manager.replaceRuntimeGateway({
        read: (options, callback) => callback(Domain.probeSnapshot({available: true, name: "Second", kind: "usb"}, NOW)),
    });
    assert.equal(manager.state().device.name, "Second");
    manager.dispose();
});

test("regression: the GIO adapter refuses anything that is not a regular file", () => {
    const environment = createGioEnvironment({
        "/link": {type: 3, contents: "{}"},
        "/dir": {type: 2, contents: ""},
        "/special": {type: 4, contents: ""},
        "/regular": {type: 1, contents: "{}"},
    });
    const seen = [];
    for (const path of ["/link", "/dir", "/special", "/regular"]) {
        Cinnamon.readFileTextAsync(path, environment, {maximumBytes: 100},
            (error, text) => seen.push([path, error && error.message, text]));
    }
    assert.match(seen[0][1], /not a regular file/u);
    assert.match(seen[1][1], /not a regular file/u);
    assert.match(seen[2][1], /not a regular file/u);
    assert.deepEqual(seen[3], ["/regular", null, "{}"]);
    assert.equal(
        environment.Gio.opened.every((entry) => entry.flags === environment.Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS),
        true,
        "the preflight must never follow a symlink",
    );
});

test("regression: a path object swapped between preflight and open is rejected", () => {
    const environment = createGioEnvironment({
        "/swapped": {contents: "{}", inode: 10, device: 1, openedInode: 11},
        "/moved": {contents: "{}", inode: 10, device: 1, openedDevice: 2},
        "/stable": {contents: "{}", inode: 10, device: 1},
    });
    const seen = [];
    for (const path of ["/swapped", "/moved", "/stable"]) {
        Cinnamon.readFileTextAsync(path, environment, {maximumBytes: 100},
            (error, text) => seen.push([path, error && error.message, text]));
    }
    assert.match(seen[0][1], /path changed while opening/u);
    assert.match(seen[1][1], /path changed while opening/u);
    assert.deepEqual(seen[2], ["/stable", null, "{}"]);

    assert.equal(Cinnamon.sameIdentity({inode: 1, device: 2}, {inode: 1, device: 2}), true);
    assert.equal(Cinnamon.sameIdentity({inode: 1, device: 2}, {inode: 9, device: 2}), false);
    assert.equal(Cinnamon.sameIdentity({inode: 1, device: 2}, {inode: 1, device: 9}), false);
    assert.deepEqual(
        Cinnamon.fileIdentity({get_attribute_uint64: () => 7, get_attribute_uint32: () => 8}),
        {inode: 7, device: 8},
    );
});

test("regression: reads stay bounded at the declared maximum in both directions", () => {
    const environment = createGioEnvironment({
        "/declared": {contents: "0123456789", size: 99},
        "/grown": {contents: "0123456789", size: 1},
    });
    const seen = [];
    Cinnamon.readFileTextAsync("/declared", environment, {maximumBytes: 4},
        (error) => seen.push(error && error.message));
    assert.match(seen[0], /exceeds 1 MiB/u, "an oversized preflight size is refused");

    Cinnamon.readFileTextAsync("/grown", environment, {maximumBytes: 4},
        (error) => seen.push(error && error.message));
    assert.match(seen[1], /exceeds 1 MiB/u, "a file that grew after the preflight is refused");
});

test("regression: absent, cancelled, and failed reads keep their own outcomes", () => {
    const results = [];
    const absent = createGioEnvironment({});
    Cinnamon.readFileTextAsync("/absent", absent, {maximumBytes: 100},
        (error, text) => results.push(["absent", error, text]));
    assert.deepEqual(results.at(-1), ["absent", null, null]);

    const cancelled = createGioEnvironment({
        "/cancelled": {contents: "{}", queryError: gioError(19)},
    });
    Cinnamon.readFileTextAsync("/cancelled", cancelled, {maximumBytes: 100},
        () => results.push(["cancelled"]));
    assert.notEqual(results.at(-1)[0], "cancelled", "a cancelled read must not call back");

    const denied = createGioEnvironment({
        "/denied": {contents: "{}", queryError: new Error("permission denied")},
    });
    Cinnamon.readFileTextAsync("/denied", denied, {maximumBytes: 100},
        (error) => results.push(["denied", error.message]));
    assert.deepEqual(results.at(-1), ["denied", "permission denied"]);

    const unreadable = createGioEnvironment({
        "/unreadable": {contents: "{}", openError: new Error("stream refused")},
    });
    Cinnamon.readFileTextAsync("/unreadable", unreadable, {maximumBytes: 100},
        (error) => results.push(["open", error.message]));
    assert.deepEqual(results.at(-1), ["open", "stream refused"]);

    const truncated = createGioEnvironment({
        "/truncated": {contents: "{}", readError: new Error("read interrupted")},
    });
    Cinnamon.readFileTextAsync("/truncated", truncated, {maximumBytes: 100},
        (error) => results.push(["read", error.message]));
    assert.deepEqual(results.at(-1), ["read", "read interrupted"]);

    const unbounded = createGioEnvironment({"/unbounded": {contents: "{}"}});
    Cinnamon.readFileTextAsync("/unbounded", unbounded, {},
        (error, text) => results.push(["unbounded", error, text]));
    assert.deepEqual(results.at(-1), ["unbounded", null, "{}"]);

    assert.equal(Cinnamon.isIoError({}, gioError(1), "NOT_FOUND"), false);
    assert.equal(Cinnamon.isIoError(absent, null, "NOT_FOUND"), false);
});

test("regression: the cancellable factory degrades on a build without Gio", () => {
    assert.equal(Cinnamon.createCancellableFactory({})(), null);
    assert.equal(Cinnamon.createCancellableFactory({Gio: {}})(), null);
    const created = Cinnamon.createCancellableFactory({
        Gio: {Cancellable: class {}},
    })();
    assert.notEqual(created, null);
});
