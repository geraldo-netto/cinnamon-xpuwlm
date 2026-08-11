"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const Job = require("../../files/cinnamon-xpuwlm@geraldo-netto/lib/runtime-job-contract.js");
const ViewModel = require("../../files/cinnamon-xpuwlm@geraldo-netto/lib/view-model.js");

test("a canonical forecast is not discarded by classification-only parsing", () => {
    const output = {
        outputs: [[[0.75]]],
        reading: {kind: "forecast", targetFeature: "load", horizon: 2, value: 0.75},
    };

    const reading = Job.readingOf(output);
    assert.deepEqual(reading, output.reading);
    assert.deepEqual(ViewModel.readingModel(reading), {
        kind: "forecast",
        entries: ["Forecast · load · 2 observations ahead · 0.75"],
    });
});

test("a forecast carrying invented metadata never reaches the UI", () => {
    const reading = {
        kind: "forecast",
        targetFeature: "load",
        horizon: 2,
        value: 0.75,
        confidence: 0.99,
    };

    assert.equal(Job.readingOf({reading}), null);
    assert.equal(ViewModel.readingModel(reading), null);
});
