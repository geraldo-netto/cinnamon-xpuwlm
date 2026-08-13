"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const Menu = require("../../files/cinnamon-xpuwlm@geraldo-netto/lib/menu-view.js");
const DiagnosticsViewModel = require(
    "../../files/cinnamon-xpuwlm@geraldo-netto/lib/diagnostics-view-model.js",
);
const PanelViewModel = require(
    "../../files/cinnamon-xpuwlm@geraldo-netto/lib/panel-view-model.js",
);
const SetupViewModel = require(
    "../../files/cinnamon-xpuwlm@geraldo-netto/lib/setup-view-model.js",
);
const ViewModel = require("../../files/cinnamon-xpuwlm@geraldo-netto/lib/view-model.js");
const WorkflowMenu = require(
    "../../files/cinnamon-xpuwlm@geraldo-netto/lib/workflow-menu-view.js",
);
const WorkflowViewModel = require(
    "../../files/cinnamon-xpuwlm@geraldo-netto/lib/workflow-view-model.js",
);
const GenericWorkflowMenu = require(
    "../../files/cinnamon-xpuwlm@geraldo-netto/lib/generic-workflow-menu-view.js",
);
const GenericWorkflowSurface = require(
    "../../files/cinnamon-xpuwlm@geraldo-netto/lib/generic-workflow-surface.js",
);
const DocumentQuestionMenu = require(
    "../../files/cinnamon-xpuwlm@geraldo-netto/lib/workflow-document-question-menu-view.js",
);
const EventImportMenu = require(
    "../../files/cinnamon-xpuwlm@geraldo-netto/lib/workflow-event-import-menu-view.js",
);
const FileOrganizerMenu = require(
    "../../files/cinnamon-xpuwlm@geraldo-netto/lib/workflow-file-organizer-menu-view.js",
);
const MediaMenu = require(
    "../../files/cinnamon-xpuwlm@geraldo-netto/lib/workflow-media-menu-view.js",
);
const SelectedTextMenu = require(
    "../../files/cinnamon-xpuwlm@geraldo-netto/lib/workflow-selected-text-menu-view.js",
);
const SharedMenu = require(
    "../../files/cinnamon-xpuwlm@geraldo-netto/lib/workflow-shared-menu-view.js",
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

const CORE_PROJECTION_EXPORTS = Object.freeze([
    [DiagnosticsViewModel, [
        "diagnosticsModel", "diagnosticsReport", "formatRelativeTime", "systemModel",
        "workloadServiceStatus",
    ]],
    [PanelViewModel, [
        "ALERT_SEVERITY_PRIORITY", "BACKEND_LABELS", "DEVICE_STATUS_LABELS",
        "RUNTIME_STATUS_LABELS", "SEVERITY_LABELS", "attentionReviewText",
        "backendLabel", "deviceStatusText", "formatLoad", "highestActiveSeverity",
        "panelModel", "runtimeStatusText", "severityText", "unavailablePanel",
    ]],
    [SetupViewModel, [
        "LOCAL_FORECAST_PROFILE", "SETUP_KIND_ORDER", "SETUP_SECTIONS", "setupKind",
        "setupModel", "setupSection", "setupSummary",
    ]],
]);

test("view-model facade preserves every extracted workflow projection", () => {
    for (const name of PROJECTION_EXPORTS) {
        assert.equal(ViewModel[name], WorkflowViewModel[name], name);
    }
});

test("view-model facade preserves panel, diagnostics, and setup projections", () => {
    for (const [owner, names] of CORE_PROJECTION_EXPORTS) {
        for (const name of names) {
            assert.equal(ViewModel[name], owner[name], name);
        }
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

test("workflow renderer aggregate preserves per-workflow implementation ownership", () => {
    const ownership = [
        [FileOrganizerMenu.FileOrganizerMenuView, [
            "_renderFileOrganizer", "_renderFileOrganizerStatus", "_renderFileOrganizerSources",
            "_renderFileOrganizerPlan", "_renderFileOrganizerActions",
        ]],
        [MediaMenu.MediaMenuView, [
            "_renderMediaTranscription", "_renderMediaStatus", "_renderMediaResult",
            "_renderMediaActions",
        ]],
        [SelectedTextMenu.SelectedTextMenuView, [
            "_renderSelectedText", "_renderSelectedTextStatus", "_renderSelectedTextActions",
            "_renderSelectedTextOperations", "_renderSelectedTextResult",
        ]],
        [DocumentQuestionMenu.DocumentQuestionMenuView, [
            "_renderDocumentQuestion", "_renderDocumentQuestionStatus",
            "_renderDocumentQuestionSources", "_documentQuestionEntry",
            "_renderDocumentQuestionResult", "_renderDocumentQuestionActions",
        ]],
        [EventImportMenu.EventImportMenuView, [
            "_renderEventImport", "_renderEventSources", "_renderEventPreview",
            "_eventCandidate", "_eventEditButton", "_eventDecisionButton",
            "_renderEventConfirmation", "_renderEventActions",
        ]],
        [SharedMenu.SharedMenuView, [
            "_eventAction", "_renderRun", "_runSubtitle", "_pictureRow",
            "_renderJobOutcome", "_renderReading",
        ]],
    ];
    const owned = [];
    for (const [owner, names] of ownership) {
        assert.deepEqual(
            Object.getOwnPropertyNames(owner.prototype).filter((name) => name !== "constructor"),
            names,
        );
        for (const name of names) {
            assert.equal(WorkflowMenu.WorkflowMenuView.prototype[name], owner.prototype[name], name);
            owned.push(name);
        }
    }
    assert.deepEqual(
        [...owned].sort(),
        [...WorkflowMenu.WORKFLOW_RENDERER_NAMES].sort(),
    );
    assert.equal(SharedMenu.jobDetail, WorkflowMenu.jobDetail);
});

test("generic workflow surface registration installs exact reusable renderers", () => {
    assert.deepEqual(GenericWorkflowMenu.GENERIC_RENDERER_NAMES, [
        "_renderGenericWorkflowSurface",
        "_renderGenericUnavailable",
        "_renderGenericConsent",
        "_renderGenericProgress",
        "_renderGenericWarning",
        "_renderGenericResult",
        "_renderGenericRetention",
        "_renderGenericActions",
    ]);
    const prototype = {};
    assert.equal(GenericWorkflowSurface.registerGenericWorkflowSurface(prototype), prototype);
    assert.equal(GenericWorkflowSurface.registerGenericWorkflowSurface(prototype), prototype);
    for (const name of GenericWorkflowMenu.GENERIC_RENDERER_NAMES) {
        assert.equal(
            prototype[name],
            GenericWorkflowMenu.GenericWorkflowMenuView.prototype[name],
            name,
        );
        assert.equal(Object.prototype.hasOwnProperty.call(Menu.MenuView.prototype, name), false);
    }
});

test("generic workflow registration refuses conflicts without partial installation", () => {
    for (const conflict of GenericWorkflowMenu.GENERIC_RENDERER_NAMES) {
        const prototype = {[conflict]: () => false};
        assert.throws(
            () => GenericWorkflowSurface.registerGenericWorkflowSurface(prototype),
            new RegExp(conflict, "u"),
        );
        assert.deepEqual(Object.keys(prototype), [conflict]);
    }
    for (const invalid of [null, 7, "prototype"]) {
        assert.throws(
            () => GenericWorkflowSurface.registerGenericWorkflowSurface(invalid),
            /prototype/u,
        );
    }
    const descriptorConflict = {};
    Object.defineProperty(descriptorConflict, GenericWorkflowMenu.GENERIC_RENDERER_NAMES[0], {
        configurable: false,
        value: GenericWorkflowMenu.GenericWorkflowMenuView.prototype._renderGenericWorkflowSurface,
    });
    assert.throws(
        () => GenericWorkflowSurface.registerGenericWorkflowSurface(descriptorConflict),
        /_renderGenericWorkflowSurface/u,
    );
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
    const genericSurfaceSource = fs.readFileSync(
        path.join(ROOT, "generic-workflow-surface.js"), "utf8",
    );
    const workflowSource = fs.readFileSync(path.join(ROOT, "workflow-menu-view.js"), "utf8");
    const modelSource = fs.readFileSync(path.join(ROOT, "view-model.js"), "utf8");
    assert.doesNotMatch(menuSource, /^\s+_renderEventImport\(model\) \{/mu);
    assert.doesNotMatch(menuSource, /^\s+_renderMediaTranscription\(model\) \{/mu);
    assert.doesNotMatch(menuSource, /generic-workflow-menu-view/u);
    assert.match(genericSurfaceSource, /require\("\.\/generic-workflow-menu-view\.js"\)/u);
    for (const name of WorkflowMenu.WORKFLOW_RENDERER_NAMES) {
        assert.doesNotMatch(workflowSource, new RegExp(`^\\s+${name}\\([^)]*\\) \\{`, "mu"), name);
    }
    assert.doesNotMatch(modelSource, /^function eventImportModel\(state\) \{/mu);
    assert.doesNotMatch(modelSource, /^function mediaTranscriptionModel\(state\) \{/mu);
    assert.doesNotMatch(modelSource, /^function panelModel\(state\) \{/mu);
    assert.doesNotMatch(modelSource, /^function diagnosticsModel\(/mu);
    assert.doesNotMatch(modelSource, /^function setupModel\(profiles\) \{/mu);
});
