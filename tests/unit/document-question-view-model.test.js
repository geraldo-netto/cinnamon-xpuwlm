"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const ViewModel = require("../../files/cinnamon-xpuwlm@geraldo-netto/lib/view-model.js");

function workflow(overrides = {}) {
    return {
        available: true,
        availabilityDetail: "",
        phase: "idle",
        sources: [],
        jobId: "",
        message: "",
        progress: null,
        answer: "",
        providerId: "",
        accelerator: "",
        citations: [],
        ...overrides,
    };
}

test("document question projection is hidden until ready or explicitly active", () => {
    assert.equal(ViewModel.documentQuestionModel({}), null);
    assert.equal(ViewModel.documentQuestionModel({documentQuestion: null}), null);
    assert.equal(ViewModel.documentQuestionModel({
        documentQuestion: workflow({available: false}),
    }), null);
    assert.equal(ViewModel.documentQuestionModel({
        documentQuestion: workflow({available: false, phase: "error"}),
    }).available, false);
});

test("document question projection preserves answer, exact citations, and phase controls", () => {
    const citation = {
        fileId: "selected-file-1",
        fileName: "guide.pdf",
        sourceSha256: "a".repeat(64),
        page: 3,
        span: {start: 10, end: 42},
        textSha256: "b".repeat(64),
    };
    const complete = ViewModel.documentQuestionModel({documentQuestion: workflow({
        phase: "complete",
        sources: [{name: "guide.pdf"}],
        progress: {fraction: 1, detail: "Answer ready"},
        answer: "Restart the service.",
        providerId: "qwen3-gpu",
        accelerator: "gpu",
        citations: [citation],
    })});
    assert.equal(complete.title, "Ask selected files");
    assert.equal(complete.complete, true);
    assert.equal(complete.chooserEnabled, true);
    assert.equal(complete.askEnabled, false);
    assert.equal(complete.cancelEnabled, false);
    assert.equal(complete.progressText, "100% · Answer ready");
    assert.equal(complete.citations[0].text, "guide.pdf · page 3 · span 10–42");
    assert.deepEqual(complete.limits, {sources: 16, questionCharacters: 4096});

    const phases = {
        idle: [true, false, false],
        selecting: [false, false, false],
        selected: [true, true, false],
        submitting: [false, false, true],
        running: [false, false, true],
        cancelling: [false, false, false],
        error: [true, false, false],
    };
    for (const [phase, expected] of Object.entries(phases)) {
        const model = ViewModel.documentQuestionModel({documentQuestion: workflow({phase})});
        assert.deepEqual(
            [model.chooserEnabled, model.askEnabled, model.cancelEnabled], expected, phase,
        );
    }
});

test("citation text never includes source paths or source content", () => {
    assert.equal(ViewModel.documentCitationText({
        fileName: "notes.txt", page: 1, span: {start: 0, end: 12},
    }), "notes.txt · page 1 · span 0–12");
});
