"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const Ajv2020 = require("ajv/dist/2020").default;
const Contract = require("../../files/cinnamon-xpuwlm@geraldo-netto/lib/workload-manifest.js");
const Fixtures = require("../helpers/workload-manifest-fixtures.js");

const schema = JSON.parse(fs.readFileSync(path.resolve(
    __dirname,
    "../../files/cinnamon-xpuwlm@geraldo-netto/workload-manifest.schema.json",
), "utf8"));
const oracle = new Ajv2020({strict: true}).compile(schema);

test("GGUF remains a plug-in artifact format rather than a workload model format", () => {
    const digest = "a".repeat(64);
    const pluginManifest = Fixtures.validPluginWorkloadManifest();
    pluginManifest.plugin.artifacts = [{
        id: "qwen3-0-6b-q8-0",
        version: "1.0.0",
        format: "gguf",
        sha256: digest,
        companions: {"tokenizer.json": "b".repeat(64)},
    }];
    assert.equal(Contract.isWorkloadManifest(pluginManifest), true);
    assert.equal(Boolean(oracle(pluginManifest)), true);

    const modelManifest = Fixtures.validWorkloadManifest();
    modelManifest.requirements.accelerator = "gpu";
    modelManifest.requirements.model = {
        ...modelManifest.requirements.model,
        format: "gguf",
        fullyQuantized: false,
    };
    assert.equal(Contract.isWorkloadManifest(modelManifest), false);
    assert.equal(Boolean(oracle(modelManifest)), false);
});

// The runtime publishes media-transcription with a whisper.cpp artifact
// alongside the GGUF one. Omitting the format from the applet's vocabulary
// rejected the whole manifest, so that plug-in could not be packaged at all
// while the other four published manifests verified.
test("GGML Whisper is a plug-in artifact format and never a workload model format", () => {
    const pluginManifest = Fixtures.validPluginWorkloadManifest();
    pluginManifest.plugin.artifacts = [
        {
            id: "qwen2-5-vl-7b-instruct",
            version: "1.0.0",
            format: "gguf",
            sha256: "9".repeat(64),
            companions: {"mmproj.gguf": "c".repeat(64)},
        },
        {
            id: "whisper-small-multilingual",
            version: "1.0.0",
            format: "ggml-whisper",
            sha256: "1".repeat(64),
        },
    ];
    assert.equal(Contract.isPluginArtifact(pluginManifest.plugin.artifacts[1]), true);
    assert.equal(Contract.isWorkloadManifest(pluginManifest), true);
    assert.equal(Boolean(oracle(pluginManifest)), true);

    const modelManifest = Fixtures.validWorkloadManifest();
    modelManifest.requirements.accelerator = "gpu";
    modelManifest.requirements.model = {
        ...modelManifest.requirements.model,
        format: "ggml-whisper",
        fullyQuantized: false,
    };
    assert.equal(Contract.isWorkloadManifest(modelManifest), false);
    assert.equal(Boolean(oracle(modelManifest)), false);
});
