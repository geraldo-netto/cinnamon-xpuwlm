"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const Job = require("../../files/cinnamon-tpuwm@geraldo-netto/lib/runtime-job-contract.js");
const ViewModel = require("../../files/cinnamon-tpuwm@geraldo-netto/lib/view-model.js");

function generator(seed) {
    let state = seed >>> 0;
    return () => {
        state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
        return state / 0x1_0000_0000;
    };
}

test("fuzz: valid bounded forecasts round-trip without changing meaning", () => {
    const random = generator(0x464f5245);
    for (let iteration = 0; iteration < 1000; iteration += 1) {
        const targetFeature = "x".repeat(
            1 + Math.floor(random() * Job.MAX_FORECAST_TARGET_LENGTH),
        );
        const horizon = 1 + Math.floor(random() * Job.MAX_FORECAST_HORIZON);
        const value = (random() - 0.5) * Number.MAX_SAFE_INTEGER;
        const reading = {kind: "forecast", targetFeature, horizon, value};

        assert.deepEqual(Job.forecastReadingOf(reading), reading);
        const model = ViewModel.readingModel(reading);
        assert.equal(model.kind, "forecast");
        assert.equal(model.entries.length, 1);
        assert.match(model.entries[0], new RegExp(targetFeature, "u"));
    }
});

test("fuzz: one hostile forecast mutation is always rejected", () => {
    const random = generator(0x424f554e);
    const mutations = [
        (reading) => ({...reading, targetFeature: ""}),
        (reading) => ({...reading, targetFeature: "x".repeat(65)}),
        (reading) => ({...reading, horizon: 0}),
        (reading) => ({...reading, horizon: 129}),
        (reading) => ({...reading, value: Number.NaN}),
        (reading) => ({...reading, value: Number.POSITIVE_INFINITY}),
        (reading) => ({...reading, unit: "%"}),
    ];
    for (let iteration = 0; iteration < 1000; iteration += 1) {
        const valid = {
            kind: "forecast",
            targetFeature: `feature-${iteration}`,
            horizon: 1 + Math.floor(random() * 128),
            value: random() * 100,
        };
        const hostile = mutations[iteration % mutations.length](valid);

        assert.equal(Job.forecastReadingOf(hostile), null);
        assert.equal(ViewModel.readingModel(hostile), null);
    }
});
