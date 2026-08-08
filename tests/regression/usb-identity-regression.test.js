"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const Cinnamon = require("../../files/cinnamon-tpuwm@geraldo-netto/lib/cinnamon-runtime.js");

const USB_ROOT = "/sys/bus/usb/devices";

function usbEnvironment(vendor, product) {
    const files = new Map([
        [USB_ROOT, ""],
        [`${USB_ROOT}/1/idVendor`, vendor],
        [`${USB_ROOT}/1/idProduct`, product],
    ]);
    let yielded = false;
    const environment = {
        closed: false,
        ByteArray: {toString: (bytes) => String(bytes)},
        Gio: {
            File: {
                new_for_path(path) {
                    return {
                        query_exists: () => files.has(path),
                        enumerate_children() {
                            return {
                                next_file() {
                                    if (yielded) {
                                        return null;
                                    }
                                    yielded = true;
                                    return {get_name: () => "1"};
                                },
                                close: () => { environment.closed = true; },
                            };
                        },
                    };
                },
            },
            FileQueryInfoFlags: {NOFOLLOW_SYMLINKS: 1},
        },
        GLib: {
            file_get_contents: (path) => [true, files.get(path)],
        },
    };
    return environment;
}

test("regression: Coral USB runtime and DFU identities cannot be cross-paired", () => {
    const cases = [
        ["18d1", "9302", "Coral USB Accelerator"],
        ["1a6e", "089a", "Coral USB Accelerator (DFU)"],
        ["18d1", "089a", null],
        ["1a6e", "9302", null],
    ];

    for (const [vendor, product, expectedName] of cases) {
        const environment = usbEnvironment(vendor, product);
        const device = Cinnamon.detectUsbDevice(environment);
        assert.equal(device && device.name, expectedName);
        assert.equal(environment.closed, true);
    }
});
