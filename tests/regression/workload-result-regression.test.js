"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const Result = require("../../files/cinnamon-xpuwlm@geraldo-netto/lib/workload-result.js");
const {valid} = require("../helpers/workload-result-fixture.js");

test("regression: Unicode media evidence survives cloning without shared state", () => {
    const source = valid("media-evidence");
    source.payload.segments[0].text = "English עברית Привет مرحبا 漢字";
    const result = Result.createWorkloadResult(source);
    source.payload.segments[0].text = "mutated";

    assert.equal(result.payload.segments[0].text, "English עברית Привет مرحبا 漢字");
    assert.equal(Result.isWorkloadResult(result), true);
});

test("regression: payloads cannot be reinterpreted under another result kind", () => {
    const risk = valid("risk-score");
    assert.equal(Result.isWorkloadResult({...risk, kind: "forecast"}), false);
});
