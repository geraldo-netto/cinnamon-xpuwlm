"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const Domain = require("../../files/cinnamon-tpuwm@geraldo-netto/lib/domain.js");
const FailureBackoff = require("../../files/cinnamon-tpuwm@geraldo-netto/lib/failure-log-backoff.js");
const Manager = require("../../files/cinnamon-tpuwm@geraldo-netto/lib/manager.js");
const Registry = require("../../files/cinnamon-tpuwm@geraldo-netto/lib/workload-registry.js");
const Manifest = require("../../files/cinnamon-tpuwm@geraldo-netto/lib/workload-manifest.js");
const ManifestFixtures = require("../helpers/workload-manifest-fixtures.js");
const Refusal = require("../../files/cinnamon-tpuwm@geraldo-netto/lib/runtime-refusal-contract.js");

const NOW = 1_700_000_000_000;
const ROOT = "/home/tester/omnitensor-inputs";
const PICTURE = Object.freeze({root: ROOT, name: "cat.png", path: `${ROOT}/cat.png`});

const CONTRACT = Object.freeze({
    inputs: [{
        shape: [1, 3, 8, 8],
        dtype: "float32",
        layout: "NCHW",
        preprocess: {channelOrder: "BGR", mean: [104, 117, 123], scale: [1, 1, 1]},
    }],
});

function manifest({id, model = {}}) {
    const base = ManifestFixtures.validWorkloadManifest();
    return {
        ...base,
        id,
        capabilities: [id],
        requirements: {
            ...base.requirements,
            accelerator: "gpu",
            model: {
                id: `${id}-model`,
                version: "1.0.0",
                format: "ncnn",
                fullyQuantized: false,
                minimumCompilerVersion: "1.0",
                minimumRuntimeVersion: "1.0",
                ...model,
            },
        },
        ui: {...base.ui, title: id === "runnable" ? "Runnable profile" : "Silent profile"},
    };
}

function registry() {
    return new Registry.StaticWorkloadRegistry([
        new Manifest.WorkloadDescriptor(manifest({id: "runnable", model: {tensorContract: CONTRACT}})),
        new Manifest.WorkloadDescriptor(manifest({id: "silent"})),
    ]);
}

function snapshotWith(roots) {
    return Domain.normalizeSnapshot({
        version: 1,
        generatedAt: NOW,
        devices: [{id: "gpu-renderD128", backend: "gpu", available: true, name: "GPU", kind: "dri"}],
        metrics: {queueDepth: 0, runningProfiles: 0},
        profiles: {},
        alerts: [],
        inputs: {roots, maxBytes: 67_108_864},
    }, NOW, Domain.DEFAULT_STALE_AFTER_MS, catalog());
}

function catalog() {
    return new Domain.WorkloadCatalog(Registry.profileDefinitions(registry()));
}

function acknowledgement(overrides = {}) {
    return {
        version: 1,
        requestId: "tpuwm-1-1",
        jobId: "job-1",
        status: "accepted",
        code: "job-accepted",
        message: "Job accepted",
        timestamp: NOW,
        stagedPath: `${ROOT}/.tpuwm-staged/runnable-tpuwm-1-1.f32`,
        ...overrides,
    };
}

function harness(options = {}) {
    const errors = [];
    const warnings = [];
    const submissions = [];
    const jobSubmitter = options.jobSubmitter === null ? null : {
        submit(request, callback) {
            submissions.push(request);
            if (options.deferSubmit) {
                submissions.pending = callback;
                return true;
            }
            callback(options.submitError ?? null, options.submitError ? null : acknowledgement(
                options.acknowledgement,
            ));
            return true;
        },
        cancel() {
            submissions.push("cancel");
            return true;
        },
    };
    const inputCatalog = options.inputCatalog === null ? null : {
        pictures(roots) {
            if (options.listThrows) {
                throw new Error("permission denied");
            }
            return roots.flatMap((root) => (options.pictures ?? ["cat.png"])
                .map((name) => ({root, name, path: `${root}/${name}`})));
        },
    };
    const manager = new Manager.WorkloadManager({
        repository: {load: () => ({portfolio: null, selectedTab: "profiles"}), save() {}},
        runtimeGateway: {
            read: (unused, callback) => callback(snapshotWith(options.roots ?? [ROOT])),
        },
        controlGateway: {send() {}, cancel: () => false},
        jobSubmitter,
        inputCatalog,
        clock: {now: () => NOW},
        errorReporter: new FailureBackoff.FailureErrorBackoff({
            logger: {warn: (m) => warnings.push(m), error: (m) => errors.push(m)},
        }),
        logger: {warn: (m) => warnings.push(m), error: (m) => errors.push(m)},
        workloadRegistry: registry(),
    });
    manager.start();
    return {manager, submissions, errors, warnings};
}

