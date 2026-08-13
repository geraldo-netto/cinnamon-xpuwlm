"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const Result = require("../../files/cinnamon-xpuwlm@geraldo-netto/lib/workload-result.js");
const {payloads, valid} = require("../helpers/workload-result-fixture.js");

function changed(kind, patch) {
    const value = valid(kind);
    return {...value, payload: {...value.payload, ...patch}};
}

test("all closed result families create immutable cloned envelopes", () => {
    assert.deepEqual(Result.RESULT_KINDS, Object.keys(payloads()));
    for (const kind of Result.RESULT_KINDS) {
        const source = valid(kind);
        const result = Result.createWorkloadResult(source);
        assert.equal(Result.isWorkloadResult(result), true);
        assert.equal(Object.isFrozen(result), true);
        assert.equal(Object.isFrozen(result.payload), true);
        source.workloadId = "changed";
        assert.equal(result.workloadId, "queue-health");
    }
});

test("result envelope rejects malformed roots without throwing", () => {
    const base = valid();
    const invalid = [
        null, [], {}, {...base, extra: true}, {...base, version: 2},
        {...base, kind: "unknown"}, {...base, workloadId: "Bad id"},
        {...base, operationId: ""}, {...base, createdAt: -1},
        {...base, createdAt: 1.5}, {...base, payload: null},
    ];
    for (const candidate of invalid) {
        assert.doesNotThrow(() => Result.isWorkloadResult(candidate));
        assert.equal(Result.isWorkloadResult(candidate), false);
        assert.throws(() => Result.createWorkloadResult(candidate), Result.ResultError);
    }
});

test("risk scores and forecasts enforce probability, evidence, and interval bounds", () => {
    const invalid = [
        changed("risk-score", {score: -0.1}),
        changed("risk-score", {threshold: 1.1}),
        changed("risk-score", {label: ""}),
        changed("risk-score", {evidenceIds: ["same", "same"]}),
        changed("risk-score", {evidenceIds: ["Bad id"]}),
        changed("forecast", {horizon: 0}),
        changed("forecast", {unit: ""}),
        changed("forecast", {points: []}),
        changed("forecast", {points: [{offset: 1, value: 7, lower: 8, upper: 9}]}),
        changed("forecast", {points: [{offset: 1, value: 9, lower: 8, upper: 7}]}),
        changed("forecast", {points: [{offset: 3, value: 9, lower: 8, upper: 10}]}),
        changed("forecast", {points: [
            {offset: 1, value: 9, lower: 8, upper: 10},
            {offset: 1, value: 9, lower: 8, upper: 10},
        ]}),
    ];
    for (const candidate of invalid) {
        assert.equal(Result.isWorkloadResult(candidate), false);
    }
});

test("rankings and detections enforce identity, order, scores, and normalized boxes", () => {
    const ranked = payloads().ranking.items[0];
    const detected = payloads().detection.items[0];
    const invalid = [
        changed("ranking", {items: []}),
        changed("ranking", {items: [{...ranked, id: "Bad id"}]}),
        changed("ranking", {items: [{...ranked, rank: 0}]}),
        changed("ranking", {items: [{...ranked, score: Number.NaN}]}),
        changed("ranking", {items: [ranked, {...ranked}]}),
        changed("ranking", {items: [ranked, {...ranked, id: "other"}]}),
        changed("detection", {items: [{...detected, score: 2}]}),
        changed("detection", {items: [{...detected, label: ""}]}),
        changed("detection", {items: [{...detected, box: {...detected.box, width: 0}}]}),
        changed("detection", {items: [{...detected, box: {...detected.box, x: 0.8}}]}),
        changed("detection", {items: [{...detected, box: {...detected.box, y: 0.8}}]}),
    ];
    for (const candidate of invalid) {
        assert.equal(Result.isWorkloadResult(candidate), false);
    }
    assert.equal(Result.isWorkloadResult(changed("detection", {items: []})), true);
});

test("masks, embeddings, and labels enforce bounded typed payloads", () => {
    const label = payloads().labels.items[0];
    const invalid = [
        changed("mask", {width: 0}),
        changed("mask", {height: 65537}),
        changed("mask", {sourceWidth: 1.5}),
        changed("mask", {encoding: "jpeg"}),
        changed("mask", {dataSha256: "a".repeat(63)}),
        changed("embedding", {dimensions: 0}),
        changed("embedding", {dimensions: 2}),
        changed("embedding", {dtype: "float64"}),
        changed("embedding", {vector: null}),
        changed("embedding", {vector: [0.1, Number.POSITIVE_INFINITY, 0.3]}),
        changed("labels", {items: []}),
        changed("labels", {items: [label, {...label}]}),
        changed("labels", {items: [{...label, score: -1}]}),
    ];
    for (const candidate of invalid) {
        assert.equal(Result.isWorkloadResult(candidate), false);
    }
});

test("timestamped media evidence stays bounded to source duration", () => {
    const segment = payloads()["media-evidence"].segments[0];
    const invalid = [
        changed("media-evidence", {durationMs: 0}),
        changed("media-evidence", {segments: []}),
        changed("media-evidence", {segments: [{...segment, startMs: -1}]}),
        changed("media-evidence", {segments: [{...segment, endMs: 0}]}),
        changed("media-evidence", {segments: [{...segment, endMs: 2001}]}),
        changed("media-evidence", {segments: [{...segment, kind: "music"}]}),
        changed("media-evidence", {segments: [{...segment, text: ""}]}),
        changed("media-evidence", {segments: [{...segment, confidence: 2}]}),
        changed("media-evidence", {segments: [{...segment, sourceRef: "Bad ref"}]}),
    ];
    for (const candidate of invalid) {
        assert.equal(Result.isWorkloadResult(candidate), false);
    }
});

test("exported payload predicates reject hostile values", () => {
    const validators = [
        Result.riskScore, Result.forecast, Result.ranking, Result.detection,
        Result.mask, Result.embedding, Result.labels, Result.mediaEvidence,
    ];
    for (const validator of validators) {
        for (const value of [null, [], {}, "value", 1]) {
            assert.doesNotThrow(() => validator(value));
            assert.equal(validator(value), false);
        }
    }
});
