"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const Cinnamon = require("../../files/cinnamon-xpuwlm@geraldo-netto/lib/cinnamon-runtime.js");
const ManifestFixtures = require("../helpers/workload-manifest-fixtures.js");
const Runtime = require("../../files/cinnamon-xpuwlm@geraldo-netto/lib/runtime-gateway.js");
const {readSnapshot} = require("../helpers/fakes.js");
const {installControlSocket} = require("../helpers/fake-control-socket.js");

const NOW = 1_700_000_000_000;

class FakeFile {
    constructor(path, env) {
        this.path = path;
        this.environment = env;
    }

    query_exists() {
        return this.environment.existing.has(this.path);
    }

    fileEntry() {
        const value = this.environment.files.get(this.path);
        if (value !== null && typeof value === "object" && !(value instanceof Error)) {
            return value;
        }
        return {contents: value};
    }

    query_info(_attributes, _flags, _cancellable) {
        if (!this.environment.existing.has(this.path)) {
            throw ioError(this.environment, "NOT_FOUND");
        }
        const entry = this.fileEntry();
        if (entry.queryError) {
            throw entry.queryError;
        }
        const text = typeof entry.contents === "string" ? entry.contents : (entry.chunks || []).join("");
        return {
            get_file_type: () => entry.type ?? this.environment.Gio.FileType.REGULAR,
            get_size: () => entry.size ?? new TextEncoder().encode(text).byteLength,
            get_attribute_uint64: () => entry.inode ?? 1,
            get_attribute_uint32: () => entry.device ?? 1,
        };
    }

    read(_cancellable) {
        const entry = this.fileEntry();
        if (entry.contents instanceof Error) {
            throw entry.contents;
        }
        const pending = entry.chunks
            ? entry.chunks.slice()
            : [typeof entry.contents === "string" ? entry.contents : ""];
        const state = {closed: false};
        this.environment.streams.push(state);
        return {
            query_info: () => ({
                get_file_type: () => entry.type ?? this.environment.Gio.FileType.REGULAR,
                get_size: () => 0,
                get_attribute_uint64: () => entry.openedInode ?? entry.inode ?? 1,
                get_attribute_uint32: () => entry.openedDevice ?? entry.device ?? 1,
            }),
            read_bytes: (count) => {
                let chunk = pending.length === 0 ? "" : String(pending.shift());
                if (chunk.length > count) {
                    pending.unshift(chunk.slice(count));
                    chunk = chunk.slice(0, count);
                }
                return {get_data: () => chunk};
            },
            close: () => { state.closed = true; },
        };
    }

    query_info_async(attributes, flags, priority, cancellable, callback) {
        callback(this, {});
    }

    query_info_finish() {
        if (!this.environment.existing.has(this.path)) {
            throw ioError(this.environment, "NOT_FOUND");
        }
        const value = this.environment.files.get(this.path);
        if (value instanceof Error) {
            throw value;
        }
        return this.identityInfo(String(value).length);
    }

    identityInfo(size) {
        return {
            get_file_type: () => this.environment.Gio.FileType.REGULAR,
            get_size: () => size,
            get_attribute_uint64: () => 1,
            get_attribute_uint32: () => 1,
        };
    }

    read_async(priority, cancellable, callback) {
        callback(this, {});
    }

    read_finish() {
        const value = String(this.environment.files.get(this.path));
        const identityInfo = (size) => this.identityInfo(size);
        return {
            query_info: () => identityInfo(value.length),
            read_bytes_async(count, priority, cancellable, cb) { cb(this, {}); },
            read_bytes_finish: () => ({get_data: () => value}),
        };
    }

    enumerate_children() {
        const fileEnvironment = this.environment;
        const names = (this.environment.directoryNames?.[this.path]
            ?? (this.path === "/workloads"
                ? this.environment.workloadNames
                : this.environment.usbNames)).slice();
        let index = 0;
        return {
            next_file() {
                if (index >= names.length) {
                    return null;
                }
                const name = names[index];
                index += 1;
                return {
                    get_name: () => name,
                    get_file_type: () => fileEnvironment.Gio.FileType.DIRECTORY,
                };
            },
            close: () => { this.environment.closed = true; },
        };
    }

    enumerate_children_async(attributes, flags, priority, cancellable, callback) {
        callback(this, {});
    }

    enumerate_children_finish() {
        const synchronous = this.enumerate_children();
        const entries = [];
        let info = synchronous.next_file();
        while (info !== null) {
            entries.push(info);
            info = synchronous.next_file();
        }
        let index = 0;
        return {
            next_files_async(count, priority, cancellable, callback) { callback(this, {count}); },
            next_files_finish(result) {
                const batch = entries.slice(index, index + result.count);
                index += batch.length;
                return batch;
            },
            close_async(priority, cancellable, callback) { callback(this, {}); },
            close_finish: () => { this.environment.closed = true; },
        };
    }
}

function ioError(env, name) {
    const code = env.Gio.IOErrorEnum[name];
    return {matches: (enumeration, candidate) => enumeration === env.Gio.IOErrorEnum && candidate === code};
}

