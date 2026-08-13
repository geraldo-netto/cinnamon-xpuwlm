"use strict";

function payloads() {
    return {
        "risk-score": {
            score: 0.8, threshold: 0.7, label: "elevated", evidenceIds: ["sensor-1"],
        },
        forecast: {
            horizon: 2,
            unit: "requests",
            points: [
                {offset: 1, value: 10, lower: 8, upper: 12},
                {offset: 2, value: 12, lower: 9, upper: 15},
            ],
        },
        ranking: {
            items: [
                {id: "test-a", rank: 1, score: 0.9},
                {id: "test-b", rank: 2, score: 0.5},
            ],
        },
        detection: {
            items: [{label: "person", score: 0.9, box: {
                x: 0.1, y: 0.2, width: 0.3, height: 0.4,
            }}],
        },
        mask: {
            width: 4, height: 4, sourceWidth: 8, sourceHeight: 8,
            encoding: "rle", dataSha256: "a".repeat(64),
        },
        embedding: {dimensions: 3, dtype: "float32", vector: [0.1, 0.2, 0.3]},
        labels: {items: [{label: "rock", score: 0.8}, {label: "pop", score: 0.2}]},
        "media-evidence": {
            durationMs: 2000,
            segments: [{
                startMs: 0, endMs: 1000, kind: "speech", text: "Hello",
                confidence: 0.9, sourceRef: "audio-1",
            }],
        },
    };
}

function valid(kind = "risk-score", overrides = {}) {
    return {
        version: 1,
        kind,
        workloadId: "queue-health",
        operationId: "run-1",
        createdAt: 1234,
        payload: payloads()[kind],
        ...overrides,
    };
}

function clone(value) {
    return JSON.parse(JSON.stringify(value));
}

module.exports = {payloads, valid, clone};
