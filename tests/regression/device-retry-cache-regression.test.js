"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const Cinnamon = require("../../files/cinnamon-xpuwlm@geraldo-netto/lib/cinnamon-runtime.js");
const BuiltIns = require("../helpers/built-in-workloads.js");
const FailureBackoff = require("../../files/cinnamon-xpuwlm@geraldo-netto/lib/failure-log-backoff.js");
const Manager = require("../../files/cinnamon-xpuwlm@geraldo-netto/lib/manager.js");
const Runtime = require("../../files/cinnamon-xpuwlm@geraldo-netto/lib/runtime-gateway.js");
const RuntimeSchema = require("../../files/cinnamon-xpuwlm@geraldo-netto/lib/runtime-snapshot-schema-validator.js");
const {createAsyncDeviceEnvironment} = require("../helpers/async-device-environment.js");

function mutableDeviceEnvironment() {
    const harness = createAsyncDeviceEnvironment();
    return {
        environment: harness.environment,
        setConnected(value) {
            if (value) {
                harness.pciePaths.add("/dev/apex_0");
            } else {
                harness.pciePaths.delete("/dev/apex_0");
            }
        },
    };
}

test("regression: explicit retry bypasses a cached unavailable device result", () => {
    const clock = {now: () => 1_700_000_000_000};
    const device = mutableDeviceEnvironment();
    const detector = new Cinnamon.CachedDeviceDetector(device.environment, clock, 10_000);
    const logger = {warn() {}, error() {}};
    const gateway = new Runtime.RuntimeSnapshotGateway({
        clock,
        path: "/missing/runtime.json",
        readTextAsync: (filename, options, callback) => callback(null, null),
        detectDevice: (forceRefresh, options, callback) => detector.detect(
            forceRefresh, options, callback,
        ),
        snapshotValidator: new RuntimeSchema.RuntimeSnapshotSchemaValidator(),
        warningReporter: new FailureBackoff.FailureWarningBackoff({logger}),
    });
    const manager = new Manager.WorkloadManager({
        workloadRegistry: BuiltIns.coreRegistry(),
        clock,
        repository: {load: () => ({}), save() {}},
        runtimeGateway: gateway,
        errorReporter: new FailureBackoff.FailureErrorBackoff({logger}),
    });

    manager.start();
    assert.equal(manager.state().device.available, false);
    device.setConnected(true);
    manager.refresh();
    assert.equal(manager.state().device.available, false);
    manager.retryDeviceDetection();
    assert.equal(manager.state().device.available, true);
    assert.equal(manager.state().device.name, "Coral PCIe Edge TPU");
});