function environment(files = {}, usbNames = [], workloadNames = []) {
    const env = {
        files: new Map(Object.entries(files)),
        existing: new Set(Object.keys(files)),
        usbNames,
        workloadNames,
        closed: false,
        streams: [],
        ByteArray: {toString: (bytes) => String(bytes)},
        Gio: {
            File: {new_for_path: (path) => new FakeFile(path, env)},
            FileQueryInfoFlags: {NOFOLLOW_SYMLINKS: 1},
            IOErrorEnum: {NOT_FOUND: 1, CANCELLED: 19},
            FileType: {REGULAR: 1, DIRECTORY: 2, SYMBOLIC_LINK: 3, SPECIAL: 4},
            Cancellable: class { cancel() { this.cancelled = true; } },
        },
        GLib: {
            get_home_dir: () => "/home/tester",
            file_get_contents(path) {
                const value = env.files.get(path);
                if (value instanceof Error) {
                    return [false, ""];
                }
                return [true, value];
            },
        },
    };
    return env;
}

function detectWith(fn, env) {
    return new Promise((resolve, reject) => fn(env, null, (error, device) => {
        if (error) {
            reject(error);
        } else {
            resolve(device);
        }
    }));
}

function cachedDetection(detector, forceRefresh = false) {
    return new Promise((resolve, reject) => detector.detect(
        forceRefresh,
        {},
        (error, device) => error ? reject(error) : resolve(device),
    ));
}

test("path and byte helpers support Cinnamon values", () => {
    assert.equal(Cinnamon.expandHome("~", "/home/a"), "/home/a");
    assert.equal(Cinnamon.expandHome("~/state.json", "/home/a"), "/home/a/state.json");
    assert.equal(Cinnamon.expandHome("/run/state", "/home/a"), "/run/state");
    assert.equal(Cinnamon.decodeBytes("ready", {}), "ready");
    assert.equal(Cinnamon.decodeBytes(42, {toString: (value) => `bytes:${value}`}), "bytes:42");
});

test("file reading distinguishes absent, valid, and failed files", () => {
    const env = environment({"/ok": " VALUE ", "/failed": new Error("failed")});
    assert.equal(Cinnamon.readFileText("/absent", env), null);
    assert.equal(Cinnamon.readFileText("/ok", env), " VALUE ");
    assert.equal(Cinnamon.readTrimmed("/ok", env), "value");
    assert.equal(Cinnamon.readTrimmed("/absent", env), "");
    assert.throws(() => Cinnamon.readFileText("/failed", env), /Could not read/);
    const oversized = environment({"/large": "x".repeat(Runtime.MAX_SNAPSHOT_BYTES + 1)});
    assert.throws(
        () => Cinnamon.readFileText("/large", oversized, Runtime.MAX_SNAPSHOT_BYTES),
        /configured maximum/u,
    );
});

test("workload registry adapter discovers bounded validated manifests", () => {
    const manifest = {
        manifestVersion: 1,
        id: "sample-workload",
        version: "1.0.0",
        capabilities: ["classify"],
        requirements: {
            runtimeApi: 1,
            accelerator: "tpu",
            minimumDevices: 1,
            model: null,
        },
        ui: {
            title: "Sample",
            group: "Examples",
            description: "Sample workload",
            icon: "applications-science-symbolic",
            order: 10,
        },
        defaults: {enabled: false, weight: 2},
        pipeline: {hostResponsibilities: []},
        acceptance: [],
    };
    const manifestPath = "/workloads/sample-workload/manifest.json";
    const env = environment({
        "/workloads": "",
        [manifestPath]: JSON.stringify(manifest),
    }, [], ["ignored-file", "sample-workload"]);
    const original = env.Gio.File.new_for_path;
    env.Gio.File.new_for_path = (path) => {
        const file = original(path);
        if (path === "/workloads") {
            const originalEnumerator = file.enumerate_children.bind(file);
            file.enumerate_children = () => {
                const enumerator = originalEnumerator();
                const originalNext = enumerator.next_file.bind(enumerator);
                enumerator.next_file = () => {
                    const info = originalNext();
                    if (info && info.get_name() === "ignored-file") {
                        return {...info, get_file_type: () => env.Gio.FileType.REGULAR};
                    }
                    return info;
                };
                return enumerator;
            };
        }
        return file;
    };

    assert.deepEqual(Cinnamon.listWorkloadDirectories("/missing", env), []);
    assert.deepEqual(Cinnamon.listWorkloadDirectories("/workloads", env), ["sample-workload"]);
    assert.equal(env.closed, true);
    const registry = Cinnamon.createWorkloadRegistry("/workloads", env);
    assert.deepEqual(registry.descriptors().map((entry) => entry.id), ["sample-workload"]);
});

