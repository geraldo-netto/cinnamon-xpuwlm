"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const Cinnamon = require("../../files/cinnamon-tpuwm@geraldo-netto/lib/cinnamon-runtime.js");
const Runtime = require("../../files/cinnamon-tpuwm@geraldo-netto/lib/runtime-gateway.js");
const {readSnapshot} = require("../helpers/fakes.js");

const NOW = 1_700_000_000_000;

class FakeFile {
    constructor(path, env) {
        this.path = path;
        this.environment = env;
    }

    query_exists() {
        return this.environment.existing.has(this.path);
    }

    query_info() {
        const value = this.environment.files.get(this.path);
        const size = typeof value === "string" ? new TextEncoder().encode(value).byteLength : 0;
        return {get_size: () => size};
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
        const names = (this.path === "/workloads"
            ? this.environment.workloadNames
            : this.environment.usbNames).slice();
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
        ByteArray: {toString: (bytes) => String(bytes)},
        Gio: {
            File: {new_for_path: (path) => new FakeFile(path, env)},
            FileQueryInfoFlags: {NOFOLLOW_SYMLINKS: 1},
            IOErrorEnum: {NOT_FOUND: 1, CANCELLED: 19},
            FileType: {REGULAR: 1, DIRECTORY: 2},
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
            accelerator: "edge-tpu",
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
    assert.deepEqual(repository.load(), {portfolio: values["profile-state"], selectedTab: "overview"});
    repository.save({portfolio: values["profile-state"], selectedTab: "overview"});
    assert.equal(writes.length, 0);
    repository.save({portfolio: {paused: true, profiles: {}}, selectedTab: "alerts"});
    assert.deepEqual(writes, ["profile-state", "selected-tab"]);
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
    notifications.notify({summary: "TPU critical alert", body: "Voltage drift"});
    assert.deepEqual(shown, [["TPU critical alert", "Voltage drift"]]);
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
    assert.match(calls.at(-1)[1], /^\[TPU Workload Manager\]/);
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

test("runtime control transport calls the versioned D-Bus endpoint", () => {
    const calls = [];
    let replyText = "ack";
    const env = environment();
    env.Gio.DBusCallFlags = {NONE: 0};
    env.Gio.DBus = {session: {
        call(...args) {
            calls.push(args);
            args.at(-1)({call_finish: () => ({deep_unpack: () => [replyText]})}, {});
        },
    }};
    env.GLib.Variant = class { constructor(signature, values) { this.signature = signature; this.values = values; } };
    env.GLib.VariantType = class { constructor(signature) { this.signature = signature; } };
    const completions = [];
    Cinnamon.sendRuntimeCommandText("command", {cancellable: null}, (...args) => completions.push(args), env);
    assert.deepEqual(calls[0].slice(0, 4), [
        Cinnamon.CONTROL_BUS_NAME,
        Cinnamon.CONTROL_OBJECT_PATH,
        Cinnamon.CONTROL_INTERFACE,
        Cinnamon.CONTROL_METHOD,
    ]);
    assert.equal(calls[0][4].values[0], "command");
    assert.equal(calls[0][7], Cinnamon.CONTROL_TIMEOUT_MS);
    assert.deepEqual(completions, [[null, "ack"]]);
    const command = {
        version: 1,
        id: "command-1",
        issuedAt: NOW,
        expectedRevision: 0,
        operation: "set-paused",
        profileId: null,
        value: true,
    };
    replyText = JSON.stringify({
        version: 1,
        commandId: command.id,
        status: "applied",
        revision: 1,
        appliedAt: NOW,
        message: "",
        portfolio: {paused: true, profiles: {}},
    });
    const gatewayCompletions = [];
    Cinnamon.createRuntimeControlGateway(env).send(
        command,
        (...args) => gatewayCompletions.push(args),
    );
    assert.equal(gatewayCompletions[0][1].status, "applied");

    env.Gio.DBus.session.call = (...args) => args.at(-1)({
        call_finish() { throw new Error("bus unavailable"); },
    }, {});
    Cinnamon.sendRuntimeCommandText("command", {cancellable: null}, (...args) => completions.push(args), env);
    assert.match(completions.at(-1)[0].message, /unavailable/u);
});
