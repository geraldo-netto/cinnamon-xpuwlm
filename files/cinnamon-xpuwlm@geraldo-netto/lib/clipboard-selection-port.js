"use strict";

function requireEnvironment(environment) {
    if (!environment || !environment.Gdk || !environment.Gtk) {
        throw new TypeError("GTK clipboard dependencies are required");
    }
    const getClipboard = environment.Gtk.Clipboard?.get;
    if (typeof getClipboard !== "function" || environment.Gdk.SELECTION_CLIPBOARD === undefined) {
        throw new TypeError("GTK clipboard API is unavailable");
    }
    return environment;
}

class GtkClipboardSelectionReader {
    constructor(environment) {
        this._environment = requireEnvironment(environment);
        this._sequence = 0;
    }

    readText(callback) {
        if (typeof callback !== "function") {
            throw new TypeError("Clipboard callback is required");
        }
        const sequence = ++this._sequence;
        const clipboard = this._environment.Gtk.Clipboard.get(
            this._environment.Gdk.SELECTION_CLIPBOARD,
        );
        if (!clipboard || typeof clipboard.request_text !== "function") {
            callback(new Error("GTK clipboard text access is unavailable"), null);
            return false;
        }
        clipboard.request_text((_clipboard, text) => {
            if (sequence === this._sequence) {
                callback(null, text === null || text === undefined ? "" : String(text));
            }
        });
        return true;
    }

    cancel() {
        this._sequence += 1;
        return true;
    }
}

function createGtkClipboardSelectionReader(environment) {
    return new GtkClipboardSelectionReader(environment);
}

module.exports = {
    GtkClipboardSelectionReader,
    createGtkClipboardSelectionReader,
    requireEnvironment,
};