test("bounded regular-file reader enforces the plug-in trust boundary", () => {
    const env = environment({
        "/plugins/ok/manifest.json": "{\"a\":1}",
        "/plugins/link/manifest.json": {contents: "{}", type: 3},
        "/plugins/fifo/manifest.json": {contents: "{}", type: 4},
        "/plugins/big/manifest.json": {contents: "x".repeat(65), size: 65},
        "/plugins/liar/manifest.json": {contents: "x".repeat(65), size: 8},
        "/plugins/swap/manifest.json": {contents: "{}", openedInode: 2},
        "/plugins/chunked/manifest.json": {chunks: ["ab", "cd"]},
        "/plugins/empty/manifest.json": "",
        "/plugins/denied/manifest.json": {queryError: new Error("denied")},
        "/plugins/exact/manifest.json": {contents: "y".repeat(64), size: 64},
        "/plugins/sysfs/manifest.json": {contents: "ok", size: 100},
    });
    const read = (path) => Cinnamon.readBoundedRegularFileText(path, env, 64);
    assert.equal(read("/absent"), null);
    assert.equal(read("/plugins/ok/manifest.json"), "{\"a\":1}");
    assert.equal(read("/plugins/chunked/manifest.json"), "abcd");
    assert.equal(read("/plugins/empty/manifest.json"), "");
    assert.throws(() => read("/plugins/link/manifest.json"), /regular file/u);
    assert.throws(() => read("/plugins/fifo/manifest.json"), /regular file/u);
    assert.throws(() => read("/plugins/big/manifest.json"), /maximum size/u);
    assert.throws(() => read("/plugins/liar/manifest.json"), /maximum size/u);
    assert.throws(() => read("/plugins/swap/manifest.json"), /changed while opening/u);
    assert.throws(() => read("/plugins/denied/manifest.json"), /denied/u);
    assert.equal(read("/plugins/exact/manifest.json"), "y".repeat(64));
    // A declared size beyond the budget is rejected before opening the file,
    // even when the actual content would fit (sysfs-style page-sized st_size).
    assert.throws(() => read("/plugins/sysfs/manifest.json"), /maximum size/u);
    assert.equal(env.streams.length > 0, true);
    assert.equal(env.streams.every((stream) => stream.closed), true);
});

test("chunk joining preserves text and binary content", () => {
    assert.equal(Cinnamon.joinChunks([], 0), "");
    assert.equal(Cinnamon.joinChunks(["only"], 4), "only");
    assert.equal(Cinnamon.joinChunks(["ab", "cd"], 4), "abcd");
    const merged = Cinnamon.joinChunks([new Uint8Array([104]), new Uint8Array([105])], 2);
    assert.deepEqual([...merged], [104, 105]);
    const single = new Uint8Array([1, 2]);
    assert.equal(Cinnamon.joinChunks([single], 2), single);
});

test("bounded stream reads reject overflow past the byte budget", () => {
    const chunks = ["abcd", "efgh", "i"];
    let reads = 0;
    const stream = {
        read_bytes(count) {
            const chunk = (chunks[reads] ?? "").slice(0, count);
            reads += 1;
            return {get_data: () => chunk};
        },
    };
    assert.throws(
        () => Cinnamon.readBoundedStreamBytes(stream, 8, "/stream"),
        /maximum size/u,
    );
    assert.equal(Cinnamon.readBoundedStreamBytes({
        read_bytes: () => ({get_data: () => null}),
    }, 8, "/null"), "");
    let rawDelivered = false;
    assert.equal(Cinnamon.readBoundedStreamBytes({
        read_bytes: () => {
            const text = rawDelivered ? "" : "raw";
            rawDelivered = true;
            return text;
        },
    }, 8, "/raw"), "raw");
});

test("PCIe detection uses the first available accelerator", async () => {
    assert.equal(await detectWith(Cinnamon.detectPcieDeviceAsync, environment()), null);
    const first = await detectWith(Cinnamon.detectPcieDeviceAsync, environment({"/dev/apex_0": ""}));
    assert.equal(first.name, "Coral PCIe Edge TPU");
    const second = await detectWith(Cinnamon.detectPcieDeviceAsync, environment({"/dev/apex_1": ""}));
    assert.equal(second.name, "Coral PCIe Edge TPU 2");
    assert.equal(second.kind, "pcie");
});

test("USB identity policy accepts only exact runtime and DFU pairs", () => {
    assert.equal(
        Cinnamon.findCoralUsbIdentity(Cinnamon.USB_VENDOR, Cinnamon.USB_PRODUCT).name,
        "Coral USB Accelerator",
    );
    assert.equal(
        Cinnamon.findCoralUsbIdentity(Cinnamon.USB_DFU_VENDOR, Cinnamon.USB_DFU_PRODUCT).name,
        "Coral USB Accelerator (DFU)",
    );
    assert.equal(Cinnamon.findCoralUsbIdentity(Cinnamon.USB_VENDOR, Cinnamon.USB_DFU_PRODUCT), null);
    assert.equal(Cinnamon.findCoralUsbIdentity(Cinnamon.USB_DFU_VENDOR, Cinnamon.USB_PRODUCT), null);
    assert.equal(Cinnamon.findCoralUsbIdentity("ffff", "ffff"), null);
});

