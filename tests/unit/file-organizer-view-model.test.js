"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const ViewModel = require("../../files/cinnamon-xpuwlm@geraldo-netto/lib/view-model.js");

function workflow(overrides = {}) {
    return {
        available: true,
        availabilityDetail: "",
        phase: "complete",
        sources: [{name: "guide.pdf"}],
        jobId: "job-1",
        message: "Review-only plan ready; no files changed",
        progress: {fraction: 1, detail: "Plan ready"},
        providerId: "qwen3-gpu",
        accelerator: "gpu",
        plan: [{
            fileId: "selected-file-1",
            fileName: "guide.pdf",
            sourceSha256: "a".repeat(64),
            tags: ["project-notes", "mars"],
            proposedName: "mars-guide.pdf",
            proposedFolder: "Projects/Mars",
            duplicateGroup: "duplicate-group-1",
            reason: "Grounded reason",
            evidence: [{
                fileId: "selected-file-1",
                fileName: "guide.pdf",
                sourceSha256: "a".repeat(64),
                page: 3,
                span: {start: 10, end: 42},
                textSha256: "b".repeat(64),
            }],
        }],
        ...overrides,
    };
}

test("file organizer projection is hidden until ready or explicitly active", () => {
    assert.equal(ViewModel.fileOrganizerModel({fileOrganizer: null}), null);
    assert.equal(ViewModel.fileOrganizerModel({}), null);
    assert.equal(ViewModel.fileOrganizerModel({fileOrganizer: workflow({
        available: false, phase: "idle", message: "",
    })}), null);
    assert.notEqual(ViewModel.fileOrganizerModel({fileOrganizer: workflow({
        available: true, phase: "idle", message: "",
    })}), null);
    assert.notEqual(ViewModel.fileOrganizerModel({fileOrganizer: workflow({
        available: false, phase: "running", message: "",
    })}), null);
    assert.equal(ViewModel.fileOrganizerModel({fileOrganizer: workflow({
        available: false, phase: "idle", message: "Selection cancelled",
    })}).message, "Selection cancelled");
    assert.notEqual(ViewModel.fileOrganizerModel({fileOrganizer: workflow({
        available: false, phase: "error",
    })}), null);
});

test("file organizer projection preserves exact review text and controls", () => {
    const model = ViewModel.fileOrganizerModel({fileOrganizer: workflow()});
    assert.equal(model.title, "File organizer");
    assert.equal(model.chooserEnabled, true);
    assert.equal(model.startEnabled, false);
    assert.equal(model.cancelEnabled, false);
    assert.equal(model.complete, true);
    assert.equal(model.progressText, "100% · Plan ready");
    assert.equal(model.plan[0].tagsText, "project-notes, mars");
    assert.equal(model.plan[0].nameText, "Suggested name: mars-guide.pdf");
    assert.equal(model.plan[0].folderText, "Suggested folder: Projects/Mars");
    assert.equal(model.plan[0].duplicateText, "Exact duplicate group: duplicate-group-1");
    assert.equal(model.plan[0].evidence[0].text, "guide.pdf · page 3 · span 10–42");
    assert.deepEqual(model.limits, {sources: 16});
});

test("file organizer projection names null suggestions without inventing changes", () => {
    const plan = workflow().plan.map((item) => ({
        ...item,
        tags: [],
        proposedName: null,
        proposedFolder: null,
        duplicateGroup: null,
    }));
    const model = ViewModel.fileOrganizerModel({fileOrganizer: workflow({plan})});
    assert.equal(model.plan[0].tagsText, "No tags suggested");
    assert.equal(model.plan[0].nameText, "Keep current name");
    assert.equal(model.plan[0].folderText, "Keep current folder");
    assert.equal(model.plan[0].duplicateText, "No exact duplicate in this selection");
    assert.equal(ViewModel.organizerEvidenceText(plan[0].evidence[0]), "guide.pdf · page 3 · span 10–42");
});

test("file organizer phase controls cannot start or choose during execution", () => {
    for (const phase of ["selecting", "submitting", "running", "cancelling"]) {
        const model = ViewModel.fileOrganizerModel({fileOrganizer: workflow({phase})});
        assert.equal(model.chooserEnabled, false, phase);
        assert.equal(model.startEnabled, false, phase);
    }
    const selected = ViewModel.fileOrganizerModel({fileOrganizer: workflow({phase: "selected"})});
    assert.equal(selected.startEnabled, true);
    const running = ViewModel.fileOrganizerModel({fileOrganizer: workflow({phase: "running"})});
    assert.equal(running.cancelEnabled, true);
});
