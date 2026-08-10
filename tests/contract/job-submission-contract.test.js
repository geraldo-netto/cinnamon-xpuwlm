"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const Encoder = require("../../files/cinnamon-tpuwm@geraldo-netto/lib/tensor-encoder.js");
const Job = require("../../files/cinnamon-tpuwm@geraldo-netto/lib/runtime-job-contract.js");
const Submission = require("../../files/cinnamon-tpuwm@geraldo-netto/lib/job-submission.js");

// The applet now builds the tensor a model runs on. Everything it has to get
// right is stated somewhere in the service — the wire envelope in a schema, the
// reference rules and byte ceilings in `tensorref.py`, the element budget in
// `dispatch.py` — and none of it is enforced by the transport. A payload that
// disagrees is accepted by the bus and refused deep inside admission, or worse,
// runs and means nothing.
//
// So this gate reads the service's own numbers rather than restating them. When
// the checkout is absent it skips rather than passes: a check that quietly
// verifies nothing is the one that lets the drift through.

const repositoryRoot = path.resolve(__dirname, "../..");
const appletRoot = path.join(repositoryRoot, "files/cinnamon-tpuwm@geraldo-netto");

function serviceRoot() {
    const configured = process.env.TPUWM_OMNITENSOR_ROOT;
    const candidate = configured || path.resolve(repositoryRoot, "../omnitensor");
    return fs.existsSync(path.join(candidate, "src/omnitensor/tensorref.py")) ? candidate : null;
}

function readJson(...segments) {
    return JSON.parse(fs.readFileSync(path.join(...segments), "utf8"));
}

function readSource(root, relativePath) {
    return fs.readFileSync(path.join(root, relativePath), "utf8");
}

function constantOf(source, name) {
    const match = new RegExp(`^${name} = (.+)$`, "mu").exec(source);
    assert.ok(match !== null, `${name} is not declared where this gate expects it`);
    // The service writes its limits as arithmetic (`64 * 1024 * 1024`), which is
    // the readable form and the one worth reading here.
    return Function(`"use strict"; return (${match[1].replace(/_/gu, "")});`)();
}

function skipWithoutService(t) {
    const root = serviceRoot();
    if (root === null) {
        t.skip(
            "the OmniTensor checkout is not available; "
            + "set TPUWM_OMNITENSOR_ROOT to run the cross-repository half of this gate",
        );
    }
    return root;
}

test("the submission envelope is the service's schema, field for field", (t) => {
    const root = skipWithoutService(t);
    if (root === null) {
        return;
    }
    const schema = readJson(root, "schemas/runtime-job-submit.schema.json");

    assert.deepEqual(
        [...Job.SUBMISSION_PROPERTIES].sort(),
        Object.keys(schema.properties).sort(),
    );
    assert.deepEqual(schema.required.sort(), [...Job.SUBMISSION_PROPERTIES].sort());
    assert.equal(schema.properties.version.const, Job.JOB_VERSION);
    assert.equal(schema.properties.payload.maxProperties, Job.MAX_PAYLOAD_PROPERTIES);
    assert.equal(schema.additionalProperties, false);
});

test("the acknowledgement contract is the service's schema, field for field", (t) => {
    const root = skipWithoutService(t);
    if (root === null) {
        return;
    }
    const schema = readJson(root, "schemas/runtime-job-acknowledgement.schema.json");

    assert.deepEqual(
        [...Job.ACKNOWLEDGEMENT_PROPERTIES].sort(),
        Object.keys(schema.properties).sort(),
    );
    assert.deepEqual(schema.properties.status.enum.sort(), [...Job.ACKNOWLEDGEMENT_STATUSES].sort());
    assert.equal(schema.properties.version.const, Job.JOB_VERSION);
});

test("a reference is bounded by the service's own reference limits", (t) => {
    const root = skipWithoutService(t);
    if (root === null) {
        return;
    }
    const source = readSource(root, "src/omnitensor/tensorref.py");

    assert.equal(Job.MAX_RANK, constantOf(source, "MAX_RANK"));
    assert.equal(Job.MAX_DIMENSION, constantOf(source, "MAX_DIMENSION"));
    assert.equal(Job.MAX_TENSOR_BYTES, constantOf(source, "DEFAULT_MAX_TENSOR_BYTES"));
    const dtypes = /DTYPE_SIZES = \{([^}]*)\}/su.exec(source)[1];
    for (const [dtype, size] of Object.entries(Job.DTYPE_SIZES)) {
        assert.match(
            dtypes,
            new RegExp(`"${dtype}":\\s*${size}`, "u"),
            `the service and the applet disagree on the size of ${dtype}`,
        );
    }
});

test("the encoder never builds a tensor the service would refuse as too large", (t) => {
    const root = skipWithoutService(t);
    if (root === null) {
        return;
    }
    const source = readSource(root, "src/omnitensor/dispatch.py");

    assert.equal(
        Encoder.MAX_ELEMENTS,
        constantOf(source, "MAX_TENSOR_ELEMENTS"),
        "the applet would stage a buffer admission then refuses element by element",
    );
    assert.equal(Job.MAX_INPUT_REFERENCES, constantOf(source, "MAX_INPUT_TENSORS"));
});

test("the payload key the applet writes is the one the service reads", (t) => {
    const root = skipWithoutService(t);
    if (root === null) {
        return;
    }
    const source = readSource(root, "src/omnitensor/tensorref.py");

    assert.match(source, /payload\.get\("inputRefs"\)/u);
    assert.match(source, /"inputs" in payload/u, "the service still refuses both at once");
    assert.ok(
        Job.jobSubmission({
            requestId: "tpuwm-1-1",
            workloadId: "visual-library",
            references: [{
                path: "/root/.tpuwm-staged/x.f32",
                shape: [1, 3, 2, 2],
                dtype: "float32",
                sha256: "a".repeat(64),
            }],
        }).payload.inputRefs.length === 1,
    );
});

test("the bundled manifest declares an input this applet can actually prepare", (t) => {
    const root = skipWithoutService(t);
    if (root === null) {
        return;
    }
    const manifest = readJson(appletRoot, "workloads/visual-library/manifest.json");
    const declared = manifest.requirements.model.tensorContract.inputs[0];

    assert.equal(
        Encoder.encodingRefusal(declared),
        null,
        "the profile the runtime can serve is one the popup can offer a picture to",
    );
    assert.deepEqual(
        declared,
        readJson(root, "workloads/visual-library/manifest.json")
            .requirements.model.tensorContract.inputs[0],
        "both repositories describe the same input for the same model",
    );
});

test("a staged buffer is written inside the boundary that makes it readable", () => {
    const staged = Submission.stagedPath("/home/user/omnitensor-inputs", "visual-library", "tpuwm-1-1");

    assert.ok(staged.startsWith("/home/user/omnitensor-inputs/"));
    assert.ok(staged.endsWith(Submission.STAGED_SUFFIX));
    assert.equal(Submission.PRESERVE_ASPECT_RATIO, false);
});
