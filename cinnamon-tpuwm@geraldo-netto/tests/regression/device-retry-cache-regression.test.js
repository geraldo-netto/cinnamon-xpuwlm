"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const Cinnamon = require("../../lib/cinnamon-runtime.js");
const Manager = require("../../lib/manager.js");
const Runtime = require("../../lib/runtime-gateway.js");

function mutableDeviceEnvironment() {
    let connected = false;
    return {
        environment: {
            Gio: {
                File: {
                    new_for_path(path) {
                        return {
                            query_exists: () => connected && path === "/dev/apex_0",
                        };
                    },
                },
            },
        },
        setConnected(value) {
            connected = value;
        },
    };
}

test("regression: explicit retry bypasses a cached unavailable device result", () => {
    const clock = {now: () => 1_700_000_000_000};
    const device = mutableDeviceEnvironment();
    const detector = new Cinnamon.CachedDeviceDetector(device.environment, clock, 10_000);
    const gateway = new Runtime.RuntimeSnapshotGateway({
        clock,
        path: "/missing/runtime.json",
        readText: () => null,
        detectDevice: (forceRefresh) => detector.detect(forceRefresh),
    });
    const manager = new Manager.WorkloadManager({
        clock,
        repository: {load: () => ({}), save() {}},
        runtimeGateway: gateway,
    });

    manager.start();
    assert.equal(manager.state().device.available, false);
    device.setConnected(true);
    assert.equal(manager.refresh().device.available, false);
    assert.equal(manager.retryDeviceDetection().device.available, true);
    assert.equal(manager.state().device.name, "Coral PCIe Edge TPU");
});