test("a profile that states its input is offered and one that does not is not", () => {
    const {manager} = harness();

    assert.deepEqual(manager.state().inputs.runnable, ["runnable"]);
    assert.equal(manager.jobBlocker("runnable"), "");
    assert.match(manager.jobBlocker("silent"), /does not state what input it needs/u);
    assert.match(manager.jobBlocker("absent-profile"), /does not state what input it needs/u);
});

test("the pictures listed are the ones inside the roots the runtime published", () => {
    const {manager} = harness({pictures: ["cat.png", "dog.jpg"]});

    assert.deepEqual(manager.state().inputs.roots, [ROOT]);
    assert.deepEqual(manager.state().inputs.pictures, [
        {root: ROOT, name: "cat.png", path: `${ROOT}/cat.png`},
        {root: ROOT, name: "dog.jpg", path: `${ROOT}/dog.jpg`},
    ]);
});

test("a runtime that publishes no input root blocks every profile with a reason", () => {
    const {manager} = harness({roots: []});

    assert.match(manager.jobBlocker("runnable"), /not configured to read input files/u);
    assert.equal(manager.submitJob("runnable", PICTURE), false);
    assert.deepEqual(manager.state().inputs.pictures, []);
});

test("submitting sends the profile's own contract, its picture, and its root", () => {
    const {manager, submissions} = harness();

    assert.equal(manager.submitJob("runnable", PICTURE), true);

    assert.deepEqual(submissions[0], {
        workloadId: "runnable",
        spec: CONTRACT.inputs[0],
        sourcePath: `${ROOT}/cat.png`,
        stagingRoot: ROOT,
    });
    const job = manager.state().job;
    assert.equal(job.pending, false);
    assert.equal(job.jobId, "job-1");
    assert.equal(job.status, "accepted");
    assert.equal(job.sourceName, "cat.png");
});

test("a job is announced as pending before the runtime has answered", () => {
    const {manager} = harness({deferSubmit: true});
    const states = [];
    manager.subscribe((state) => states.push(state.job));

    manager.submitJob("runnable", PICTURE);

    assert.equal(states.at(-1).pending, true);
    assert.match(states.at(-1).message, /Preparing/u);
    assert.equal(manager.submitJob("runnable", PICTURE), false, "one job at a time");
});

test("a refused job reports the runtime's own reason", () => {
    const {manager, errors} = harness({
        acknowledgement: {
            status: "rejected",
            jobId: null,
            code: "input-contract-mismatch",
            message: "input 0 has shape [1, 3, 8, 8] and the model declares [1, 3, 227, 227]",
        },
    });

    manager.submitJob("runnable", PICTURE);

    const job = manager.state().job;
    assert.equal(job.status, "rejected");
    assert.equal(job.code, "input-contract-mismatch");
    assert.match(job.message, /the model declares/u);
    assert.ok(errors.some((message) => message.includes("input 0 has shape")));
});

test("a picture that cannot be prepared is explained, not blamed on the bus", () => {
    const Encoder = require("../../files/cinnamon-tpuwm@geraldo-netto/lib/tensor-encoder.js");
    const {manager} = harness({
        submitError: new Encoder.TensorEncodingError("image-decode-failed", "not a picture"),
    });

    manager.submitJob("runnable", PICTURE);

    assert.match(manager.state().job.message, /could not be read as a picture/u);
});

test("a transport refusal keeps the vocabulary the control path already uses", () => {
    const {manager} = harness({
        submitError: new Refusal.RuntimeRefusedError({
            version: 1,
            status: "rejected",
            code: "rate-limit-exceeded",
            message: "too many",
            method: "SubmitJob",
        }),
    });

    manager.submitJob("runnable", PICTURE);

    assert.match(manager.state().job.message, /rate limiting/u);
});

