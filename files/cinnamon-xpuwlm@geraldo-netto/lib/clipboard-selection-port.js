"use strict";

function requireEnvironment(environment) {
    if (!environment || !environment.Gdk || !environment.Gtk) {
        throw new TypeError("GTK clipboard dependencies are required");
    }
    const getClipboard = environment.Gtk.Clipboard?.get;
    if (typeof getClipboard !== "function") {
        throw new TypeError("GTK clipboard API is unavailable");
    }
    clipboardAtom(environment);
    return environment;
}

function clipboardAtom(environment) {
    if (!environment || !environment.Gdk) {
        throw new TypeError("GDK clipboard dependency is required");
    }
    if (environment.Gdk.SELECTION_CLIPBOARD !== undefined) {
        return environment.Gdk.SELECTION_CLIPBOARD;
    }
    if (typeof environment.Gdk.Atom?.intern === "function") {
        return environment.Gdk.Atom.intern("CLIPBOARD", false);
    }
    if (typeof environment.Gdk.atom_intern === "function") {
        return environment.Gdk.atom_intern("CLIPBOARD", false);
    }
    throw new TypeError("GDK clipboard atom API is unavailable");
}

class GtkClipboardSelectionReader {
    constructor(environment) {
        this._environment = requireEnvironment(environment);
        this._atom = clipboardAtom(environment);
        this._sequence = 0;
    }

    readText(callback) {
        if (typeof callback !== "function") {
            throw new TypeError("Clipboard callback is required");
        }
        const sequence = ++this._sequence;
        const clipboard = this._environment.Gtk.Clipboard.get(
            this._atom,
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
    clipboardAtom,
    createGtkClipboardSelectionReader,
    requireEnvironment,
};
