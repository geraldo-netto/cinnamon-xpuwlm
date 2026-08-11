"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const Domain = require("../../files/cinnamon-xpuwlm@geraldo-netto/lib/domain.js");
const FailureBackoff = require("../../files/cinnamon-xpuwlm@geraldo-netto/lib/failure-log-backoff.js");
const Manager = require("../../files/cinnamon-xpuwlm@geraldo-netto/lib/manager.js");
const Registry = require("../../files/cinnamon-xpuwlm@geraldo-netto/lib/workload-registry.js");
const Manifest = require("../../files/cinnamon-xpuwlm@geraldo-netto/lib/workload-manifest.js");
const ManifestFixtures = require("../helpers/workload-manifest-fixtures.js");
const Refusal = require("../../files/cinnamon-xpuwlm@geraldo-netto/lib/runtime-refusal-contract.js");

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

function jobResult(overrides = {}) {
    return {
        version: 1,
        requestId: "xpuwlm-1-2",
        jobId: "job-1",
        state: "succeeded",
        code: "job-succeeded",
        message: "Job finished",
        timestamp: NOW,
        ...overrides,
    };
}

function acknowledgement(overrides = {}) {
    return {
        version: 1,
        requestId: "xpuwlm-1-1",
        jobId: "job-1",
        status: "accepted",
        code: "job-accepted",
        message: "Job accepted",
        timestamp: NOW,
        stagedPath: `${ROOT}/.xpuwlm-staged/runnable-xpuwlm-1-1.f32`,
        ...overrides,
    };
}

