"use strict";

// One explicit media file selected through the external chooser lifecycle.
// The worker receives no directory, recent-file list, or background access.

const EventSourcePort = require("./event-source-port.js");
const ExternalChooser = require("./external-chooser-port.js");
const I18n = require("./i18n.js");
const MediaTranscription = require("./media-transcription.js");

const {_} = I18n;

function createExternalMediaPicker(candidate, chooserLifecycle) {
    const environment = EventSourcePort.requireFileEnvironment(candidate);
    const lifecycle = ExternalChooser.requireChooserLifecycle(chooserLifecycle);
    return {
        chooseFiles(callback) {
            return EventSourcePort.externalSelection(lifecycle, {
                mode: "open",
                title: _("Choose media to transcribe"),
                multiple: false,
                filter: {
                    name: _("Audio, documents, images, video, and presentations"),
                    patterns: EventSourcePort.sourcePatterns(MediaTranscription.SOURCE_SUFFIXES),
                },
            }, (paths) => EventSourcePort.describeSourcePaths(paths, environment), callback);
        },
    };
}

module.exports = {createExternalMediaPicker};