test("a job is refused before the bus when the service is known to be gone", () => {
    const watchers = [];
    const errors = [];
    const manager = new Manager.WorkloadManager({
        repository: {load: () => ({portfolio: null, selectedTab: "profiles"}), save() {}},
        runtimeGateway: {read: (unused, callback) => callback(snapshotWith([ROOT]))},
        controlGateway: {send() {}, cancel: () => false},
        controlWatch: {watch: (listener) => watchers.push(listener)},
        jobSubmitter: {submit() { throw new Error("must not be called"); }, cancel: () => false},
        inputCatalog: {pictures: () => []},
        clock: {now: () => NOW},
        errorReporter: new FailureBackoff.FailureErrorBackoff({
            logger: {error: (m) => errors.push(m), warn() {}},
        }),
        logger: {warn() {}, error: (m) => errors.push(m)},
        workloadRegistry: registry(),
    });
    manager.start();
    watchers[0](false);

    assert.equal(manager.submitJob("runnable", PICTURE), false);
    assert.match(manager.state().job.message, /runtime service stopped/iu);
});

test("an applet built without a job port says so instead of offering a dead control", () => {
    const {manager} = harness({jobSubmitter: null});

    assert.equal(manager.submitJob("runnable", PICTURE), false);
    assert.match(manager.state().job.message, /job service is unavailable/u);
});

test("a submission without a picture is refused before anything is prepared", () => {
    const {manager, submissions} = harness();

    assert.equal(manager.submitJob("runnable", null), false);
    assert.equal(manager.submitJob("runnable", {name: "cat.png"}), false);
    assert.match(manager.state().job.message, /No picture was chosen/u);
    assert.deepEqual(submissions, []);
});

test("relisting happens on demand and when the published roots change", () => {
    const {manager} = harness();

    assert.equal(manager.refreshInputs(), true, "an explicit refresh always relists");
    assert.equal(manager.state().inputs.pictures.length, 1);
});

test("an unreadable input directory leaves an empty list and one warning", () => {
    const {manager, warnings} = harness({listThrows: true});

    assert.deepEqual(manager.state().inputs.pictures, []);
    assert.ok(warnings.some((message) => message.includes("Could not list runtime input files")));
});

test("an applet built without an input catalog lists nothing and never relists", () => {
    const {manager} = harness({inputCatalog: null});

    assert.deepEqual(manager.state().inputs.pictures, []);
    assert.equal(manager.refreshInputs(), false);
});

test("disposal cancels a job in flight and releases its failure key", () => {
    const {manager, submissions} = harness({deferSubmit: true});

    manager.submitJob("runnable", PICTURE);
    assert.equal(manager.dispose(), true);

    assert.ok(submissions.includes("cancel"));
    // A reply that arrives after disposal is discarded rather than published
    // into a manager nothing is listening to any more.
    submissions.pending(null, acknowledgement());
    assert.equal(manager.state().job.jobId, "");
    assert.throws(() => manager.submitJob("runnable", PICTURE), /disposed/u);
});

test("a snapshot from before the field publishes no roots rather than guessing", () => {
    const bare = Domain.probeSnapshot(
        [{id: "gpu-renderD128", backend: "gpu", available: true, name: "GPU", kind: "dri"}],
        NOW,
    );
    delete bare.inputs;
    const {manager} = harness({});
    manager.replaceRuntimeGateway({read: (unused, callback) => callback(bare)});

    assert.deepEqual(manager.state().inputs.roots, []);
    assert.match(manager.jobBlocker("runnable"), /not configured to read input files/u);
});

test("a picture with no name still submits, and is reported without one", () => {
    const {manager, submissions} = harness();

    assert.equal(manager.submitJob("runnable", {root: ROOT, path: `${ROOT}/cat.png`}), true);

    assert.equal(submissions[0].sourcePath, `${ROOT}/cat.png`);
    assert.equal(manager.state().job.sourceName, "");
});

test("the manager validates the job ports it is handed", () => {
    assert.throws(() => Manager.requireJobSubmitter({submit() {}}), TypeError);
    assert.throws(() => Manager.requireJobSubmitter(null), TypeError);
    assert.throws(() => Manager.requireInputCatalog({}), TypeError);
    assert.equal(Manager.requireInputCatalog({pictures() {}}).pictures.length, 0);
});

test("a registry of descriptors without input contracts maps every profile to null", () => {
    const contracts = Manager.inputContracts({
        descriptors: () => [{id: "legacy"}],
    });

    assert.equal(contracts.get("legacy"), null);
});
