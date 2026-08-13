"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const Fixture = require("../helpers/file-auto-tagging-fixture.js");
const Tagging = require("../../files/cinnamon-xpuwlm@geraldo-netto/lib/file-auto-tagging.js");

test("regression: a fast inaccurate GPU never displaces an accurate host", async () => {
    const base = Fixture.plan();
    const candidates = [
        base.candidates[0],
        Fixture.candidate("vulkan", "gpu", {
            outputs: {"one-image": {tags: {"image-1": ["wrong"]}}},
        }),
        base.candidates[2],
    ];
    const report = await Tagging.runAutoTaggingBenchmark(
        {...base, warmupRuns: 0, candidates},
        {clock: Fixture.clock([5, 1, 7, 20, 1, 8])},
    );
    const recommendation = Tagging.recommendTaggers(report, 1);
    assert.equal(recommendation[0].candidateId, "metadata");
    assert.equal(report.candidates[1].summaries[0].accuracy, 0);
});

test("regression: no candidate is recommended below the measured accuracy floor", async () => {
    const base = Fixture.plan();
    const candidates = base.candidates.map((candidate) => Fixture.candidate(
        candidate.id,
        candidate.kind,
        {outputs: {
            "one-image": {tags: {"image-1": ["wrong"]}},
            "document-batch": {tags: {"document-1": ["wrong"], "image-2": ["wrong"]}},
        }},
    ));
    const report = await Tagging.runAutoTaggingBenchmark(
        {...base, warmupRuns: 0, candidates},
        {clock: Fixture.clock([1, 1, 1, 1, 1, 1])},
    );
    assert.equal(Tagging.recommendTaggers(report, 1).every((item) => (
        item.candidateId === null && item.reason === "accuracy-threshold-not-met"
    )), true);
    for (const invalid of [
        null,
        {},
        {...report, workloadId: "other"},
        {...report, inputs: []},
        {...report, inputs: [{...report.inputs[0], families: null}]},
        {...report, candidates: []},
        {...report, candidates: [{...report.candidates[0], summaries: []}]},
        {...report, candidates: [{
            ...report.candidates[0],
            summaries: report.candidates[0].summaries.map((summary) => ({
                ...summary, p95LatencyMs: -1,
            })),
        }]},
    ]) {
        assert.throws(() => Tagging.recommendTaggers(invalid), /report is invalid/u);
    }
    for (const invalid of [-1, 1.1, Number.NaN, "one"]) {
        assert.throws(() => Tagging.recommendTaggers(report, invalid), /report is invalid/u);
    }
});

test("regression: deterministic latency ties never imply GPU preference", async () => {
    const base = Fixture.plan({warmupRuns: 0});
    const report = await Tagging.runAutoTaggingBenchmark(base, {
        clock: Fixture.clock([1, 1, 1, 1, 1, 1]),
    });
    assert.deepEqual(
        Tagging.recommendTaggers(report).map((item) => item.candidateId),
        ["metadata", "metadata"],
    );
});
