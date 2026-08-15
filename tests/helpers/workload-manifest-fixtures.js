"use strict";

function validWorkloadManifest(overrides = {}) {
    return {
        manifestVersion: 1,
        id: "sample-workload",
        version: "1.0.0",
        capabilities: ["classify"],
        requirements: {
            runtimeApi: 1,
            accelerator: "tpu",
            acceleratorPreference: ["tpu", "npu", "gpu"],
            minimumDevices: 1,
            model: {
                id: "sample-model",
                version: "1.0.0",
                format: "tflite-edgetpu",
                // Which file the model is. The runtime refuses a model without
                // one, so the schema requires it.
                sha256: "a".repeat(64),
                fullyQuantized: true,
                minimumCompilerVersion: "16",
                minimumRuntimeVersion: "16",
            },
        },
        ui: {
            title: "Sample workload",
            group: "Examples",
            description: "Classifies bounded sample inputs",
            icon: "applications-science-symbolic",
            order: 10,
        },
        defaults: {enabled: false, weight: 2},
        pipeline: {hostResponsibilities: ["Decode bounded inputs"]},
        acceptance: [{
            metric: "accuracy",
            comparator: "at-least",
            target: 0.8,
            unit: "ratio",
            description: "Holdout accuracy reaches baseline",
        }],
        ...overrides,
    };
}

function validPluginSubtree(overrides = {}) {
    return {
        entryPoint: "sample-worker",
        protocol: {minimum: 1, maximum: 2, capabilities: ["stream-input"]},
        schemas: {configuration: {}, input: {}, output: {}},
        triggers: ["manual", "periodic"],
        artifacts: [{
            id: "sample-model",
            version: "1.0.0",
            format: "tflite-edgetpu",
            sha256: "a".repeat(64),
        }],
        permissions: ["fs:read/tmp/sample"],
        ...overrides,
    };
}

// A version 2 manifest is a version 1 manifest plus the `plugin` subtree: the
// subtree is what the version number means.
function validPluginWorkloadManifest(overrides = {}) {
    return validWorkloadManifest({
        manifestVersion: 2,
        plugin: validPluginSubtree(),
        ...overrides,
    });
}

module.exports = {validPluginSubtree, validPluginWorkloadManifest, validWorkloadManifest};
