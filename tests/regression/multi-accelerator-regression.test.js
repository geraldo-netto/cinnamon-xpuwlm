"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const Domain = require("../../files/cinnamon-tpuwm@geraldo-netto/lib/domain.js");
const BuiltIns = require("../helpers/built-in-workloads.js");
const Manager = require("../../files/cinnamon-tpuwm@geraldo-netto/lib/manager.js");
const ViewModel = require("../../files/cinnamon-tpuwm@geraldo-netto/lib/view-model.js");

const NOW = 1_700_000_000_000;

function managerWith(snapshot) {
    const manager = new Manager.WorkloadManager({
        workloadRegistry: BuiltIns.coreRegistry(),
        repository: {load: () => ({}), save() {}},
        runtimeGateway: {read: (options, callback) => callback(snapshot)},
        errorReporter: {report() {}, recover() {}},
        clock: {now: () => NOW},
    });
    manager.start();
    return manager;
}

function entry(overrides = {}) {
    return {
        id: "tpu-usb",
        backend: "tpu",
        available: true,
        name: "Coral USB",
        kind: "usb",
        ...overrides,
    };
}

test("regression: primary selection follows the tpu > npu > gpu hierarchy", () => {
    const gpu = entry({id: "gpu-renderD128", backend: "gpu", name: "NVIDIA GPU", kind: "dri", load: 12});
    const npu = entry({id: "npu-accel0", backend: "npu", name: "Intel NPU", kind: "accel", load: 3});

    const gpuOnly = managerWith(Domain.probeSnapshot([gpu], NOW));
    const gpuModel = ViewModel.toViewModel(gpuOnly.state(), NOW);
    assert.equal(gpuModel.panel.label, "GPU Detected");
    assert.equal(gpuModel.device.backend, "gpu");
    gpuOnly.dispose();

    const both = managerWith(Domain.probeSnapshot([gpu, npu], NOW));
    const bothModel = ViewModel.toViewModel(both.state(), NOW);
    assert.equal(bothModel.device.backend, "npu");
    assert.deepEqual(bothModel.devices.map((device) => device.backendText), ["NPU", "GPU"]);
    both.dispose();
});

test("regression: total accelerator absence still reaches the unavailable screen", () => {
    const manager = managerWith(Domain.probeSnapshot([], NOW));
    const model = ViewModel.toViewModel(manager.state(), NOW);
    assert.equal(model.screen, "unavailable");
    assert.equal(model.panel.status, "unavailable");
    assert.deepEqual(model.devices, []);
    manager.dispose();
});

test("regression: the load tile is labelled by the serving backend", () => {
    const snapshot = Domain.normalizeSnapshot({
        version: 1,
        generatedAt: NOW,
        devices: [entry({id: "gpu-renderD128", backend: "gpu", name: "AMD GPU", kind: "dri", load: 55})],
        metrics: {queueDepth: 1, runningProfiles: 0},
        profiles: {},
        alerts: [],
    }, NOW, Domain.DEFAULT_STALE_AFTER_MS, BuiltIns.coreCatalog());
    const manager = managerWith(snapshot);
    const model = ViewModel.toViewModel(manager.state(), NOW);
    assert.equal(model.metrics[0].label, "GPU load");
    assert.equal(model.metrics[0].value, "55%");
    assert.equal(model.panel.label, "GPU 55%");
    manager.dispose();
});

test("regression: device rows report absent hardware without inventing load", () => {
    const models = ViewModel.deviceModels({
        devices: [
            entry({id: "gpu-renderD128", backend: "gpu", available: false, reason: "Driver missing"}),
            entry({id: "tpu-usb", backend: "tpu", load: 40}),
        ],
    });
    assert.deepEqual(models.map((model) => [model.backendText, model.statusText, model.loadText]), [
        ["TPU", "Available", "40%"],
        ["GPU", "Absent", "—"],
    ]);
    assert.deepEqual(ViewModel.deviceModels({}), []);
    const ordered = ViewModel.deviceModels({
        devices: [
            entry({id: "gpu-b", backend: "gpu"}),
            entry({id: "mystery", backend: "future"}),
            entry({id: "gpu-a", backend: "gpu"}),
        ],
    });
    assert.deepEqual(ordered.map((model) => model.id), ["gpu-a", "gpu-b", "mystery"]);
    assert.equal(ViewModel.backendLabel(null), "Accel");
    assert.equal(ViewModel.backendLabel({backend: "future"}), "Accel");
});
