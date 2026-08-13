"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const Fixture = require("../helpers/routine-recognition-fixture.js");
const Routine = require("../../files/cinnamon-xpuwlm@geraldo-netto/lib/routine-recognition.js");

test("regression: fast inaccurate GPU suggestions cannot win", async () => {
    const plan = Fixture.plan();
    const inaccurate = Fixture.candidate("vulkan", "gpu", "gpu-model", {
        outputs: {short: {suggestions: []}},
    });
    const report = await Routine.runRoutineBenchmark({
        ...plan,
        inputs: [plan.inputs[0]],
        candidates: plan.candidates.map((candidate) => (
            candidate.strategy === "gpu-model" ? inaccurate : candidate
        )),
    }, {clock: Fixture.clock([3, 5, 1, 6])});
    assert.equal(report.candidates[2].summaries[0].accuracy, 0);
    assert.equal(Routine.recommendRoutineCandidates(report, 1)[0].candidateId, "statistics");
});

test("regression: foreign and malformed reports fail closed", () => {
    for (const report of [null, {}, {workloadId: "other"}, {
        workloadId: Routine.WORKLOAD_ID, inputs: [], candidates: [],
    }]) {
        assert.throws(() => Routine.recommendRoutineCandidates(report), /report is invalid/u);
    }
});
