"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const BuiltIns = require("../helpers/built-in-workloads.js");

// The service owns the catalog; the manifests bundled here are the fallback the
// popup renders whenever no runtime has published anything. A fallback that has
// drifted is worse than no fallback: it describes a profile the runtime would
// refuse, or hides one it would run, and nothing on either side notices. That
// is exactly how the bundled `visual-library` came to declare a TPU and no
// model long after the service had given it an ncnn model on the GPU, so the
// copies are pinned to each other instead of to a remembered snapshot of them.
const repositoryRoot = path.resolve(__dirname, "../..");

// The service repository is a sibling checkout, not a dependency: the gate runs
// wherever both are present and reports itself unavailable, never as passing,
// where only one is.
function serviceWorkloads() {
    const configured = process.env.TPUWM_OMNITENSOR_ROOT;
    const candidate = configured || path.resolve(repositoryRoot, "../omnitensor");
    const workloads = path.join(candidate, "workloads");
    return fs.existsSync(workloads) ? workloads : null;
}

function identifiers(root) {
    return fs.readdirSync(root, {withFileTypes: true})
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
        .sort();
}

function readManifest(root, identifier) {
    return JSON.parse(fs.readFileSync(path.join(root, identifier, "manifest.json"), "utf8"));
}

test("every bundled workload manifest matches the service's copy", (t) => {
    const service = serviceWorkloads();
    if (service === null) {
        t.skip(
            "the OmniTensor checkout is not available; "
            + "set TPUWM_OMNITENSOR_ROOT to run the cross-repository half of this gate",
        );
        return;
    }
    const bundled = identifiers(BuiltIns.ROOT);
    assert.notEqual(bundled.length, 0);
    for (const identifier of bundled) {
        assert.deepEqual(
            readManifest(BuiltIns.ROOT, identifier),
            readManifest(service, identifier),
            `the bundled ${identifier} manifest no longer describes what the service loads`,
        );
    }
});

test("the bundled catalog covers every workload the service ships", (t) => {
    const service = serviceWorkloads();
    if (service === null) {
        t.skip("the OmniTensor checkout is not available");
        return;
    }
    // A workload the service gained and the applet never bundled is invisible
    // until a runtime publishes state, which is the one moment the fallback
    // exists for.
    assert.deepEqual(identifiers(BuiltIns.ROOT), identifiers(service));
});

// The manifests were pinned to each other; the *schemas* were not, and neither
// was the hand-written validator that restates the schema for GJS. Adding
// `tensorContract` to the service and not here would have made the applet
// reject the manifest and hide a profile the runtime runs — the same silent
// failure the snapshot validator produced, in a different file.
const Manifest = require("../../files/cinnamon-tpuwm@geraldo-netto/lib/workload-manifest.js");

const appletRoot = path.join(repositoryRoot, "files/cinnamon-tpuwm@geraldo-netto");

function serviceSchema() {
    const configured = process.env.TPUWM_OMNITENSOR_ROOT;
    const candidate = configured || path.resolve(repositoryRoot, "../omnitensor");
    const schema = path.join(candidate, "schemas/workload-manifest.schema.json");
    return fs.existsSync(schema) ? JSON.parse(fs.readFileSync(schema, "utf8")) : null;
}

const mirrored = JSON.parse(
    fs.readFileSync(path.join(appletRoot, "workload-manifest.schema.json"), "utf8"),
);

// The model moved into a shared definition so `model` and `models` describe
// their entries with one set of rules rather than two that drift.
function modelProperties(schema) {
    return schema.$defs.model.properties;
}

test("the mirrored manifest schema still describes the model the service does", (t) => {
    const service = serviceSchema();
    if (service === null) {
        t.skip(
            "the OmniTensor checkout is not available; "
            + "set TPUWM_OMNITENSOR_ROOT to run the cross-repository half of this gate",
        );
        return;
    }

    assert.deepEqual(
        Object.keys(modelProperties(mirrored)).sort(),
        Object.keys(modelProperties(service)).sort(),
        "the two schemas disagree on what a model may declare",
    );
    assert.deepEqual(
        modelProperties(mirrored).tensorContract,
        modelProperties(service).tensorContract,
        "the mirrored tensor contract drifted from the service's",
    );
    assert.deepEqual(
        modelProperties(mirrored).featureContract,
        modelProperties(service).featureContract,
        "the mirrored feature contract drifted from the service's",
    );
});

test("every validator allowlist names exactly the mirrored schema's properties", () => {
    const model = modelProperties(mirrored);
    const contract = model.tensorContract;
    const input = contract.properties.inputs.items;
    const requirements = mirrored.properties.requirements;
    const objects = {
        featureContract: model.featureContract.properties,
        model,
        outputContract: model.outputContract.properties,
        tensorContract: contract.properties,
        tensorInput: input.properties,
        preprocess: input.properties.preprocess.properties,
        resize: input.properties.preprocess.properties.resize.properties,
        requirements: requirements.properties,
        ui: mirrored.properties.ui.properties,
        defaults: mirrored.properties.defaults.properties,
        pipeline: mirrored.properties.pipeline.properties,
    };

    for (const [name, allowed] of Object.entries(Manifest.MANIFEST_ALLOWLISTS)) {
        assert.deepEqual(
            [...allowed].sort(),
            Object.keys(objects[name]).sort(),
            `${name}: the validator and the schema disagree on which properties exist`,
        );
    }
});

test("the validator and the mirrored schema agree on the bundled manifests", () => {
    // Belt and braces: the allowlists can match while a value rule does not.
    const Ajv2020 = require("ajv/dist/2020").default;
    const oracle = new Ajv2020({strict: true}).compile(mirrored);
    const root = path.join(appletRoot, "workloads");

    for (const identifier of identifiers(root)) {
        const manifest = readManifest(root, identifier);
        assert.equal(oracle(manifest), true, `${identifier}: rejected by the mirrored schema`);
        assert.doesNotThrow(
            () => new Manifest.WorkloadDescriptor(manifest),
            `${identifier}: rejected by the validator the applet actually runs`,
        );
    }
});
