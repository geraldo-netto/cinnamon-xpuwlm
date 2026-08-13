"use strict";

const A = "a".repeat(64);
const B = "b".repeat(64);
const C = "c".repeat(64);
const SIGNATURE = `${"A".repeat(86)}==`;

function valid(overrides = {}) {
    return {
        version: 1,
        artifactId: "queue-forecast",
        artifactVersion: "1.2.3",
        recipe: {
            id: "forecast-recipe", revision: "1.0.0", sha256: A,
            reviewedBy: "model-review-team", reviewedAt: 1_700_000_000_000,
        },
        portableExport: {format: "onnx", sha256: B},
        nativeBinding: {
            backend: "ncnn-vulkan", paramSha256: B, weightsSha256: C,
            minimumNcnnVersion: "20260801", vulkanRequired: true,
        },
        tensorContractSha256: C,
        license: {spdxId: "Apache-2.0", sourceUrl: "https://example.invalid/model", noticeSha256: A},
        signature: {algorithm: "ed25519", keyId: "release-key", value: SIGNATURE},
        hardwareEvidence: {
            deviceName: "AMD Radeon RX 7900 XTX",
            driverVersion: "Mesa 26.1.0",
            runtimeVersion: "ncnn 20260801",
            benchmarkVersion: 1,
            benchmarkRecordSha256: B,
            measuredAt: 1_700_000_100_000,
            decision: "accepted",
        },
        ...overrides,
    };
}

module.exports = {A, B, C, SIGNATURE, valid};
