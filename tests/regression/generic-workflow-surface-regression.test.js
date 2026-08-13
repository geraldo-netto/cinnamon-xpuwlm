"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const Surface = require(
    "../../files/cinnamon-xpuwlm@geraldo-netto/lib/generic-workflow-surface.js"
);
const {definition, state, validResult} = require("../helpers/generic-workflow-fixture.js");

test("regression: large results are bounded and report omitted review evidence", () => {
    const result = validResult("labels");
    result.payload.items = Array.from({length: 30}, (_, index) => ({
        label: `label-${index}`, score: index / 30,
    }));
    const model = Surface.createSurfaceModel(definition(), state({result}));

    assert.equal(model.result.rows.length, Surface.MAX_EVIDENCE_ROWS);
    assert.equal(model.result.omitted, 6);
});

test("regression: Unicode evidence stays unchanged on review surface", () => {
    const result = validResult("media-evidence");
    result.payload.segments[0].text = "English עברית Привет مرحبا 漢字";
    const model = Surface.createSurfaceModel(definition(), state({result}));
    assert.match(model.result.rows[0].detail, /עברית Привет مرحبا 漢字/u);
});
