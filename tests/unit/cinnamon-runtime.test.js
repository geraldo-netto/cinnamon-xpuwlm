"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const Cinnamon = require("../../files/cinnamon-tpuwm@geraldo-netto/lib/cinnamon-runtime.js");
const Runtime = require("../../files/cinnamon-tpuwm@geraldo-netto/lib/runtime-gateway.js");

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

    enumerate_children() {
        const names = this.environment.usbNames.slice();
        let index = 0;
        return {
            next_file() {
                if (index >= names.length) {
                    return null;
                }
                const name = names[index];
                index += 1;
                return {get_name: () => name};
            },
            close: () => { this.environment.closed = true; },
        };
    }
}

function environment(files = {}, usbNames = []) {
    const env = {
        files: new Map(Object.entries(files)),
        existing: new Set(Object.keys(files)),
        usbNames,
        closed: false,
        ByteArray: {toString: (bytes) => String(bytes)},
        Gio: {
            File: {new_for_path: (path) => new FakeFile(path, env)},
            FileQueryInfoFlags: {NOFOLLOW_SYMLINKS: 1},
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
        /exceeds 1 MiB/,
    );
});

test("PCIe detection uses the first available accelerator", () => {
    assert.equal(Cinnamon.detectPcieDevice(environment()), null);
    const first = Cinnamon.detectPcieDevice(environment({"/dev/apex_0": ""}));
    assert.equal(first.name, "Coral PCIe Edge TPU");
    const second = Cinnamon.detectPcieDevice(environment({"/dev/apex_1": ""}));
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

test("USB detection normalizes Coral identifiers and always closes enumeration", () => {
    const root = "/sys/bus/usb/devices";
    const foundEnv = environment({
        [root]: "",
        [`${root}/1/idVendor`]: "18D1\n",
        [`${root}/1/idProduct`]: "9302\n",
    }, ["1"]);
    const runtimeDevice = Cinnamon.detectUsbDevice(foundEnv);
    assert.equal(runtimeDevice.available, true);
    assert.equal(runtimeDevice.kind, "usb");
    assert.equal(foundEnv.closed, true);

    const dfuEnv = environment({
        [root]: "",
        [`${root}/2/idVendor`]: "  1A6E\n",
        [`${root}/2/idProduct`]: "089A\n",
    }, ["2"]);
    const dfuDevice = Cinnamon.detectUsbDevice(dfuEnv);
    assert.equal(dfuDevice.available, true);
    assert.equal(dfuDevice.name, "Coral USB Accelerator (DFU)");
    assert.equal(dfuEnv.closed, true);

    const otherEnv = environment({
        [root]: "",
        [`${root}/3/idVendor`]: "ffff",
        [`${root}/3/idProduct`]: "9302",
    }, ["3"]);
    assert.equal(Cinnamon.detectUsbDevice(otherEnv), null);
    assert.equal(otherEnv.closed, true);
    assert.equal(Cinnamon.detectUsbDevice(environment()), null);
});

test("combined detection prioritizes PCIe, then USB, then an actionable fallback", () => {
    const pcie = Cinnamon.detectDevice(environment({"/dev/apex_0": ""}));
    assert.equal(pcie.kind, "pcie");
    const root = "/sys/bus/usb/devices";
    const usb = Cinnamon.detectDevice(environment({
        [root]: "",
        [`${root}/1/idVendor`]: Cinnamon.USB_VENDOR,
        [`${root}/1/idProduct`]: Cinnamon.USB_PRODUCT,
    }, ["1"]));
    assert.equal(usb.kind, "usb");
    const absent = Cinnamon.detectDevice(environment());
    assert.equal(absent.available, false);
    assert.match(absent.reason, /Connect/);
});

test("cached detector respects TTL and supports invalidation", () => {
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
    const first = detector.detect();
    first.name = "mutated";
    assert.equal(detector.detect().name, "Coral PCIe Edge TPU");
    assert.equal(probes, 1);
    now += 100;
    detector.detect();
    assert.equal(probes, 2);
    detector.invalidate();
    detector.detect();
    assert.equal(probes, 3);
    detector.detect(true);
    assert.equal(probes, 4);
    detector.detect(false);
    assert.equal(probes, 4);
    const uncached = new Cinnamon.CachedDeviceDetector(env, {now: () => now}, "invalid");
    uncached.detect();
    uncached.detect();
    assert.equal(probes, 6);
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
    assert.equal(gateway.read().source, "probe");
    assert.equal(gateway.read({forceDeviceDetection: true}).source, "probe");
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

    assert.equal(gateway.read().source, "error");
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

    assert.equal(gateway.read().source, "runtime");
    assert.equal(candidates.length, 1);
    assert.equal(candidates[0].version, 1);
});
