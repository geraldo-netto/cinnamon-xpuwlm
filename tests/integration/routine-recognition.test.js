"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const Fixture = require("../helpers/routine-recognition-fixture.js");
const Routine = require("../../files/cinnamon-xpuwlm@geraldo-netto/lib/routine-recognition.js");

test("routine strategies share feature windows and expose measured crossover", async () => {
    const report = await Routine.runRoutineBenchmark(Fixture.plan(), {
        clock: Fixture.clock([3, 5, 8, 6, 12, 9, 4, 6]),
    });
    assert.deepEqual(report.candidates.map((candidate) => candidate.strategy), Routine.STRATEGIES);
    assert.deepEqual(Routine.recommendRoutineCandidates(report).map((item) => item.candidateId), [
        "statistics", "vulkan",
    ]);
    assert.deepEqual(report.inputs.map((input) => input.families), [["routine"], ["routine"]]);
});
