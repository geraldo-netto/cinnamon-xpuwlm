"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const Manifest = require("../../files/cinnamon-xpuwlm@geraldo-netto/lib/workload-manifest.js");
const Fixtures = require("../helpers/workload-manifest-fixtures.js");

test("regression: a persisted promoted model loads without becoming hardware-qualified", () => {
    const digest = (symbol) => symbol.repeat(64);
    const source = Fixtures.validWorkloadManifest();
    source.requirements.accelerator = "gpu";
    source.requirements.model = {
        ...source.requirements.model,
        format: "ncnn",
        fullyQuantized: false,
        trainingContract: {
            version: 1,
            profileId: "storage-intelligence",
            recipe: "backblaze-smart-risk-v1",
            reportSha256: digest("a"),
            taskSemanticsSha256: digest("b"),
        },
        nativeEvidence: {
            portableSha256: digest("c"),
            nativeSha256: digest("d"),
            reportSha256: digest("a"),
            samples: 8,
            maximumAbsoluteError: 0.0004,
            tolerance: 0.001,
            compilerReportSha256: null,
            namedDeviceAccepted: false,
        },
    };

    const persisted = JSON.parse(JSON.stringify(source));
    const loaded = new Manifest.WorkloadDescriptor(persisted).manifest().requirements.model;

    assert.deepEqual(loaded.trainingContract, source.requirements.model.trainingContract);
    assert.deepEqual(loaded.nativeEvidence, source.requirements.model.nativeEvidence);
    assert.equal(loaded.nativeEvidence.namedDeviceAccepted, false);
    assert.equal(Object.isFrozen(loaded.trainingContract), true);
    assert.equal(Object.isFrozen(loaded.nativeEvidence), true);
});
