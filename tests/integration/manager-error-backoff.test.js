"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const Manager = require("../../files/cinnamon-xpuwlm@geraldo-netto/lib/manager.js");
const BuiltIns = require("../helpers/built-in-workloads.js");
const FailureBackoff = require("../../files/cinnamon-xpuwlm@geraldo-netto/lib/failure-log-backoff.js");
const Runtime = require("../../files/cinnamon-xpuwlm@geraldo-netto/lib/runtime-gateway.js");
const RuntimeSchema = require("../../files/cinnamon-xpuwlm@geraldo-netto/lib/runtime-snapshot-schema-validator.js");

const NOW = 1_700_000_000_000;

test("manager polling integrates runtime state with bounded render failures", () => {
    let nowMs = NOW;
    const errors = [];
    const warningReporter = new FailureBackoff.FailureWarningBackoff({logger: {warn() {}}});
    const gateway = new Runtime.RuntimeSnapshotGateway({
        path: "/run/xpuwlm.json",
        clock: {now: () => nowMs},
        readTextAsync: (filename, options, callback) => callback(null, ""),
        detectDevice: () => [{id: "tpu-usb", backend: "tpu", available: true, name: "TPU", kind: "usb"}],
        snapshotValidator: new RuntimeSchema.RuntimeSnapshotSchemaValidator(),
        warningReporter,
    });
    const logger = {warn() {}, error: (message) => errors.push(message)};
    const manager = new Manager.WorkloadManager({
        workloadRegistry: BuiltIns.coreRegistry(),
        repository: {load: () => ({}), save() {}},
        runtimeGateway: gateway,
        clock: {now: () => nowMs},
        errorReporter: new FailureBackoff.FailureErrorBackoff({logger}),
        logger,
    });
    let healthyDeliveries = 0;
    manager.subscribe(() => { throw new Error("view unavailable"); });
    manager.subscribe((state) => {
        assert.equal(state.device.available, true);
        healthyDeliveries += 1;
    });

    manager.start();
    for (let poll = 0; poll < 100; poll += 1) {
        manager.refresh();
    }
    assert.equal(healthyDeliveries, 101);
    assert.equal(errors.length, 1);
    nowMs += FailureBackoff.FAILURE_INITIAL_DELAY_MS;
    manager.refresh();
    assert.equal(healthyDeliveries, 102);
    assert.equal(errors.length, 2);
});
