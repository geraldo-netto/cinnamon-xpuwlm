"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const Cinnamon = require("../../lib/cinnamon-runtime.js");
const Runtime = require("../../lib/runtime-gateway.js");

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
    const uncached = new Cinnamon.CachedDeviceDetector(env, {now: () => now}, "invalid");
    uncached.detect();
    uncached.detect();
    assert.equal(probes, 5);
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
    let detections = 0;
    const gateway = Cinnamon.createRuntimeGateway({
        path: "~/state.json",
        environment: env,
        clock: {now: () => NOW},
        logger: {warn() {}},
        deviceDetector: {detect() { detections += 1; return {available: false}; }},
    });
    assert.equal(gateway.read().source, "probe");
    assert.equal(detections, 1);
});
