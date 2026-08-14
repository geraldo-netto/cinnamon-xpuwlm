"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const Cinnamon = require("../../files/cinnamon-xpuwlm@geraldo-netto/lib/cinnamon-runtime.js");
const {createAsyncDeviceEnvironment, detectAsync} = require("../helpers/async-device-environment.js");

test("NPU detection reads the accel node and maps known sysfs vendors", async () => {
    const cases = [
        ["0x8086", "Intel NPU"],
        ["0x1002", "AMD NPU"],
        ["0x1022", "AMD NPU"],
        ["0xdead", "NPU accelerator"],
    ];
    for (const [vendor, name] of cases) {
        const {environment} = createAsyncDeviceEnvironment({
            accel: [0],
            sysfsVendors: {"/sys/class/accel/accel0/device/vendor": vendor},
        });
        assert.deepEqual(await detectAsync(Cinnamon.detectNpuDeviceAsync, environment), {
            id: "npu-accel0",
            backend: "npu",
            available: true,
            name,
            kind: "accel",
            vendor,
            reason: "",
        }, vendor);
    }
});

test("GPU detection reads the render node and maps known sysfs vendors", async () => {
    const cases = [
        ["0x10de", "NVIDIA GPU"],
        ["0x1002", "AMD GPU"],
        ["0x8086", "Intel GPU"],
        ["0xbeef", "GPU (render node)"],
    ];
    for (const [vendor, name] of cases) {
        const {environment} = createAsyncDeviceEnvironment({
            dri: [128],
            sysfsVendors: {"/sys/class/drm/renderD128/device/vendor": vendor},
        });
        assert.deepEqual(await detectAsync(Cinnamon.detectGpuDeviceAsync, environment), {
            id: "gpu-renderD128",
            backend: "gpu",
            available: true,
            name,
            kind: "dri",
            vendor,
            reason: "",
        }, vendor);
    }
});

test("an unreadable vendor file never fails detection of a present node", async () => {
    const {environment} = createAsyncDeviceEnvironment({accel: [0]});
    const npu = await detectAsync(Cinnamon.detectNpuDeviceAsync, environment);
    assert.equal(npu.available, true);
    assert.equal(npu.name, "NPU accelerator");
    assert.equal(npu.vendor, "");
});

test("node scanning skips gaps up to the bounded maximum", async () => {
    const {environment} = createAsyncDeviceEnvironment({accel: [3]});
    const npu = await detectAsync(Cinnamon.detectNpuDeviceAsync, environment);
    assert.equal(npu.id, "npu-accel3");

    const beyond = createAsyncDeviceEnvironment({accel: [Cinnamon.MAX_ACCEL_DEVICES]}).environment;
    assert.equal(await detectAsync(Cinnamon.detectNpuDeviceAsync, beyond), null);

    const gpuGap = createAsyncDeviceEnvironment({dri: [130]}).environment;
    assert.equal((await detectAsync(Cinnamon.detectGpuDeviceAsync, gpuGap)).id, "gpu-renderD130");
    const gpuBeyond = createAsyncDeviceEnvironment({dri: [128 + Cinnamon.MAX_RENDER_DEVICES]}).environment;
    assert.equal(await detectAsync(Cinnamon.detectGpuDeviceAsync, gpuBeyond), null);
});

test("combined detection returns entries in tpu, npu, gpu order", async () => {
    const {environment} = createAsyncDeviceEnvironment({
        pcie: [0],
        accel: [0],
        dri: [128],
        sysfsVendors: {
            "/sys/class/accel/accel0/device/vendor": "0x8086",
            "/sys/class/drm/renderD128/device/vendor": "0x10de",
        },
    });
    const devices = await detectAsync(Cinnamon.detectDevicesAsync, environment);
    assert.deepEqual(devices.map((device) => [device.backend, device.id]), [
        ["tpu", "tpu-pcie-0"],
        ["npu", "npu-accel0"],
        ["gpu", "gpu-renderD128"],
    ]);
});

test("combined detection reports partial fleets and total absence", async () => {
    const gpuOnly = createAsyncDeviceEnvironment({
        dri: [128],
        sysfsVendors: {"/sys/class/drm/renderD128/device/vendor": "0x1002"},
    }).environment;
    const devices = await detectAsync(Cinnamon.detectDevicesAsync, gpuOnly);
    assert.equal(devices.length, 1);
    assert.equal(devices[0].backend, "gpu");
    assert.equal(devices[0].name, "AMD GPU");

    assert.deepEqual(await detectAsync(Cinnamon.detectDevicesAsync, createAsyncDeviceEnvironment().environment), []);
});

function failingAt(environment, prefix) {
    const original = environment.Gio.File.new_for_path;
    environment.Gio.File.new_for_path = (path) => {
        if (path.startsWith(prefix)) {
            return {query_info_async() { throw new Error(`denied: ${path}`); }};
        }
        return original(path);
    };
}

test("a denied vendor read degrades to the generic label instead of failing", async () => {
    const {environment} = createAsyncDeviceEnvironment({accel: [0]});
    const original = environment.Gio.File.new_for_path;
    environment.Gio.File.new_for_path = (path) => {
        if (path.startsWith("/sys/class/accel")) {
            return {
                query_info_async(attributes, flags, priority, cancellable, callback) { callback(this, {}); },
                query_info_finish() { throw new Error(`denied: ${path}`); },
            };
        }
        return original(path);
    };
    const npu = await detectAsync(Cinnamon.detectNpuDeviceAsync, environment);
    assert.equal(npu.available, true);
    assert.equal(npu.name, "NPU accelerator");
    assert.equal(npu.vendor, "");
});

test("a failing backend probe fails the combined detection loudly", async () => {
    const tpuDenied = createAsyncDeviceEnvironment().environment;
    failingAt(tpuDenied, "/dev/apex_");
    await assert.rejects(() => detectAsync(Cinnamon.detectDevicesAsync, tpuDenied), /denied/u);

    const npuDenied = createAsyncDeviceEnvironment().environment;
    failingAt(npuDenied, "/dev/accel/");
    await assert.rejects(() => detectAsync(Cinnamon.detectDevicesAsync, npuDenied), /denied/u);

    const gpuDenied = createAsyncDeviceEnvironment().environment;
    failingAt(gpuDenied, "/dev/dri/");
    await assert.rejects(() => detectAsync(Cinnamon.detectDevicesAsync, gpuDenied), /denied/u);
});

test("the cached detector serves the full multi-backend array from cache", async () => {
    const now = 1_700_000_000_000;
    const {environment} = createAsyncDeviceEnvironment({pcie: [0], accel: [0]});
    const detector = new Cinnamon.CachedDeviceDetector(environment, {now: () => now});
    const read = (options) => new Promise((resolve, reject) => detector.detect(false, options, (error, devices) => {
        if (error) { reject(error); } else { resolve(devices); }
    }));
    const first = await read(undefined);
    assert.deepEqual(first.map((device) => device.backend), ["tpu", "npu"]);
    const second = await read({});
    assert.deepEqual(second, first);
    assert.notEqual(second, first);
});
