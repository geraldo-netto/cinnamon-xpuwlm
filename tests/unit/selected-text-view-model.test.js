"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const Selected = require("../../files/cinnamon-xpuwlm@geraldo-netto/lib/selected-text.js");
const ViewModel = require("../../files/cinnamon-xpuwlm@geraldo-netto/lib/view-model.js");

function workflow(overrides = {}) {
    return {...Selected.initialState(), available: true, availabilityDetail: "", ...overrides};
}

test("selected-text projection is hidden until ready or explicitly active", () => {
    assert.equal(ViewModel.selectedTextModel({}), null);
    assert.equal(ViewModel.selectedTextModel({selectedText: null}), null);
    assert.equal(ViewModel.selectedTextModel({selectedText: workflow({available: false})}), null);
    assert.equal(ViewModel.selectedTextModel({
        selectedText: workflow({available: false, phase: "error"}),
    }).available, false);
});

test("selected-text projection preserves review evidence and exact phase controls", () => {
    const complete = ViewModel.selectedTextModel({selectedText: workflow({
        phase: "complete",
        result: "Summary", tasks: ["Task"], providerId: "qwen3-gpu", accelerator: "gpu",
        progress: {fraction: 1, detail: "Result ready"},
        evidence: {
            selectionSha256: "a".repeat(64), textSha256: "a".repeat(64),
            span: {start: 0, end: 7},
        },
    })});
    assert.equal(complete.title, "Work with selected text");
    assert.equal(complete.complete, true);
    assert.equal(complete.operationEnabled, true);
    assert.equal(complete.cancelEnabled, false);
    assert.equal(complete.progressText, "100% · Result ready");
    assert.equal(complete.evidenceText, "Selection digest aaaaaaaaaaaa · span 0–7");
    assert.deepEqual(complete.operations, Selected.OPERATIONS);
    const phases = {
        idle: [true, false], selecting: [false, true], submitting: [false, true],
        running: [false, true], cancelling: [false, false], error: [true, false],
    };
    for (const [phase, expected] of Object.entries(phases)) {
        const model = ViewModel.selectedTextModel({selectedText: workflow({phase})});
        assert.deepEqual([model.operationEnabled, model.cancelEnabled], expected, phase);
    }
    assert.equal(ViewModel.selectedTextModel({
        selectedText: workflow({evidence: null}),
    }).evidenceText, "");
});
