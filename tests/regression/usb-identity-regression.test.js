"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const Cinnamon = require("../../files/cinnamon-tpuwm@geraldo-netto/lib/cinnamon-runtime.js");
const {createAsyncDeviceEnvironment, detectAsync} = require("../helpers/async-device-environment.js");

test("regression: Coral USB runtime and DFU identities cannot be cross-paired", async () => {
    const cases = [
        ["18d1", "9302", "Coral USB Accelerator"],
        ["1a6e", "089a", "Coral USB Accelerator (DFU)"],
        ["18d1", "089a", null],
        ["1a6e", "9302", null],
    ];

    for (const [vendor, product, expectedName] of cases) {
        const environment = createAsyncDeviceEnvironment({usb: [{vendor, product}]}).environment;
        const device = await detectAsync(Cinnamon.detectUsbDeviceAsync, environment);
        assert.equal(device && device.name, expectedName);
        assert.equal(environment.closed, true);
    }
});