test("USB detection normalizes Coral identifiers and always closes enumeration", async () => {
    const root = "/sys/bus/usb/devices";
    const foundEnv = environment({
        [root]: "",
        [`${root}/1/idVendor`]: "18D1\n",
        [`${root}/1/idProduct`]: "9302\n",
    }, ["1"]);
    const runtimeDevice = await detectWith(Cinnamon.detectUsbDeviceAsync, foundEnv);
    assert.equal(runtimeDevice.available, true);
    assert.equal(runtimeDevice.kind, "usb");
    assert.equal(foundEnv.closed, true);

    const dfuEnv = environment({
        [root]: "",
        [`${root}/2/idVendor`]: "  1A6E\n",
        [`${root}/2/idProduct`]: "089A\n",
    }, ["2"]);
    const dfuDevice = await detectWith(Cinnamon.detectUsbDeviceAsync, dfuEnv);
    assert.equal(dfuDevice.available, true);
    assert.equal(dfuDevice.name, "Coral USB Accelerator (DFU)");
    assert.equal(dfuEnv.closed, true);

    const otherEnv = environment({
        [root]: "",
        [`${root}/3/idVendor`]: "ffff",
        [`${root}/3/idProduct`]: "9302",
    }, ["3"]);
    assert.equal(await detectWith(Cinnamon.detectUsbDeviceAsync, otherEnv), null);
    assert.equal(otherEnv.closed, true);
    assert.equal(await detectWith(Cinnamon.detectUsbDeviceAsync, environment()), null);
});

test("USB discovery inspects only the bounded device prefix", async () => {
    const names = Array.from({length: Cinnamon.MAX_USB_DEVICES + 44}, (_, index) => `${index}`);
    const env = environment({"/sys/bus/usb/devices": ""}, names);
    const original = env.Gio.File.new_for_path;
    const inspected = new Set();
    env.Gio.File.new_for_path = (path) => {
        const match = path.match(/devices\/(\d+)\/idVendor$/u);
        if (match) {
            inspected.add(Number(match[1]));
        }
        return original(path);
    };
    assert.equal(await detectWith(Cinnamon.detectUsbDeviceAsync, env), null);
    assert.equal(inspected.size, Cinnamon.MAX_USB_DEVICES);
    assert.equal(Math.max(...inspected), Cinnamon.MAX_USB_DEVICES - 1);
    assert.equal(env.closed, true);
});

test("combined detection prioritizes PCIe, then USB, then reports absence by omission", async () => {
    const pcie = await detectWith(Cinnamon.detectDevicesAsync, environment({"/dev/apex_0": ""}));
    assert.equal(pcie.length, 1);
    assert.equal(pcie[0].kind, "pcie");
    assert.equal(pcie[0].backend, "tpu");
    assert.equal(pcie[0].id, "tpu-pcie-0");
    const root = "/sys/bus/usb/devices";
    const usb = await detectWith(Cinnamon.detectDevicesAsync, environment({
        [root]: "",
        [`${root}/1/idVendor`]: Cinnamon.USB_VENDOR,
        [`${root}/1/idProduct`]: Cinnamon.USB_PRODUCT,
    }, ["1"]));
    assert.equal(usb.length, 1);
    assert.equal(usb[0].kind, "usb");
    assert.equal(usb[0].backend, "tpu");
    assert.equal(usb[0].id, "tpu-usb");
    const absent = await detectWith(Cinnamon.detectDevicesAsync, environment());
    assert.deepEqual(absent, []);
});

test("asynchronous discovery adapters report IO failures and cancellation", () => {
    const env = environment({"/failed": new Error("read failed")});
    const calls = [];
    assert.equal(Cinnamon.finishIo(env, ioError(env, "CANCELLED"), () => calls.push("cancelled")), false);
    assert.equal(Cinnamon.finishIo(env, ioError(env, "NOT_FOUND"), (...args) => calls.push(args), false), true);
    const denied = new Error("denied");
    assert.equal(Cinnamon.finishIo(env, denied, (...args) => calls.push(args)), true);
    assert.deepEqual(calls, [[null, false], [denied, null]]);

    const immediate = environment();
    immediate.Gio.File.new_for_path = () => ({query_info_async() { throw denied; }});
    Cinnamon.queryExistsAsync("/device", immediate, null, (error, exists) => {
        assert.equal(error, denied);
        assert.equal(exists, false);
    });

    Cinnamon.closeEnumeratorAsync({close_async() { throw denied; }}, env, null, (error) => {
        assert.equal(error, denied);
    });
    Cinnamon.closeEnumeratorAsync({
        close_async(priority, cancellable, callback) { callback(this, {}); },
        close_finish() { throw denied; },
    }, env, null, (error) => assert.equal(error, denied));

    const closable = {
        next_files_async() { throw denied; },
        close_async(priority, cancellable, callback) { callback(this, {}); },
        close_finish() {},
    };
    Cinnamon.collectUsbNames(closable, env, null, [], (error) => assert.equal(error, denied));
    const failingBatch = {
        next_files_async(count, priority, cancellable, callback) { callback(this, {}); },
        next_files_finish() { throw denied; },
        close_async(priority, cancellable, callback) { callback(this, {}); },
        close_finish() {},
    };
    Cinnamon.collectUsbNames(failingBatch, env, null, [], (error) => assert.equal(error, denied));

    Cinnamon.readTrimmedAsync("/failed", env, null, (error, text) => {
        assert.equal(error.message, "read failed");
        assert.equal(text, "");
    });
});

