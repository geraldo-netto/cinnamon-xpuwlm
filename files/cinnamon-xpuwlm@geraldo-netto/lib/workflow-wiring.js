"use strict";

const Background = require("./background-execution.js");
const ClipboardSelectionPort = require("./clipboard-selection-port.js");
const GenericWorkflow = require("./generic-workflow-controller.js");
const Job = require("./runtime-job-contract.js");
const DocumentQuestion = require("./document-question.js");
const DocumentSourcePort = require("./document-source-port.js");
const EventImport = require("./event-import.js");
const EventSourcePort = require("./event-source-port.js");
const FileOrganizer = require("./file-organizer.js");
const I18n = require("./i18n.js");
const MediaSourcePort = require("./media-source-port.js");
const MediaTranscription = require("./media-transcription.js");
const Paths = require("./path-port.js");
const SelectedText = require("./selected-text.js");

const {_, N_} = I18n;

function unavailableEventFilePorts() {
    const unavailable = (callback) => callback(new Error("GTK event file access is unavailable"), null);
    return {
        picker: {chooseFiles: unavailable, chooseFolder: unavailable},
        exporter: {saveIcs: (_calendar, _paths, callback) => unavailable(callback)},
    };
}

function unavailableDocumentPicker() {
    return {chooseFiles: (callback) => callback(new Error("GTK document access is unavailable"), null)};
}

function unavailableClipboardReader() {
    return {
        readText: (callback) => callback(new Error("GTK clipboard text access is unavailable"), null),
        cancel: () => true,
    };
}

function controllerPorts({
    environment,
    chooserLifecycle,
    scheduler,
    clock,
    jobGatewayFactory,
    paths = Paths.POSIX_PATHS,
}) {
    return {
        environment,
        chooserLifecycle,
        scheduler,
        clock,
        paths: Paths.requirePathPort(paths),
        gateway: typeof jobGatewayFactory === "function"
            ? jobGatewayFactory
            : () => { throw new TypeError("Workflow job transport is required"); },
    };
}

function createMediaTranscriptionController(shared) {
    let picker;
    try {
        picker = MediaSourcePort.createExternalMediaPicker(
            shared.environment,
            shared.chooserLifecycle,
        );
    } catch {
        picker = unavailableDocumentPicker();
    }
    return new MediaTranscription.MediaTranscriptionController({
        picker,
        gateway: shared.gateway(),
        scheduler: shared.scheduler,
        clock: shared.clock,
        paths: shared.paths,
    });
}

function createFileOrganizerController(shared) {
    let picker;
    try {
        picker = DocumentSourcePort.createExternalDocumentPicker(
            shared.environment,
            shared.chooserLifecycle,
            _("Choose files to organize"),
        );
    } catch {
        picker = unavailableDocumentPicker();
    }
    return new FileOrganizer.FileOrganizerController({
        picker,
        gateway: shared.gateway(),
        scheduler: shared.scheduler,
        clock: shared.clock,
        paths: shared.paths,
    });
}

function createSelectedTextController(shared) {
    let clipboard;
    try {
        clipboard = ClipboardSelectionPort.createGtkClipboardSelectionReader(shared.environment);
    } catch {
        clipboard = unavailableClipboardReader();
    }
    return new SelectedText.SelectedTextController({
        clipboard,
        gateway: shared.gateway(),
        scheduler: shared.scheduler,
        clock: shared.clock,
    });
}

function createDocumentQuestionController(shared) {
    let picker;
    try {
        picker = DocumentSourcePort.createExternalDocumentPicker(
            shared.environment,
            shared.chooserLifecycle,
        );
    } catch {
        picker = unavailableDocumentPicker();
    }
    return new DocumentQuestion.DocumentQuestionController({
        picker,
        gateway: shared.gateway(),
        scheduler: shared.scheduler,
        clock: shared.clock,
        paths: shared.paths,
    });
}

function createEventImportController(shared) {
    let ports;
    try {
        ports = {
            picker: EventSourcePort.createExternalEventSourcePicker(
                shared.environment,
                shared.chooserLifecycle,
            ),
            exporter: EventSourcePort.createExternalEventExporter(
                shared.environment,
                shared.chooserLifecycle,
            ),
        };
    } catch {
        ports = unavailableEventFilePorts();
    }
    return new EventImport.EventImportController({
        ...ports,
        gateway: shared.gateway(),
        scheduler: shared.scheduler,
        clock: shared.clock,
        paths: shared.paths,
    });
}

// Every runnable bundled profile is the shape the generic surface was written
// for — run it, watch it, read the evidence — so its definition is projected
// from the manifest the catalog already carries rather than restated here. A
// profile is exposed by shipping its manifest; nothing else has to change.
const GENERIC_RETENTION_TEXT = N_("Results stay on this computer and are cleared when you clear them.");

function genericDefinition(profile) {
    return {
        version: 1,
        id: profile.id,
        title: profile.title,
        description: profile.description,
        consentPurpose: "",
        supportsBackground: true,
        retentionText: _(GENERIC_RETENTION_TEXT),
        reviewOnly: true,
    };
}

function genericRequestBuilder(profileId) {
    return (requestId) => {
        const document = {
            version: Job.JOB_VERSION,
            requestId,
            workloadId: profileId,
            payload: {},
        };
        if (!Job.isJobSubmission(document)) {
            throw new TypeError(`Generic workflow submission for ${profileId} is invalid`);
        }
        return document;
    };
}

// The registry owns the background engine so a workflow that is never enabled
// costs nothing, and so disposal releases timers in one place.
function backgroundErrorReporter(logger) {
    return (error) => logger.warn(`Background workflow failed: ${error}`);
}

function createGenericWorkflowRegistry({descriptors, gateway, scheduler, clock, timer, leasePort, logger}) {
    const background = timer && leasePort && logger
        ? new Background.BackgroundExecution({
            timer, leasePort, reportError: backgroundErrorReporter(logger),
        })
        : null;
    const registry = new GenericWorkflow.GenericWorkflowRegistry({background});
    for (const descriptor of descriptors) {
        const profile = descriptor.profileDefinition();
        if (!descriptor.executable) {
            continue;
        }
        registry.register(new GenericWorkflow.GenericWorkflowController({
            definition: genericDefinition(profile),
            gateway: gateway(),
            scheduler,
            clock,
            buildRequest: genericRequestBuilder(profile.id),
        }));
    }
    return registry;
}

function createWorkflowControllers({
    environment,
    chooserLifecycle,
    scheduler,
    clock,
    jobGatewayFactory,
    paths,
    overrides,
}) {
    const shared = controllerPorts({
        environment,
        chooserLifecycle,
        scheduler,
        clock,
        jobGatewayFactory,
        paths,
    });
    return {
        eventImport: overrides.eventImportController || createEventImportController(shared),
        documentQuestion: overrides.documentQuestionController
            || createDocumentQuestionController(shared),
        selectedText: overrides.selectedTextController || createSelectedTextController(shared),
        fileOrganizer: overrides.fileOrganizerController || createFileOrganizerController(shared),
        mediaTranscription: overrides.mediaTranscriptionController
            || createMediaTranscriptionController(shared),
    };
}

module.exports = {
    controllerPorts,
    createDocumentQuestionController,
    createEventImportController,
    createFileOrganizerController,
    createMediaTranscriptionController,
    createSelectedTextController,
    backgroundErrorReporter,
    createGenericWorkflowRegistry,
    createWorkflowControllers,
    genericDefinition,
    genericRequestBuilder,
    unavailableClipboardReader,
    unavailableDocumentPicker,
    unavailableEventFilePorts,
};
