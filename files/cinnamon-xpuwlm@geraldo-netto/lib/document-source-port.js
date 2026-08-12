"use strict";

// GTK adapter for one explicit document selection. It has no directory mode,
// watcher, recent-file store, or background access.

const DocumentQuestion = require("./document-question.js");
const EventSourcePort = require("./event-source-port.js");
const ExternalChooser = require("./external-chooser-port.js");
const I18n = require("./i18n.js");

const {_} = I18n;

function documentFilter(Gtk) {
    const filter = new Gtk.FileFilter();
    filter.set_name(_("Documents and images"));
    for (const suffix of DocumentQuestion.SOURCE_SUFFIXES) {
        filter.add_pattern(`*${suffix}`);
        filter.add_pattern(`*${suffix.toUpperCase()}`);
    }
    return filter;
}

function pickerTitle(candidate) {
    if (typeof candidate !== "string" || candidate.trim() === "" || [...candidate].length > 120) {
        throw new TypeError("A bounded document picker title is required");
    }
    return candidate;
}

function createGtkDocumentPicker(
    candidate,
    chooserLifecycle,
    title = _("Choose documents to ask"),
) {
    const environment = EventSourcePort.requireEnvironment(candidate);
    const lifecycle = EventSourcePort.requireChooserLifecycle(chooserLifecycle);
    const Gtk = environment.Gtk;
    const dialogTitle = pickerTitle(title);
    return {
        chooseFiles(callback) {
            const dialog = new Gtk.FileChooserDialog({
                title: dialogTitle,
                action: Gtk.FileChooserAction.OPEN,
            });
            EventSourcePort.addChooserButtons(dialog, Gtk, _("Choose documents"));
            dialog.set_select_multiple(true);
            dialog.add_filter(documentFilter(Gtk));
            return EventSourcePort.connectChooser(
                dialog,
                environment,
                (current) => EventSourcePort.describeSourcePaths(current.get_filenames(), environment),
                callback,
                lifecycle,
            );
        },
    };
}

function createExternalDocumentPicker(
    candidate,
    chooserLifecycle,
    title = _("Choose documents to ask"),
) {
    const environment = EventSourcePort.requireFileEnvironment(candidate);
    const lifecycle = ExternalChooser.requireChooserLifecycle(chooserLifecycle);
    const dialogTitle = pickerTitle(title);
    return {
        chooseFiles(callback) {
            return EventSourcePort.externalSelection(lifecycle, {
                mode: "open",
                title: dialogTitle,
                multiple: true,
                filter: {
                    name: _("Documents and images"),
                    patterns: EventSourcePort.sourcePatterns(DocumentQuestion.SOURCE_SUFFIXES),
                },
            }, (paths) => EventSourcePort.describeSourcePaths(paths, environment), callback);
        },
    };
}

module.exports = {
    createExternalDocumentPicker,
    createGtkDocumentPicker,
    documentFilter,
    pickerTitle,
};
