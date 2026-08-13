"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const ROOT = path.resolve(__dirname, "../../files/cinnamon-xpuwlm@geraldo-netto/lib");
const Manifest = require(path.join(ROOT, "workload-manifest.js"));
const Provenance = require(path.join(ROOT, "workload-provenance.js"));
const TensorContract = require(path.join(ROOT, "workload-tensor-contract.js"));

test("workload-manifest facade preserves extracted contract validators", () => {
    assert.equal(Manifest.isFeatureContract, TensorContract.isFeatureContract);
    assert.equal(Manifest.isModelDigest, Provenance.isModelDigest);
    assert.equal(Manifest.isNativeEvidence, Provenance.isNativeEvidence);
    assert.equal(Manifest.isTrainingContract, Provenance.isTrainingContract);
});

test("manifest allowlists are owned by their contract modules", () => {
    const expected = {
        featureContract: TensorContract.FEATURE_CONTRACT_PROPERTIES,
        nativeEvidence: Provenance.NATIVE_EVIDENCE_PROPERTIES,
        outputContract: TensorContract.OUTPUT_CONTRACT_PROPERTIES,
        preprocess: TensorContract.PREPROCESS_PROPERTIES,
        resize: TensorContract.RESIZE_PROPERTIES,
        tensorContract: TensorContract.TENSOR_CONTRACT_PROPERTIES,
        tensorInput: TensorContract.TENSOR_INPUT_PROPERTIES,
        trainingContract: Provenance.TRAINING_CONTRACT_PROPERTIES,
    };
    for (const [name, owner] of Object.entries(expected)) {
        assert.equal(Manifest.MANIFEST_ALLOWLISTS[name], owner, name);
    }
});

test("workload-manifest facade contains no extracted validator bodies", () => {
    const source = fs.readFileSync(path.join(ROOT, "workload-manifest.js"), "utf8");
    for (const name of [
        "isFeatureContract", "isNativeEvidence", "isTensorContract", "isTrainingContract",
    ]) {
        assert.doesNotMatch(source, new RegExp(`^function ${name}\\(`, "mu"), name);
    }
});