test("cached detector respects TTL and supports invalidation", async () => {
    let now = NOW;
    let probes = 0;
    const env = environment();
    env.existing.add("/dev/apex_0");
    const original = env.Gio.File.new_for_path;
    env.Gio.File.new_for_path = (path) => {
        if (path === "/dev/apex_0") {
            probes += 1;
        }
        return original(path);
    };
    const detector = new Cinnamon.CachedDeviceDetector(env, {now: () => now}, 100);
    assert.throws(() => detector.detect(false, {}, null), /callback/u);
    const first = await cachedDetection(detector);
    first[0].name = "mutated";
    assert.equal((await cachedDetection(detector))[0].name, "Coral PCIe Edge TPU");
    assert.equal(probes, 1);
    now += 100;
    await cachedDetection(detector);
    assert.equal(probes, 2);
    detector.invalidate();
    await cachedDetection(detector);
    assert.equal(probes, 3);
    await cachedDetection(detector, true);
    assert.equal(probes, 4);
    await cachedDetection(detector, false);
    assert.equal(probes, 4);
    const uncached = new Cinnamon.CachedDeviceDetector(env, {now: () => now}, "invalid");
    await cachedDetection(uncached);
    await cachedDetection(uncached);
    assert.equal(probes, 6);
});

test("cached detector forwards asynchronous discovery failures without caching", async () => {
    const denied = new Error("device denied");
    const env = environment();
    env.Gio.File.new_for_path = () => ({
        query_info_async(attributes, flags, priority, cancellable, callback) { callback(this, {}); },
        query_info_finish() { throw denied; },
    });
    const detector = new Cinnamon.CachedDeviceDetector(env);
    await assert.rejects(() => cachedDetection(detector), /device denied/u);
    await assert.rejects(() => cachedDetection(detector), /device denied/u);
});

test("settings repository avoids redundant writes", () => {
    const values = {
        "profile-state": {paused: false, profiles: {}},
        "selected-tab": "overview",
        "activity-cleared-at": 0,
    };
    const writes = [];
    const settings = {
        getValue: (key) => structuredClone(values[key]),
        setValue(key, value) {
            values[key] = structuredClone(value);
            writes.push(key);
        },
    };
    assert.throws(() => new Cinnamon.CinnamonSettingsRepository(null), /settings/);
    const repository = new Cinnamon.CinnamonSettingsRepository(settings);
    assert.deepEqual(repository.load(), {
        portfolio: values["profile-state"], selectedTab: "overview", activityClearedAt: 0,
    });
    repository.save({portfolio: values["profile-state"], selectedTab: "overview", activityClearedAt: 0});
    assert.equal(writes.length, 0);
    repository.save({
        portfolio: {paused: true, profiles: {}}, selectedTab: "alerts", activityClearedAt: NOW,
    });
    assert.deepEqual(writes, ["profile-state", "selected-tab", "activity-cleared-at"]);
});

test("renamed state repository uses legacy fallback only for its canonical path", () => {
    const values = {"profile-state": {}, "selected-tab": "overview"};
    const settings = {
        getValue: (key) => values[key],
        setValue: (key, value) => { values[key] = value; },
    };
    for (const incomplete of [null, {}, {Gio: {}}, {GLib: {}}]) {
        assert.equal(
            Cinnamon.createStateRepository(incomplete, settings) instanceof Cinnamon.CinnamonSettingsRepository,
            true,
        );
    }
    const runtimeEnvironment = {
        Gio: {},
        GLib: {get_home_dir: () => "/home/user"},
    };
    const canonical = Cinnamon.createStateRepository(runtimeEnvironment, settings);
    assert.equal(canonical instanceof Cinnamon.FileStateRepository, true);
    assert.equal(canonical._path, "/home/user/.config/xpu-workload-manager/applet-state.json");
    assert.equal(canonical._legacyPath, "/home/user/.config/tpu-workload-manager/applet-state.json");

    const custom = Cinnamon.createStateRepository(runtimeEnvironment, settings, "/srv/xpu-state.json");
    assert.equal(custom._path, "/srv/xpu-state.json");
    assert.equal(custom._legacyPath, null);
});

test("poller replaces timers and stops idempotently", () => {
    const removed = [];
    const callbacks = new Map();
    let nextId = 1;
    const loop = {
        timeout_add_seconds(seconds, callback) {
            const id = nextId;
            nextId += 1;
            callbacks.set(id, {seconds, callback});
            return id;
        },
        source_remove: (id) => removed.push(id),
    };
    assert.throws(() => new Cinnamon.CinnamonPoller({}, () => {}), /Mainloop/);
    assert.throws(() => new Cinnamon.CinnamonPoller(loop, null), /callback/);
    let calls = 0;
    const poller = new Cinnamon.CinnamonPoller(loop, () => { calls += 1; });
    const first = poller.start(0);
    assert.equal(callbacks.get(first).seconds, 1);
    assert.equal(callbacks.get(first).callback(), true);
    assert.equal(calls, 1);
    const second = poller.start(3.9);
    assert.deepEqual(removed, [first]);
    assert.equal(callbacks.get(second).seconds, 3);
    assert.equal(poller.stop(), true);
    assert.equal(poller.stop(), false);
});

