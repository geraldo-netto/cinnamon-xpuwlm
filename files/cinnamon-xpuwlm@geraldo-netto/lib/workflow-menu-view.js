"use strict";

const DocumentQuestion = require("./workflow-document-question-menu-view.js");
const EventImport = require("./workflow-event-import-menu-view.js");
const FileOrganizer = require("./workflow-file-organizer-menu-view.js");
const Media = require("./workflow-media-menu-view.js");
const SelectedText = require("./workflow-selected-text-menu-view.js");
const Shared = require("./workflow-shared-menu-view.js");

const {DocumentQuestionMenuView} = DocumentQuestion;
const {EventImportMenuView} = EventImport;
const {FileOrganizerMenuView} = FileOrganizer;
const {MediaMenuView} = Media;
const {SelectedTextMenuView} = SelectedText;
const {SharedMenuView, jobDetail} = Shared;

// Keep the established installer surface byte-for-byte ordered even though
// implementation ownership now follows workflow domains. MenuView callers see
// the same method descriptors and function identities they saw before.
const WORKFLOW_RENDERER_ENTRIES = Object.freeze([
    [FileOrganizerMenuView, "_renderFileOrganizer"],
    [MediaMenuView, "_renderMediaTranscription"],
    [MediaMenuView, "_renderMediaStatus"],
    [MediaMenuView, "_renderMediaResult"],
    [MediaMenuView, "_renderMediaActions"],
    [FileOrganizerMenuView, "_renderFileOrganizerStatus"],
    [FileOrganizerMenuView, "_renderFileOrganizerSources"],
    [FileOrganizerMenuView, "_renderFileOrganizerPlan"],
    [FileOrganizerMenuView, "_renderFileOrganizerActions"],
    [SelectedTextMenuView, "_renderSelectedText"],
    [SelectedTextMenuView, "_renderSelectedTextStatus"],
    [SelectedTextMenuView, "_renderSelectedTextActions"],
    [SelectedTextMenuView, "_renderSelectedTextOperations"],
    [SelectedTextMenuView, "_renderSelectedTextResult"],
    [DocumentQuestionMenuView, "_renderDocumentQuestion"],
    [DocumentQuestionMenuView, "_renderDocumentQuestionStatus"],
    [DocumentQuestionMenuView, "_renderDocumentQuestionSources"],
    [DocumentQuestionMenuView, "_documentQuestionEntry"],
    [DocumentQuestionMenuView, "_renderDocumentQuestionResult"],
    [DocumentQuestionMenuView, "_renderDocumentQuestionActions"],
    [EventImportMenuView, "_renderEventImport"],
    [EventImportMenuView, "_renderEventSources"],
    [EventImportMenuView, "_renderEventPreview"],
    [EventImportMenuView, "_eventCandidate"],
    [EventImportMenuView, "_eventEditButton"],
    [EventImportMenuView, "_eventDecisionButton"],
    [EventImportMenuView, "_renderEventConfirmation"],
    [EventImportMenuView, "_renderEventActions"],
    [SharedMenuView, "_eventAction"],
    [SharedMenuView, "_renderRun"],
    [SharedMenuView, "_runSubtitle"],
    [SharedMenuView, "_pictureRow"],
    [SharedMenuView, "_renderJobOutcome"],
    [SharedMenuView, "_renderReading"],
].map((entry) => Object.freeze(entry)));

class WorkflowMenuView {}

function installDescriptor(prototype, owner, name) {
    Object.defineProperty(
        prototype,
        name,
        Object.getOwnPropertyDescriptor(owner.prototype, name),
    );
}

for (const [owner, name] of WORKFLOW_RENDERER_ENTRIES) {
    installDescriptor(WorkflowMenuView.prototype, owner, name);
}

const WORKFLOW_RENDERER_NAMES = Object.freeze(
    WORKFLOW_RENDERER_ENTRIES.map(([, name]) => name),
);

function installWorkflowRenderers(prototype) {
    for (const name of WORKFLOW_RENDERER_NAMES) {
        Object.defineProperty(
            prototype,
            name,
            Object.getOwnPropertyDescriptor(WorkflowMenuView.prototype, name),
        );
    }
    return prototype;
}

module.exports = {
    WORKFLOW_RENDERER_NAMES,
    WorkflowMenuView,
    installWorkflowRenderers,
    jobDetail,
};