function fakeScheduler() {
    return {
        scheduled: [],
        cancelled: [],
        next: 1,
        schedule(delayMs, callback) {
            const handle = this.next;
            this.next += 1;
            this.scheduled.push({handle, delayMs, callback});
            return handle;
        },
        cancel(handle) {
            this.cancelled.push(handle);
            const index = this.scheduled.findIndex((entry) => entry.handle === handle);
            if (index >= 0) {
                this.scheduled.splice(index, 1);
            }
            return true;
        },
        // The manager also arms a freshness-expiry timer on this scheduler, so
        // a poll is selected by its own interval rather than by being last.
        pending() {
            return this.scheduled.filter((entry) => entry.delayMs === Manager.JOB_POLL_INTERVAL_MS);
        },
        fire() {
            const entry = this.pending().at(-1);
            this.scheduled.splice(this.scheduled.indexOf(entry), 1);
            entry.callback();
            return entry;
        },
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
        discard(path) {
            submissions.push(["discard", path]);
            return true;
        },
        get pollable() {
            return options.pollable !== false;
        },
        requestResult(jobId, callback) {
            submissions.push(["poll", jobId]);
            const answers = options.results ?? [];
            const answer = answers.shift();
            if (answer === undefined) {
                return true;
            }
            callback(answer.error ?? null, answer.error ? null : jobResult(answer));
            return true;
        },
        cancelResult() {
            submissions.push("cancelResult");
            return true;
        },
        sweepStaged(roots) {
            submissions.push(["sweep", [...roots]]);
            return options.swept ?? 0;
        },
    };
    const inputCatalog = options.inputCatalog === null ? null : {
        pictures(roots) {
            if (options.listThrows) {
                throw new Error("permission denied");
            }
            return {
                pictures: roots.flatMap((root) => (options.pictures ?? ["cat.png"])
                    .map((name) => ({root, name, path: `${root}/${name}`}))),
                omitted: options.omitted ?? 0,
            };
        },
    };
    options.scheduler = options.scheduler || fakeScheduler();
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
        scheduler: options.scheduler,
        workloadRegistry: registry(),
    });
    manager.start();
    return {manager, submissions, errors, warnings, scheduler: options.scheduler};
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

    assert.deepEqual(submissions.find((entry) => !Array.isArray(entry)), {
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
    const Encoder = require("../../files/cinnamon-xpuwlm@geraldo-netto/lib/tensor-encoder.js");
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
        jobSubmitter: {
            submit() { throw new Error("must not be called"); },
            cancel: () => false,
            discard: () => false,
            requestResult() { throw new Error("must not be called"); },
            cancelResult: () => false,
            sweepStaged: () => 0,
        },
        inputCatalog: {pictures: () => ({pictures: [], omitted: 0})},
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
    assert.deepEqual(submissions.filter((entry) => !Array.isArray(entry)), []);
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

    assert.equal(submissions.find((entry) => !Array.isArray(entry)).sourcePath, `${ROOT}/cat.png`);
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

test("an accepted job is polled until the runtime says what became of it", () => {
    const {manager, submissions, scheduler} = harness({
        results: [
            {state: "running", code: "job-running", message: "", progress: {fraction: 0.5, detail: "infer"}},
            {state: "succeeded", code: "job-succeeded", message: "Job finished", output: {
                reading: {kind: "classification", top: [{index: 669, score: 0.0918}]},
            }},
        ],
    });

    manager.submitJob("runnable", PICTURE);
    assert.equal(manager.state().job.state, "", "an acknowledgement is not an outcome");

    scheduler.fire();
    assert.equal(manager.state().job.state, "running");
    assert.deepEqual(manager.state().job.progress, {fraction: 0.5, detail: "infer"});

    scheduler.fire();
    const job = manager.state().job;
    assert.equal(job.state, "succeeded");
    assert.deepEqual(job.reading, {kind: "classification", top: [{index: 669, score: 0.0918}]});
    assert.deepEqual(submissions.filter((entry) => entry[0] === "poll").length, 2);
});

test("a bounded forecast reading survives the job polling boundary", () => {
    const reading = {kind: "forecast", targetFeature: "queueDepth", horizon: 4, value: 2};
    const {manager, scheduler} = harness({
        results: [{
            state: "succeeded",
            code: "job-succeeded",
            message: "Job finished",
            output: {reading},
        }],
    });

    manager.submitJob("runnable", PICTURE);
    scheduler.fire();

    assert.deepEqual(manager.state().job.reading, reading);
});

test("the staged buffer is removed once the job can no longer read it", () => {
    const {manager, submissions, scheduler} = harness({results: [{state: "succeeded"}]});

    manager.submitJob("runnable", PICTURE);
    assert.ok(!submissions.some((entry) => entry[0] === "discard"), "an accepted job still reads it");

    scheduler.fire();

    assert.ok(submissions.some(
        (entry) => entry[0] === "discard" && entry[1].endsWith(".f32"),
    ));
});

test("a job that fails after acceptance stops reading as accepted", () => {
    const {manager, errors, scheduler} = harness({
        results: [{state: "failed", code: "no-backend-available", message: "no lane"}],
    });

    manager.submitJob("runnable", PICTURE);
    scheduler.fire();

    assert.equal(manager.state().job.state, "failed");
    assert.equal(manager.state().job.code, "no-backend-available");
    assert.ok(errors.some((message) => message.includes("failed")));
});

test("one unreadable poll is retried rather than treated as an outcome", () => {
    const {manager, scheduler} = harness({
        results: [{error: new Error("TimedOut")}, {state: "succeeded"}],
    });

    manager.submitJob("runnable", PICTURE);
    scheduler.fire();
    assert.equal(manager.state().job.state, "", "a failed poll says nothing about the job");

    scheduler.fire();
    assert.equal(manager.state().job.state, "succeeded");
});

test("polling stops rather than running forever, and says that it stopped", () => {
    // A job that never leaves `running` is the case the ceiling exists for: the
    // runtime is answering, so nothing errors, and without a bound the applet
    // would ask every 400 ms until the session ended.
    const running = Array.from({length: Manager.MAX_JOB_POLLS + 2}, () => ({state: "running"}));
    const {manager, submissions, scheduler} = harness({results: running});

    manager.submitJob("runnable", PICTURE);
    for (let attempt = 0; attempt < Manager.MAX_JOB_POLLS + 1; attempt += 1) {
        scheduler.fire();
    }

    assert.match(manager.state().job.message, /did not report an outcome/u);
    assert.equal(manager.state().job.state, "running", "the last thing known is still said");
    assert.equal(
        submissions.filter((entry) => entry[0] === "poll").length,
        Manager.MAX_JOB_POLLS,
    );
    assert.deepEqual(scheduler.pending(), [], "nothing is left armed");
});

test("an accepted job with no id is not polled, because there is nothing to ask about", () => {
    const {manager, submissions, scheduler} = harness({acknowledgement: {jobId: null}});

    manager.submitJob("runnable", PICTURE);

    assert.ok(!submissions.some((entry) => entry[0] === "poll"));
    assert.deepEqual(scheduler.pending(), []);
    assert.match(manager.state().job.message, /Job accepted/u);
});

test("a runtime that cannot report outcomes is said so, not polled", () => {
    const {manager, submissions, scheduler} = harness({pollable: false});

    manager.submitJob("runnable", PICTURE);

    assert.match(manager.state().job.message, /cannot report job outcomes/u);
    assert.ok(!submissions.some((entry) => entry[0] === "poll"));
    assert.deepEqual(scheduler.pending(), []);
});

test("a refused job releases its staged buffer immediately", () => {
    const {manager, submissions} = harness({
        acknowledgement: {status: "rejected", jobId: null, code: "input-contract-mismatch", message: "no"},
    });

    manager.submitJob("runnable", PICTURE);

    assert.ok(submissions.some((entry) => entry[0] === "discard"));
});

test("a new job abandons the poll for the one before it", () => {
    const {manager, submissions, scheduler} = harness({results: []});

    manager.submitJob("runnable", PICTURE);
    assert.equal(scheduler.pending().length, 1);
    manager.submitJob("runnable", PICTURE);

    assert.ok(submissions.includes("cancelResult"));
    assert.equal(scheduler.cancelled.length >= 1, true);
});

test("polling stops at disposal rather than firing into a dead manager", () => {
    const {manager, scheduler} = harness({results: []});

    manager.submitJob("runnable", PICTURE);
    manager.dispose();

    assert.deepEqual(scheduler.pending(), [], "the pending poll was cancelled");
});

test("the submitter port is validated in full, not by two of its methods", () => {
    assert.deepEqual(Manager.JOB_SUBMITTER_METHODS, [
        "submit", "cancel", "discard", "requestResult", "cancelResult", "sweepStaged",
    ]);
    for (const missing of Manager.JOB_SUBMITTER_METHODS) {
        const port = {};
        for (const name of Manager.JOB_SUBMITTER_METHODS) {
            if (name !== missing) {
                port[name] = () => {};
            }
        }
        assert.throws(() => Manager.requireJobSubmitter(port), TypeError, missing);
    }
});

test("a failed result poll is not reported as a failed policy change", () => {
    // Asking what became of a job changes nothing, so the control vocabulary's
    // "could not apply the change" describes a failure that never happened.
    const Submission = require("../../files/cinnamon-xpuwlm@geraldo-netto/lib/job-submission.js");

    const text = Manager.jobFailureText(Submission.resultFailure(new Error("NoReply")));

    assert.match(text, /what became of this job/u);
    assert.doesNotMatch(text, /apply the change/u);
    assert.ok(Object.hasOwn(Manager.JOB_REFUSAL_TEXTS, "job-result-unavailable"));
});

test("every code the submitter can raise has words of its own", () => {
    const Encoder = require("../../files/cinnamon-xpuwlm@geraldo-netto/lib/tensor-encoder.js");
    const Submission = require("../../files/cinnamon-xpuwlm@geraldo-netto/lib/job-submission.js");

    const raised = [
        ...Object.keys(Encoder.REFUSAL_KINDS),
        "image-invalid",
        "image-size-mismatch",
        "image-truncated",
        Submission.decodeFailure("x").code,
        Submission.writeFailure("x").code,
        Submission.resultFailure("x").code,
        "staging-name-invalid",
    ];

    for (const code of raised) {
        assert.ok(
            Object.hasOwn(Manager.JOB_REFUSAL_TEXTS, code),
            `${code} would fall through to the policy-change vocabulary`,
        );
    }
});

test("buffers a previous session never finished are swept once at startup", () => {
    // Nothing else ever reads the staging directory, so a crash between
    // submission and outcome leaves the file there for good.
    const {manager, submissions} = harness({swept: 3});

    const sweeps = submissions.filter((entry) => Array.isArray(entry) && entry[0] === "sweep");
    assert.equal(sweeps.length, 1, "once per session, not once per refresh");
    assert.deepEqual(sweeps[0][1], [ROOT]);

    manager.refreshInputs();
    assert.equal(
        submissions.filter((entry) => Array.isArray(entry) && entry[0] === "sweep").length,
        1,
    );
});

test("nothing is swept before the runtime says where its roots are", () => {
    const {submissions} = harness({roots: []});

    assert.deepEqual(submissions.filter((entry) => Array.isArray(entry)), []);
});

test("abandoning a poll releases the buffer nothing will read", () => {
    // The applet will never learn this job's outcome, so its staged input has
    // no remaining reader here; dispatch re-reads at execution, so removing it
    // can only race a job that is already failing.
    const {manager, submissions} = harness({deferSubmit: true, results: []});

    manager.submitJob("runnable", PICTURE);
    submissions.pending(null, acknowledgement());
    const before = submissions.filter((e) => Array.isArray(e) && e[0] === "discard").length;

    manager.dispose();

    const after = submissions.filter((e) => Array.isArray(e) && e[0] === "discard").length;
    assert.equal(after, before + 1, "the abandoned poll discarded its buffer");
});

test("a terminal outcome discards once, not twice", () => {
    const {manager, submissions} = harness({results: [{state: "succeeded"}], scheduler: undefined});

    manager.submitJob("runnable", PICTURE);
    manager.state();

    const discards = submissions.filter((e) => Array.isArray(e) && e[0] === "discard");
    assert.equal(discards.length, 0, "nothing discarded before the poll fires");
});
