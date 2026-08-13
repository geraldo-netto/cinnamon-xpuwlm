"use strict";

const CinnamonRuntime = require("./cinnamon-runtime.js");
const ClipboardSelectionPort = require("./clipboard-selection-port.js");
const DocumentQuestion = require("./document-question.js");
const DocumentSourcePort = require("./document-source-port.js");
const EventImport = require("./event-import.js");
const EventSourcePort = require("./event-source-port.js");
const FileOrganizer = require("./file-organizer.js");
const I18n = require("./i18n.js");
const MediaSourcePort = require("./media-source-port.js");
const MediaTranscription = require("./media-transcription.js");
const SelectedText = require("./selected-text.js");

const {_} = I18n;

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

function controllerPorts({environment, chooserLifecycle, scheduler, clock}) {
    return {
        environment,
        chooserLifecycle,
        scheduler,
        clock,
        gateway: () => CinnamonRuntime.createRuntimeJobGateway(environment),
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
    });
}

function createWorkflowControllers({environment, chooserLifecycle, scheduler, clock, overrides}) {
    const shared = controllerPorts({environment, chooserLifecycle, scheduler, clock});
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
    createWorkflowControllers,
    unavailableClipboardReader,
    unavailableDocumentPicker,
    unavailableEventFilePorts,
};
