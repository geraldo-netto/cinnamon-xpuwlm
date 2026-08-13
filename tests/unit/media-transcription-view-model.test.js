"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const ViewModel = require("../../files/cinnamon-xpuwlm@geraldo-netto/lib/view-model.js");

function workflow(overrides = {}) {
    return {
        available: true, availabilityDetail: "", phase: "idle", sources: [],
        jobId: "", message: "", progress: null, providerId: "", accelerator: "",
        result: null,
        ...overrides,
    };
}

function result() {
    return {
        source: {fileName: "clip.mp4", modality: "video"},
        speech: {
            language: "he",
            segments: [{startMs: 7, endMs: 1007, text: "שלום"}],
        },
        visuals: [
            {
                timestampMs: 0, slideNumber: null, pageNumber: null,
                visibleText: "עברית", description: "Title card.",
            },
            {
                timestampMs: null, slideNumber: null, pageNumber: null,
                visibleText: "", description: "Still image.",
            },
        ],
    };
}

test("media projection stays hidden until available or explicitly active", () => {
    assert.equal(ViewModel.mediaTranscriptionModel({mediaTranscription: null}), null);
    assert.equal(ViewModel.mediaTranscriptionModel({}), null);
    assert.equal(ViewModel.mediaTranscriptionModel({
        mediaTranscription: workflow({available: false}),
    }), null);
    assert.notEqual(ViewModel.mediaTranscriptionModel({
        mediaTranscription: workflow({available: false, phase: "error"}),
    }), null);
    assert.equal(ViewModel.mediaWorkflowVisible(workflow()), true);
});

test("media projection formats exact speech, visual, and copy evidence", () => {
    const model = ViewModel.mediaTranscriptionModel({
        mediaTranscription: workflow({
            phase: "complete", providerId: "media-vulkan", accelerator: "gpu",
            result: result(),
        }),
    });
    assert.equal(model.complete, true);
    assert.equal(model.language, "he");
    assert.equal(model.modality, "video");
    assert.equal(model.speech[0].timeText, "00:00:00.007–00:00:01.007");
    assert.deepEqual(model.visuals.map((item) => item.timeText), [
        "Frame 00:00:00.000", "Image",
    ]);
    assert.match(model.copyText, /שלום/u);
    assert.match(model.copyText, /Visible text: עברית/u);

    const presentation = ViewModel.mediaResultModel({
        source: {fileName: "slides.pptx", modality: "presentation"},
        speech: {language: null, segments: []},
        visuals: [{
            timestampMs: null, slideNumber: 1, pageNumber: null,
            visibleText: "שלום Привет", description: "Title slide.",
        }],
    });
    assert.equal(presentation.visuals[0].timeText, "Slide 1");
    const document = ViewModel.mediaResultModel({
        source: {fileName: "report.pdf", modality: "document"},
        speech: {language: null, segments: []},
        visuals: [{
            timestampMs: null, slideNumber: null, pageNumber: 1,
            visibleText: "שלום", description: "Page.",
        }],
    });
    assert.equal(document.visuals[0].timeText, "Page 1");
});

test("media phase matrix exposes only truthful controls", () => {
    const expected = {
        idle: [true, false, false],
        selecting: [false, false, false],
        selected: [true, true, false],
        submitting: [false, false, true],
        running: [false, false, true],
        cancelling: [false, false, false],
        error: [true, false, false],
    };
    for (const [phase, controls] of Object.entries(expected)) {
        const model = ViewModel.mediaTranscriptionModel({
            mediaTranscription: workflow({phase}),
        });
        assert.deepEqual(
            [model.chooserEnabled, model.startEnabled, model.cancelEnabled],
            controls,
            phase,
        );
    }
    assert.deepEqual(ViewModel.mediaResultModel(null), {
        copyText: "", speech: [], language: "", visuals: [], modality: "",
    });
});