test("scheduler arms single-shot millisecond timers and cancels them", () => {
    const removed = [];
    const timers = new Map();
    let nextId = 1;
    const loop = {
        timeout_add(milliseconds, callback) {
            const id = nextId;
            nextId += 1;
            timers.set(id, {milliseconds, callback});
            return id;
        },
        source_remove: (id) => removed.push(id),
    };
    assert.throws(() => new Cinnamon.CinnamonScheduler({}), /Mainloop/);
    const scheduler = new Cinnamon.CinnamonScheduler(loop);
    assert.throws(() => scheduler.schedule(10, null), /callback/);

    let calls = 0;
    const handle = scheduler.schedule(1500.9, () => { calls += 1; });
    assert.equal(timers.get(handle).milliseconds, 1500);
    assert.equal(timers.get(handle).callback(), false, "expiry timers must not repeat");
    assert.equal(calls, 1);

    assert.equal(scheduler.schedule(-5, () => {}) > 0, true);
    assert.equal(timers.get(2).milliseconds, 0);
    assert.equal(scheduler.schedule("later", () => {}) > 0, true);
    assert.equal(timers.get(3).milliseconds, 0);

    assert.equal(scheduler.cancel(handle), true);
    assert.deepEqual(removed, [handle]);
    assert.equal(scheduler.cancel(null), false);
    assert.equal(scheduler.cancel(undefined), false);
    assert.deepEqual(removed, [handle]);
});

test("layout provider reports the monitor, display scale, and text scale", () => {
    const actor = {name: "panel"};
    const requested = [];
    const Main = {
        layoutManager: {
            primaryMonitor: {width: 1920, height: 1080},
            findMonitorForActor(candidate) {
                requested.push(candidate);
                return {width: 1280, height: 800};
            },
        },
    };
    const St = {ThemeContext: {get_for_stage: (stage) => ({scale_factor: stage === "stage" ? 2 : 1})}};
    const cinnamonGlobal = {stage: "stage", ui_scale: 1.25};

    assert.throws(() => Cinnamon.createLayoutProvider({}), /layout manager/);
    const provider = Cinnamon.createLayoutProvider({Main, St, cinnamonGlobal});
    assert.deepEqual(provider.measure(actor), {
        workAreaWidth: 1280,
        workAreaHeight: 800,
        scaleFactor: 2,
        textScaleFactor: 1.25,
    });
    assert.deepEqual(requested, [actor]);

    assert.deepEqual(provider.measure(), {
        workAreaWidth: 1920,
        workAreaHeight: 1080,
        scaleFactor: 2,
        textScaleFactor: 1.25,
    });
});

test("layout provider degrades to defaults on an older Cinnamon", () => {
    const provider = Cinnamon.createLayoutProvider({
        Main: {layoutManager: {}},
        St: {},
        cinnamonGlobal: {},
    });
    assert.deepEqual(provider.measure({}), {
        workAreaWidth: undefined,
        workAreaHeight: undefined,
        scaleFactor: 1,
        textScaleFactor: undefined,
    });
});

test("critical notifications reach Cinnamon's message tray", () => {
    const shown = [];
    assert.throws(() => Cinnamon.createCriticalNotifications(null), /criticalNotify/);
    assert.throws(() => Cinnamon.createCriticalNotifications({}), /criticalNotify/);
    const notifications = Cinnamon.createCriticalNotifications({
        criticalNotify: (summary, body) => shown.push([summary, body]),
    });
    notifications.notify({summary: "XPU critical alert", body: "Voltage drift"});
    assert.deepEqual(shown, [["XPU critical alert", "Voltage drift"]]);
});

test("logger prefixes Cinnamon warnings and errors", () => {
    const calls = [];
    const logger = Cinnamon.createLogger("Test", {
        logWarning: (message) => calls.push(["warn", message]),
        logError: (message) => calls.push(["error", message]),
    });
    logger.warn("one");
    logger.error("two");
    assert.deepEqual(calls, [["warn", "[Test] one"], ["error", "[Test] two"]]);
    const defaultName = Cinnamon.createLogger(null, {
        logWarning: (message) => calls.push(["warn", message]),
        logError: (message) => calls.push(["error", message]),
    });
    defaultName.warn("three");
    assert.match(calls.at(-1)[1], /^\[XPU Workload Manager\]/);
});

test("runtime gateway factory expands home and accepts a supplied detector", () => {
    const env = environment({"/home/tester/state.json": ""});
    const detections = [];
    const gateway = Cinnamon.createRuntimeGateway({
        path: "~/state.json",
        environment: env,
        clock: {now: () => NOW},
        logger: {warn() {}},
        deviceDetector: {
            detect(forceRefresh) {
                detections.push(forceRefresh);
                return {available: false};
            },
        },
    });
    assert.equal(readSnapshot(gateway).source, "probe");
    assert.equal(readSnapshot(gateway, {forceDeviceDetection: true}).source, "probe");
    assert.deepEqual(detections, [false, true]);
});

