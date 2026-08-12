"use strict";

// GTK adapter for one explicit document selection. It has no directory mode,
// watcher, recent-file store, or background access.

const DocumentQuestion = require("./document-question.js");
const EventSourcePort = require("./event-source-port.js");
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

function createGtkDocumentPicker(candidate, chooserLifecycle) {
    const environment = EventSourcePort.requireEnvironment(candidate);
    const lifecycle = EventSourcePort.requireChooserLifecycle(chooserLifecycle);
    const Gtk = environment.Gtk;
    return {
        chooseFiles(callback) {
            const dialog = new Gtk.FileChooserDialog({
                title: _("Choose documents to ask"),
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

module.exports = {createGtkDocumentPicker, documentFilter};
