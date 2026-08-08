"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const Manifest = require("../../files/cinnamon-tpuwm@geraldo-netto/lib/workload-manifest.js");
const BuiltIns = require("../helpers/built-in-workloads.js");

const manifestPath = path.join(BuiltIns.ROOT, "low-light-enhancement", "manifest.json");

function manifest() {
    return JSON.parse(fs.readFileSync(manifestPath, "utf8"));
}

test("low-light enhancement is a normal disabled Visual Library workload", () => {
    const descriptor = new Manifest.WorkloadDescriptor(manifest());
    const definition = descriptor.profileDefinition();
    assert.equal(descriptor.id, "low-light-enhancement");
    assert.equal(definition.group, "Local workflows");
    assert.equal(definition.defaultEnabled, false);
    assert.ok(definition.order > 50 && definition.order < 60);
    assert.deepEqual(descriptor.manifest().capabilities, [
        "image-enhancement",
        "tonal-curve-estimation",
    ]);
});

test("low-light model metadata is replaceable without changing workload identity", () => {
    const candidate = manifest();
    candidate.requirements.model = {
        ...candidate.requirements.model,
        id: "replacement-model",
        version: "2.0.0",
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
        "Decode and validate bounded image inputs",
        "Resize, normalize, and quantize the model tensor",
        "Apply the predicted tonal curve to the full-resolution image",
        "Denoise, color-manage, encode, display, and route results",
    ]);
    const criteria = Object.fromEntries(descriptor.acceptance.map((criterion) => [
        criterion.metric,
        criterion,
    ]));
    assert.equal(criteria["edge-tpu-compiled-operations"].target, 100);
    assert.equal(criteria["quantized-ssim"].comparator, "at-least");
    assert.equal(criteria["color-error-ciede2000"].comparator, "at-most");
    assert.equal(criteria["p95-device-latency"].unit, "milliseconds");
    assert.equal(criteria["end-to-end-speedup"].target, 1.2);
});
