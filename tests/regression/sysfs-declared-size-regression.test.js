"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const Cinnamon = require("../../files/cinnamon-tpuwm@geraldo-netto/lib/cinnamon-runtime.js");
const {createGioEnvironment} = require("../helpers/fakes.js");
const {createAsyncDeviceEnvironment, detectAsync} = require("../helpers/async-device-environment.js");

// Sysfs attribute files declare st_size 4096 regardless of content. The
// bounded id reads must truncate instead of rejecting, while the snapshot
// read path keeps its strict declared-size gate.

function sysfsLikeEnvironment() {
    return createGioEnvironment({
        "/sys/vendorfile": {contents: "0x1002\n", inode: 3, device: 1, size: 4096},
    });
}

test("regression: a page-sized sysfs declaration does not fail a bounded id read", () => {
    const seen = [];
    Cinnamon.readFileTextAsync(
        "/sys/vendorfile",
        sysfsLikeEnvironment(),
        {maximumBytes: 32, truncateOversize: true},
        (error, text) => seen.push([error, text]),
    );
    assert.equal(seen.length, 1);
    assert.equal(seen[0][0], null);
    assert.equal(seen[0][1], "0x1002\n");
});

test("regression: the snapshot path still rejects an oversize declaration", () => {
    const seen = [];
    Cinnamon.readFileTextAsync(
        "/sys/vendorfile",
        sysfsLikeEnvironment(),
        {maximumBytes: 32},
        (error, text) => seen.push([error, text]),
    );
    assert.equal(seen.length, 1);
    assert.match(String(seen[0][0]), /exceeds/u);
    assert.equal(seen[0][1], null);
});

test("regression: USB identity detection survives page-sized sysfs declarations", async () => {
    const {environment} = createAsyncDeviceEnvironment({
        usb: [{name: "1-1", vendor: Cinnamon.USB_VENDOR, product: Cinnamon.USB_PRODUCT}],
    });
    const device = await detectAsync(Cinnamon.detectUsbDeviceAsync, environment);
    assert.notEqual(device, null);
    assert.equal(device.kind, "usb");
    assert.equal(device.name, "Coral USB Accelerator");
});

test("regression: GPU vendor naming survives page-sized sysfs declarations", async () => {
    const {environment} = createAsyncDeviceEnvironment({
        dri: [128],
        sysfsVendors: {"/sys/class/drm/renderD128/device/vendor": "0x1002"},
    });
    const device = await detectAsync(Cinnamon.detectGpuDeviceAsync, environment);
    assert.equal(device.name, "AMD GPU");
    assert.equal(device.vendor, "0x1002");
});
