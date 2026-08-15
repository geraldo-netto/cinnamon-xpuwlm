"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const Manifest = require("../../files/cinnamon-xpuwlm@geraldo-netto/lib/workload-manifest.js");
const BuiltIns = require("../helpers/built-in-workloads.js");

const manifestPath = path.join(BuiltIns.ROOT, "low-light-enhancement", "manifest.json");
// The pinned Retinexformer contracts live in the runtime's model recipe, which
// is their source of truth. The profile declares no model until the artifact
// exists and can be pinned by digest, so the recipe is what these check.
const recipePath = path.join(
    __dirname, "../../../omnitensor/model-recipes/retinexformer-lol-v1.json",
);

function manifest() {
    return JSON.parse(fs.readFileSync(manifestPath, "utf8"));
}

function recipe() {
    return JSON.parse(fs.readFileSync(recipePath, "utf8"));
}

test("low-light enhancement is a dedicated disabled-by-default catalog workload", () => {
    const descriptor = new Manifest.WorkloadDescriptor(manifest());
    const definition = descriptor.profileDefinition();
    assert.equal(descriptor.id, "low-light-enhancement");
    assert.equal(descriptor.manifest().version, "0.2.0");
    assert.equal(definition.group, "Local workflows");
    assert.equal(definition.defaultEnabled, false);
    assert.ok(definition.order > 50);
    assert.ok(definition.order < 60);
    assert.deepEqual(descriptor.manifest().capabilities, [
        "image-enhancement",
        "enhanced-image-generation",
    ]);
    assert.equal(descriptor.manifest().requirements.accelerator, "gpu");
    assert.deepEqual(descriptor.manifest().requirements.acceleratorPreference, ["gpu"]);
    // No model is declared: the runtime refuses one without a sha256, and the
    // Retinexformer ncnn artifact has never been produced, so declaring it
    // shipped a profile that could never run.
    assert.equal(descriptor.manifest().requirements.model, null);
});

test("low-light model metadata is replaceable without changing workload identity", () => {
    const candidate = manifest();
    candidate.requirements.model = {
        id: "replacement-model",
        version: "2.0.0",
        format: "ncnn",
        sha256: "d".repeat(64),
        fullyQuantized: false,
        minimumCompilerVersion: "replacement-compiler",
        minimumRuntimeVersion: "replacement-runtime",
    };
    const replacement = new Manifest.WorkloadDescriptor(candidate);
    assert.equal(replacement.id, "low-light-enhancement");
    assert.equal(replacement.manifest().requirements.model.id, "replacement-model");
});

test("low-light contract separates host pipeline and measurable acceptance", () => {
    const descriptor = new Manifest.WorkloadDescriptor(manifest()).manifest();
    assert.deepEqual(descriptor.pipeline.hostResponsibilities, [
        "Read images only from the configured input folder without modifying originals",
        "Decode and validate bounded image inputs",
        "Apply orientation and convert to sRGB before exact bicubic preprocessing",
        "Construct the RGB float32 NCHW tensor scaled to the unit range",
        "Validate finite enhanced RGB output with shape [1,3,256,256] in the unit range",
        "Resize validated enhanced RGB back to original geometry with bicubic interpolation",
        "Color-manage, encode, display, and route results",
        "Publish new files without overwrite only in a disjoint configured output folder",
    ]);
    const criteria = Object.fromEntries(descriptor.acceptance.map((criterion) => [
        criterion.metric,
        criterion,
    ]));
    assert.equal(criteria["vulkan-cpu-fallback-rate"].target, 0);
    assert.equal(criteria["portable-native-ssim"].target, 0.999);
    assert.equal(criteria["paired-holdout-ssim"].target, 0.8);
    assert.equal(criteria["output-range-violation-rate"].target, 0);
    assert.equal(criteria["color-error-ciede2000"].comparator, "at-most");
    assert.equal(criteria["p95-device-latency"].unit, "milliseconds");
    assert.equal(criteria["end-to-end-speedup"].target, 1.2);
});

test("low-light tensor and output contracts match the pinned Retinexformer recipe", () => {
    const model = recipe();
    assert.deepEqual(model.tensorContract, {
        inputs: [{
            shape: [1, 3, 256, 256],
            dtype: "float32",
            layout: "NCHW",
            preprocess: {
                channelOrder: "RGB",
                mean: [0, 0, 0],
                scale: [1 / 255, 1 / 255, 1 / 255],
                resize: {filter: "bicubic", fit: "exact"},
            },
        }],
    });
    assert.deepEqual(model.outputContract, {kind: "raw"});
});
