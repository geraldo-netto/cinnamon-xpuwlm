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

module.exports = {validWorkloadManifest};