test("runtime gateway factory injects a supplied warning reporter port", () => {
    const reports = [];
    const gateway = Cinnamon.createRuntimeGateway({
        path: "~/failed.json",
        environment: environment({"/home/tester/failed.json": new Error("denied")}),
        clock: {now: () => NOW},
        warningReporter: {
            report: (key, message) => reports.push([key, message]),
            recover() {},
        },
        deviceDetector: {detect: () => ({available: false})},
    });

    assert.equal(readSnapshot(gateway).source, "error");
    assert.equal(reports.length, 1);
    assert.match(reports[0][1], /Could not read/);
});

test("runtime gateway factory composes through an injected snapshot validator port", () => {
    const document = JSON.stringify({
        version: 1,
        generatedAt: NOW,
        device: {available: true, name: "Coral USB", kind: "usb"},
        metrics: {load: 10, queueDepth: 0, runningProfiles: 1},
        profiles: {},
        alerts: [],
    });
    const candidates = [];
    const gateway = Cinnamon.createRuntimeGateway({
        path: "~/state.json",
        environment: environment({"/home/tester/state.json": document}),
        clock: {now: () => NOW},
        logger: {warn() {}},
        snapshotValidator: {
            validate(candidate) {
                candidates.push(candidate);
                return {valid: true, code: "accepted"};
            },
        },
    });

    assert.equal(readSnapshot(gateway).source, "runtime");
    assert.equal(candidates.length, 1);
    assert.equal(candidates[0].version, 1);
});

test("runtime control transport speaks the socket envelope", () => {
    const env = environment();
    let replyDocument = {status: "applied"};
    const trace = installControlSocket(env, () => ({result: replyDocument}));
    const completions = [];
    Cinnamon.sendRuntimeCommandText(
        JSON.stringify({commandId: "c-1"}),
        {cancellable: null},
        (...args) => completions.push(args),
        env,
    );
    assert.equal(trace.requests[0].method, Cinnamon.CONTROL_METHOD);
    assert.deepEqual(trace.requests[0].params, {commandId: "c-1"});
    assert.deepEqual(completions, [[null, JSON.stringify({status: "applied"})]]);

    const command = {
        version: 2,
        id: "command-1",
        issuedAt: NOW,
        expectedRevision: 0,
        operation: "set-paused",
        profileId: null,
        value: true,
    };
    replyDocument = {
        version: 2,
        commandId: command.id,
        status: "applied",
        revision: 1,
        appliedAt: NOW,
        message: "",
        portfolio: {paused: true, profiles: {}, deviceChoices: {}},
    };
    const gatewayCompletions = [];
    Cinnamon.createRuntimeControlGateway(env).send(
        command,
        (...args) => gatewayCompletions.push(args),
    );
    assert.equal(gatewayCompletions[0][1].status, "applied");

    // A transport failure reaches the caller rather than vanishing.
    env.Gio.SocketClient = class {
        set_timeout() {}

        connect_async(_address, _cancellable, callback) {
            callback(this, {});
        }

        connect_finish() {
            throw new Error("socket unavailable");
        }
    };
    Cinnamon.sendRuntimeCommandText(
        "{}", {cancellable: null}, (...args) => completions.push(args), env,
    );
    assert.match(completions.at(-1)[0].message, /unavailable/u);
});

test("the control service watch tracks the socket file and releases its monitor", () => {
    const env = environment();
    const handlers = [];
    let disconnected = null;
    let cancelled = 0;
    const monitor = {
        connect: (signal, handler) => {
            handlers.push({signal, handler});
            return 42;
        },
        disconnect: (id) => { disconnected = id; },
        cancel: () => { cancelled += 1; },
    };
    env.Gio.File = {
        new_for_path: (path) => ({
            path,
            monitor: () => monitor,
            query_exists: () => false,
        }),
    };
    env.Gio.FileMonitorFlags = {NONE: 0};
    env.Gio.FileMonitorEvent = {CREATED: 1, DELETED: 2};
    env.GLib.getenv = () => null;
    env.GLib.get_user_runtime_dir = () => "/run/user/1000";

    const reported = [];
    const unwatch = Cinnamon.createControlServiceWatch(env).watch((value) => reported.push(value));
    handlers[0].handler(null, null, null, env.Gio.FileMonitorEvent.CREATED);
    handlers[0].handler(null, null, null, env.Gio.FileMonitorEvent.DELETED);
    assert.deepEqual(reported, [false, true, false]);
    unwatch();
    assert.equal(disconnected, 42);
    assert.equal(cancelled, 1);
});

test("an environment without the file-monitor API reports nothing rather than absence", () => {
    const env = environment();
    env.GLib.getenv = () => null;
    env.GLib.get_user_runtime_dir = () => "/run/user/1000";
    delete env.Gio.File;
    assert.equal(Cinnamon.createControlServiceWatch(env).watch(() => {}), null);
    assert.equal(
        Cinnamon.createControlServiceWatch({
            Gio: {},
            GLib: {getenv: () => null, get_user_runtime_dir: () => "/run/user/1000"},
        }).watch(() => {}),
        null,
    );
});

