"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const Domain = require("../../files/cinnamon-xpuwlm@geraldo-netto/lib/domain.js");

function tpuEntry(overrides = {}) {
    return {
        id: "tpu-usb",
        backend: "tpu",
        available: true,
        name: "Coral USB",
        kind: "usb",
        reason: "",
        ...overrides,
    };
}

test("BACKENDS is the frozen tpu > npu > gpu hierarchy without CPU", () => {
    assert.deepEqual(Domain.BACKENDS, ["tpu", "npu", "gpu"]);
    assert.ok(Object.isFrozen(Domain.BACKENDS));
});

test("normalizeDeviceEntry keeps a valid entry and fills every field", () => {
    assert.deepEqual(
        Domain.normalizeDeviceEntry(tpuEntry({vendor: "0x18d1", load: 37.5})),
        {
            id: "tpu-usb",
            backend: "tpu",
            available: true,
            state: "present",
            name: "Coral USB",
            kind: "usb",
            vendor: "0x18d1",
            load: 37.5,
            reason: "",
        },
    );
});

test("normalizeDeviceEntry rejects non-objects and unknown backends", () => {
    assert.equal(Domain.normalizeDeviceEntry(null), null);
    assert.equal(Domain.normalizeDeviceEntry([]), null);
    assert.equal(Domain.normalizeDeviceEntry(tpuEntry({backend: "cpu"})), null);
    assert.equal(Domain.normalizeDeviceEntry(tpuEntry({backend: "edge-tpu"})), null);
});

test("normalizeDeviceEntry falls back per field", () => {
    const entry = Domain.normalizeDeviceEntry(
        {backend: "gpu", available: false, kind: "weird", load: 250},
        3,
    );
    assert.deepEqual(entry, {
        id: "device-3",
        backend: "gpu",
        available: false,
        state: "absent",
        name: "GPU accelerator",
        kind: "unknown",
        vendor: "",
        load: 100,
        reason: "Device unavailable",
    });
    assert.equal(Domain.normalizeDeviceEntry({backend: "npu", available: true}).load, null);
});

test("normalizeDevices drops invalid entries, dedupes ids first-wins, caps at MAX_DEVICES", () => {
    const first = tpuEntry();
    const duplicate = tpuEntry({name: "Impostor"});
    const invalid = tpuEntry({backend: "cpu"});
    const npu = tpuEntry({id: "npu-accel0", backend: "npu", kind: "accel"});
    const devices = Domain.normalizeDevices([first, "junk", duplicate, invalid, npu]);
    assert.deepEqual(devices.map((device) => device.id), ["tpu-usb", "npu-accel0"]);
    assert.equal(devices[0].name, "Coral USB");

    const flood = Array.from({length: 40}, (_, index) => tpuEntry({id: `tpu-${index}`}));
    assert.equal(Domain.normalizeDevices(flood).length, Domain.MAX_DEVICES);
    assert.deepEqual(Domain.normalizeDevices("not-an-array"), []);
});

test("aggregateDevice selects the first available device in hierarchy order", () => {
    const gpu = tpuEntry({id: "gpu-renderD128", backend: "gpu", kind: "dri"});
    const npu = tpuEntry({id: "npu-accel0", backend: "npu", kind: "accel"});
    const absentTpu = tpuEntry({available: false, reason: "Unplugged"});
    const aggregate = Domain.aggregateDevice(Domain.normalizeDevices([gpu, npu, absentTpu]));
    assert.equal(aggregate.id, "npu-accel0");
    assert.equal(aggregate.backend, "npu");
    assert.equal(aggregate.available, true);
});

test("aggregateDevice reports absent when every device is absent", () => {
    const devices = Domain.normalizeDevices([
        tpuEntry({available: false, reason: "Unplugged"}),
        tpuEntry({id: "gpu-renderD128", backend: "gpu", available: false, reason: "Driver missing"}),
    ]);
    assert.deepEqual(Domain.aggregateDevice(devices), {
        id: null,
        backend: null,
        available: false,
        state: "absent",
        name: "No accelerator detected",
        kind: "unknown",
        vendor: "",
        load: null,
        reason: "Unplugged",
    });
    assert.equal(Domain.aggregateDevice(devices, "All probes failed").reason, "All probes failed");
});

test("aggregateDevice reports unknown for an empty or invalid list", () => {
    const aggregate = Domain.aggregateDevice([], "Monitoring has not started");
    assert.equal(aggregate.state, "unknown");
    assert.equal(aggregate.name, "Accelerator state unknown");
    assert.equal(aggregate.reason, "Monitoring has not started");
    assert.equal(Domain.aggregateDevice("junk").state, "unknown");
});
