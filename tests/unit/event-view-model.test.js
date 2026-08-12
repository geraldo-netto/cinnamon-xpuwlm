"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const ViewModel = require("../../files/cinnamon-xpuwlm@geraldo-netto/lib/view-model.js");

function workflow(overrides = {}) {
    return {
        available: true,
        availabilityDetail: "",
        phase: "idle",
        selectionKind: "",
        sources: [],
        jobId: "",
        progress: null,
        message: "",
        candidates: [],
        duplicatesDropped: 0,
        exportedPath: "",
        ...overrides,
    };
}

function candidate(id, confirmation, overrides = {}) {
    return {
        candidateId: id,
        title: `Event ${id}`,
        start: "2026-08-11T10:00:00+02:00",
        end: "2026-08-11T11:00:00+02:00",
        timezone: "Europe/Rome",
        location: "Studio",
        confirmation,
        evidence: [{
            sourceRef: "private:job:source:1:page:3",
            sourceSha256: "a".repeat(64),
            page: 3,
            span: {start: 5, end: 12},
            textSha256: "b".repeat(64),
        }],
        ...overrides,
    };
}

test("event projection is absent until ready or an explicit workflow exists", () => {
    assert.equal(ViewModel.eventImportModel({}), null);
    assert.equal(ViewModel.eventImportModel({eventImport: null}), null);
    assert.equal(ViewModel.eventImportModel({eventImport: workflow({available: false})}), null);
    assert.equal(ViewModel.eventImportModel({eventImport: workflow({
        available: false, message: "Selection cancelled",
    })}).message, "Selection cancelled");
    assert.equal(ViewModel.eventImportModel({
        eventImport: workflow({available: false, phase: "error", message: "setup"}),
    }).available, false);
});

test("event projection maps candidates, evidence, decisions, and nullable edits exactly", () => {
    const model = ViewModel.eventImportModel({eventImport: workflow({
        phase: "preview",
        sources: [{name: "notes.pdf"}],
        progress: {fraction: 0.75, detail: "Review"},
        candidates: [
            candidate("one", "confirmed"),
            candidate("two", "rejected", {end: null, location: null, evidence: [{
                ...candidate("x", "pending").evidence[0], sourceRef: "private:job:source:1", page: null,
            }]}),
            candidate("three", "pending"),
        ],
    })});

    assert.equal(model.title, "Extract calendar events");
    assert.equal(model.chooserEnabled, true);
    assert.equal(model.startEnabled, false);
    assert.equal(model.cancelEnabled, false);
    assert.equal(model.preview, true);
    assert.equal(model.confirmation, false);
    assert.equal(model.complete, false);
    assert.equal(model.confirmed, 1);
    assert.equal(model.rejected, 1);
    assert.equal(model.pending, 1);
    assert.equal(model.exportRefusal, "Decide whether to keep or reject every candidate");
    assert.equal(model.progressText, "75% · Review");
    assert.deepEqual(model.candidates.map((item) => ({
        id: item.candidateId,
        end: item.endText,
        location: item.locationText,
        kept: item.kept,
        rejected: item.rejected,
        evidence: item.evidenceText[0],
    })), [
        {id: "one", end: "2026-08-11T11:00:00+02:00", location: "Studio", kept: true, rejected: false, evidence: "Evidence: notes.pdf · page 3 · characters 5–12"},
        {id: "two", end: "", location: "", kept: false, rejected: true, evidence: "Evidence: notes.pdf · characters 5–12"},
        {id: "three", end: "2026-08-11T11:00:00+02:00", location: "Studio", kept: false, rejected: false, evidence: "Evidence: notes.pdf · page 3 · characters 5–12"},
    ]);
});

test("event phase flags preserve chooser, start, cancellation, confirmation, and completion", () => {
    const expected = {
        idle: [true, false, false, false, false, false],
        selecting: [false, false, false, false, false, false],
        selected: [true, true, false, false, false, false],
        submitting: [false, false, true, false, false, false],
        running: [false, false, true, false, false, false],
        cancelling: [false, false, false, false, false, false],
        preview: [true, false, false, true, false, false],
        "confirm-export": [true, false, false, false, true, false],
        exporting: [false, false, false, true, false, false],
        complete: [true, false, false, false, false, true],
        error: [true, false, false, false, false, false],
    };
    for (const [phase, flags] of Object.entries(expected)) {
        const model = ViewModel.eventImportModel({eventImport: workflow({phase})});
        assert.deepEqual([
            model.chooserEnabled, model.startEnabled, model.cancelEnabled,
            model.preview, model.confirmation, model.complete,
        ], flags, phase);
    }
    const unavailable = ViewModel.eventImportModel({eventImport: workflow({
        available: false, phase: "selected",
    })});
    assert.equal(unavailable.chooserEnabled, false);
    assert.equal(unavailable.startEnabled, false);
});