test("user plug-in root resolves through the XDG data dir with a home fallback", () => {
    const env = environment();
    env.GLib.get_user_data_dir = () => "/home/tester/.xdg-data";
    assert.equal(
        Cinnamon.userWorkloadRoot(env, "uuid@example"),
        "/home/tester/.xdg-data/uuid@example/workloads",
    );
    delete env.GLib.get_user_data_dir;
    assert.equal(
        Cinnamon.userWorkloadRoot(env, "uuid@example"),
        "/home/tester/.local/share/uuid@example/workloads",
    );
});

test("user plug-in discovery isolates invalid plug-ins and unreadable roots", () => {
    const uuid = "cinnamon-xpuwlm@geraldo-netto";
    const root = `/home/tester/.local/share/${uuid}/workloads`;
    const env = environment({
        [root]: "",
        [`${root}/custom-workload/manifest.json`]: JSON.stringify(
            ManifestFixtures.validWorkloadManifest({id: "custom-workload"}),
        ),
        [`${root}/broken-workload/manifest.json`]: "{not json",
    });
    env.directoryNames = {[root]: ["custom-workload", "broken-workload"]};
    const warnings = [];
    const logger = {warn: (message) => warnings.push(message)};

    const registry = Cinnamon.createUserWorkloadRegistry(env, uuid, logger);
    assert.deepEqual(registry.descriptors().map((entry) => entry.id), ["custom-workload"]);
    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /broken-workload/u);

    const denied = environment({[root]: ""});
    denied.directoryNames = {[root]: ["custom-workload"]};
    const originalFactory = denied.Gio.File.new_for_path;
    denied.Gio.File.new_for_path = (path) => {
        const file = originalFactory(path);
        if (path === root) {
            file.enumerate_children = () => {
                throw new Error("enumeration denied");
            };
        }
        return file;
    };
    const unreadableWarnings = [];
    const unreadable = Cinnamon.createUserWorkloadRegistry(denied, uuid, {
        warn: (message) => unreadableWarnings.push(message),
    });
    assert.deepEqual(unreadable.descriptors(), []);
    assert.match(unreadableWarnings[0], /enumeration denied/u);
});

test("merged registry composition keeps bundled workloads authoritative", () => {
    const uuid = "cinnamon-xpuwlm@geraldo-netto";
    const userRoot = `/home/tester/.local/share/${uuid}/workloads`;
    const bundledManifest = ManifestFixtures.validWorkloadManifest({id: "sample-workload"});
    const env = environment({
        "/workloads": "",
        "/workloads/sample-workload/manifest.json": JSON.stringify(bundledManifest),
        [userRoot]: "",
        [`${userRoot}/sample-workload/manifest.json`]: JSON.stringify(
            ManifestFixtures.validWorkloadManifest({id: "sample-workload", version: "9.9.9"}),
        ),
        [`${userRoot}/custom-workload/manifest.json`]: JSON.stringify(
            ManifestFixtures.validWorkloadManifest({id: "custom-workload", ui: {
                ...bundledManifest.ui,
                order: bundledManifest.ui.order + 1,
            }}),
        ),
    }, [], ["sample-workload"]);
    env.directoryNames = {[userRoot]: ["sample-workload", "custom-workload"]};
    const warnings = [];
    const registry = Cinnamon.createMergedWorkloadRegistry({
        bundledRoot: "/workloads",
        environment: env,
        uuid,
        logger: {warn: (message) => warnings.push(message)},
    });
    const listed = registry.descriptors();
    assert.deepEqual(listed.map((entry) => entry.id), ["sample-workload", "custom-workload"]);
    assert.equal(listed[0].version, bundledManifest.version, "bundled wins the identity collision");
    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /shadowed/u);
});

test("the contract handshake sends empty params rather than an empty string", () => {
    // A service reading "" as a request body would be answering a different
    // question from the one asked, so the params travel empty.
    const description = {
        version: 1,
        methods: ["apply-command", "describe-contract"],
        schemas: {
            "runtime-command": 2,
            "runtime-acknowledgement": 2,
            "runtime-refusal": 1,
            "runtime-snapshot": 1,
        },
    };
    const env = environment();
    const trace = installControlSocket(env, () => ({result: description}));

    const completions = [];
    Cinnamon.requestRuntimeContractText(
        {cancellable: null},
        (...args) => completions.push(args),
        env,
    );

    assert.equal(trace.requests[0].method, Cinnamon.CONTRACT_METHOD);
    assert.deepEqual(trace.requests[0].params, {});
    assert.deepEqual(completions, [[null, JSON.stringify(description)]]);

    const gatewayCompletions = [];
    Cinnamon.createRuntimeContractGateway(env).describe(
        (...args) => gatewayCompletions.push(args),
    );
    assert.equal(gatewayCompletions[0][1].supports("describe-contract"), true);
});
