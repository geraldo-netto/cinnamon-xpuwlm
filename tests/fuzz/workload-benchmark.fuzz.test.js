"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const Benchmark = require("../../files/cinnamon-xpuwlm@geraldo-netto/lib/workload-benchmark.js");

function generator(seed) {
    let state = seed >>> 0;
    return () => {
        state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
        return state / 0x1_0000_0000;
    };
}

test("fuzz: bounded observations are accepted exactly across resource combinations", () => {
    const random = generator(0x42454e43);
    for (let iteration = 0; iteration < 2000; iteration += 1) {
        const nullable = () => random() < 0.25 ? null : Math.floor(random() * 10_000);
        const observation = {
            correct: random() < 0.5,
            stages: {
                preprocessingMs: random() * 100,
                transferMs: random() * 100,
                inferenceMs: random() * 100,
                postprocessingMs: random() * 100,
            },
            memoryBytes: nullable(),
            vramBytes: nullable(),
            energyMilliJoules: nullable(),
            contentionMs: random() * 100,
        };
        assert.equal(Benchmark.validObservation(observation), true);

        const names = ["correct", "stages", "memoryBytes", "vramBytes", "energyMilliJoules", "contentionMs"];
        const hostile = {...observation, [names[iteration % names.length]]: undefined};
        assert.equal(Benchmark.validObservation(hostile), false);
    }
});

test("property: percentile always returns an observed value at bounded percentiles", () => {
    const random = generator(0x50455243);
    for (let iteration = 1; iteration <= 1000; iteration += 1) {
        const length = 1 + Math.floor(random() * 64);
        const values = Array.from({length}, () => Math.floor(random() * 1_000_000));
        const percentage = random();
        const selected = Benchmark.percentile(values, percentage);
        assert.equal(values.includes(selected), true);
    }
});
