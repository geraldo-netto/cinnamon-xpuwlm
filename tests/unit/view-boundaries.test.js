"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const Menu = require("../../files/cinnamon-xpuwlm@geraldo-netto/lib/menu-view.js");
const ViewModel = require("../../files/cinnamon-xpuwlm@geraldo-netto/lib/view-model.js");
const WorkflowMenu = require(
    "../../files/cinnamon-xpuwlm@geraldo-netto/lib/workflow-menu-view.js",
);
const WorkflowViewModel = require(
    "../../files/cinnamon-xpuwlm@geraldo-netto/lib/workflow-view-model.js",
);

const ROOT = path.resolve(__dirname, "../../files/cinnamon-xpuwlm@geraldo-netto/lib");
const PROJECTION_EXPORTS = Object.freeze([
    "JOB_STATE_LABELS",
    "MAX_READING_ROWS",
    "MAX_RUN_PICTURES",
    "TOOL_SPECS",
    "activityModel",
    "canServe",
    "documentCitationText",
    "documentQuestionModel",
    "eventCandidateModel",
    "eventImportModel",
    "evidenceText",
    "fileOrganizerModel",
    "forecastReadingText",
    "jobActivity",
    "jobModel",
    "mediaResultModel",
    "mediaSpeechModel",
    "mediaTranscriptionModel",
    "mediaVisualModel",
    "mediaWorkflowVisible",
    "omittedCount",
    "organizerEvidenceText",
    "progressText",
    "readingModel",
    "runModel",
    "runReason",
    "selectedTextModel",
    "toolModels",
    "usesLegacyPictureReadiness",
    "workflowActivity",
]);

test("view-model facade preserves every extracted workflow projection", () => {
    for (const name of PROJECTION_EXPORTS) {
        assert.equal(ViewModel[name], WorkflowViewModel[name], name);
    }
});

test("workflow renderer contract installs exact methods on MenuView", () => {
    assert.deepEqual(WorkflowMenu.WORKFLOW_RENDERER_NAMES, [
        "_renderFileOrganizer",
        "_renderMediaTranscription",
        "_renderMediaStatus",
        "_renderMediaResult",
        "_renderMediaActions",
        "_renderFileOrganizerStatus",
        "_renderFileOrganizerSources",
        "_renderFileOrganizerPlan",
        "_renderFileOrganizerActions",
        "_renderSelectedText",
        "_renderSelectedTextStatus",
        "_renderSelectedTextActions",
        "_renderSelectedTextOperations",
        "_renderSelectedTextResult",
        "_renderDocumentQuestion",
        "_renderDocumentQuestionStatus",
        "_renderDocumentQuestionSources",
        "_documentQuestionEntry",
        "_renderDocumentQuestionResult",
        "_renderDocumentQuestionActions",
        "_renderEventImport",
        "_renderEventSources",
        "_renderEventPreview",
        "_eventCandidate",
        "_eventEditButton",
        "_eventDecisionButton",
        "_renderEventConfirmation",
        "_renderEventActions",
        "_eventAction",
        "_renderRun",
        "_runSubtitle",
        "_pictureRow",
        "_renderJobOutcome",
        "_renderReading",
    ]);
    for (const name of WorkflowMenu.WORKFLOW_RENDERER_NAMES) {
        assert.equal(
            Menu.MenuView.prototype[name],
            WorkflowMenu.WorkflowMenuView.prototype[name],
            name,
        );
    }
});

test("workflow renderer installation preserves host members and behavior helpers", () => {
    const prototype = {hostMarker: true};
    assert.equal(WorkflowMenu.installWorkflowRenderers(prototype), prototype);
    assert.equal(prototype.hostMarker, true);
    assert.equal(
        WorkflowMenu.jobDetail({
            message: "accepted",
            stateText: "Finished",
            progressText: "",
            jobId: "job-7",
        }),
        "accepted · Finished · job-7",
    );
    assert.equal(Menu.jobDetail, WorkflowMenu.jobDetail);
});

test("job details retain only non-empty strings without coercing runtime values", () => {
    const coerced = {toString: () => "must not appear"};

    assert.equal(WorkflowMenu.jobDetail({
        message: 0,
        stateText: false,
        progressText: null,
        jobId: coerced,
    }), "");
    assert.equal(WorkflowMenu.jobDetail({
        message: "accepted",
        stateText: 7,
        progressText: "50%",
        jobId: undefined,
    }), "accepted · 50%");
});

test("facades contain no extracted workflow implementation bodies", () => {
    const menuSource = fs.readFileSync(path.join(ROOT, "menu-view.js"), "utf8");
    const modelSource = fs.readFileSync(path.join(ROOT, "view-model.js"), "utf8");
    assert.doesNotMatch(menuSource, /^\s+_renderEventImport\(model\) \{/mu);
    assert.doesNotMatch(menuSource, /^\s+_renderMediaTranscription\(model\) \{/mu);
    assert.doesNotMatch(modelSource, /^function eventImportModel\(state\) \{/mu);
    assert.doesNotMatch(modelSource, /^function mediaTranscriptionModel\(state\) \{/mu);
});
