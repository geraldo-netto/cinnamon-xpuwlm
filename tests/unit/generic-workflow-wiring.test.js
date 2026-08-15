"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const Manifest = require("../../files/cinnamon-xpuwlm@geraldo-netto/lib/workload-manifest.js");
const Wiring = require("../../files/cinnamon-xpuwlm@geraldo-netto/lib/workflow-wiring.js");
const Fixtures = require("../helpers/workload-manifest-fixtures.js");

function descriptor({id, executable = true}) {
    const manifest = Fixtures.validWorkloadManifest();
    manifest.id = id;
    manifest.capabilities = [id];
    manifest.requirements.accelerator = "gpu";
    manifest.requirements.acceleratorPreference = ["gpu"];
    manifest.requirements.model = executable
        ? {...manifest.requirements.model, format: "ncnn", fullyQuantized: false}
        : null;
    return new Manifest.WorkloadDescriptor(manifest);
}

function stubGateway() {
    return {
        submit(_request, callback) {
            callback(null, {status: "accepted", jobId: "job-1", message: ""});
        },
        requestResult() {},
        cancelJob(_request, callback) {
            callback(null, {});
        },
        cancel() {},
    };
}

test("a profile's definition is projected from the manifest it already ships", () => {
    const profile = descriptor({id: "hardware-health"}).profileDefinition();
    const definition = Wiring.genericDefinition(profile);

    assert.equal(definition.id, profile.id);
    assert.equal(definition.title, profile.title);
    assert.equal(definition.description, profile.description);
    assert.equal(definition.reviewOnly, true, "a generic run never acts on the system");
    assert.equal(definition.consentPurpose, "", "a local profile run asks for nothing extra");
    assert.notEqual(definition.retentionText, "");
});

test("the submission a generic run sends is the runtime's own job contract", () => {
    const build = Wiring.genericRequestBuilder("hardware-health");
    const request = build("xpuwlm-hardware-health-1-1");

    assert.equal(request.workloadId, "hardware-health");
    assert.equal(request.requestId, "xpuwlm-hardware-health-1-1");
    assert.deepEqual(request.payload, {});
    assert.throws(() => Wiring.genericRequestBuilder("Not An Id")("bad request id"), /invalid/u);
});

test("only executable profiles become generic workflows", () => {
    const registry = Wiring.createGenericWorkflowRegistry({
        descriptors: [
            descriptor({id: "hardware-health"}),
            descriptor({id: "desktop-context", executable: false}),
        ],
        gateway: stubGateway,
        scheduler: {schedule: () => 1, cancel() {}},
        clock: {now: () => 1},
    });

    assert.deepEqual(registry.models().map((model) => model.id), ["hardware-health"]);
    assert.equal(registry.dispose(), true);
});

test("background scheduling is armed only when the applet supplies its ports", () => {
    const registered = [];
    const withoutPorts = Wiring.createGenericWorkflowRegistry({
        descriptors: [descriptor({id: "hardware-health"})],
        gateway: stubGateway,
        scheduler: {schedule: () => 1, cancel() {}},
        clock: {now: () => 1},
    });
    assert.equal(registered.length, 0);
    withoutPorts.dispose();

    const withPorts = Wiring.createGenericWorkflowRegistry({
        descriptors: [descriptor({id: "hardware-health"})],
        gateway: stubGateway,
        scheduler: {schedule: () => 1, cancel() {}},
        clock: {now: () => 1},
        timer: {
            schedule(_delay, run) {
                registered.push(run);
                return registered.length;
            },
            cancel() {},
        },
        leasePort: {acquire: () => ({release() {}})},
        logger: {warn() {}},
    });
    assert.equal(registered.length, 1, "a periodic trigger is armed");
    withPorts.dispose();
});

test("a background failure is reported rather than thrown into the timer", () => {
    const warned = [];
    const report = Wiring.backgroundErrorReporter({warn: (message) => warned.push(message)});
    report(new Error("runtime is gone"));
    assert.deepEqual(warned, ["Background workflow failed: Error: runtime is gone"]);
});
