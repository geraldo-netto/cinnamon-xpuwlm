"use strict";

// GTK/GIO adapters for explicit event-source selection and confirmed ICS
// export. The picker never opens on its own, folder selection is deliberately
// non-recursive, and export creates a new private file instead of replacing an
// existing file (including any selected source).

const EventImport = require("./event-import.js");
const I18n = require("./i18n.js");

const {_} = I18n;
const SOURCE_ATTRIBUTES = "standard::name,standard::type,standard::size";

function requireEnvironment(environment) {
    if (!environment || !environment.Gtk || !environment.Gdk
        || !environment.Gio || !environment.ByteArray) {
        throw new TypeError("GTK, GDK, GIO, and ByteArray are required for event file access");
    }
    return environment;
}

function sourceDescription(file, environment) {
    const Gio = environment.Gio;
    const info = file.query_info(
        SOURCE_ATTRIBUTES,
        Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS,
        null,
    );
    const type = info.get_file_type();
    return {
        path: file.get_path(),
        name: info.get_name() || file.get_basename(),
        size: Number(info.get_size()),
        regular: type === Gio.FileType.REGULAR,
        symlink: type === Gio.FileType.SYMBOLIC_LINK,
    };
}

function describeSourcePaths(paths, environment) {
    if (!Array.isArray(paths)) {
        throw new TypeError("Selected event paths must be an array");
    }
    const Gio = environment.Gio;
    return paths.map((path) => sourceDescription(Gio.File.new_for_path(path), environment));
}

function folderSources(path, environment) {
    const Gio = environment.Gio;
    const directory = Gio.File.new_for_path(path);
    const info = directory.query_info(
        SOURCE_ATTRIBUTES,
        Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS,
        null,
    );
    if (info.get_file_type() !== Gio.FileType.DIRECTORY) {
        throw new EventImport.EventImportError("directory-invalid", "choose a directory");
    }
    const enumerator = directory.enumerate_children(
        SOURCE_ATTRIBUTES,
        Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS,
        null,
    );
    const sources = [];
    try {
        let childInfo = enumerator.next_file(null);
        while (childInfo !== null) {
            const name = childInfo.get_name();
            if (EventImport.isSupportedSourceName(name)) {
                sources.push(sourceDescription(directory.get_child(name), environment));
                if (sources.length > EventImport.MAX_SOURCES) {
                    throw new EventImport.EventImportError(
                        "sources-invalid",
                        `folder contains more than ${EventImport.MAX_SOURCES} supported files`,
                    );
                }
            }
            childInfo = enumerator.next_file(null);
        }
    } finally {
        enumerator.close(null);
    }
    return sources;
}

function responseAccepted(Gtk, response) {
    return response === Gtk.ResponseType.ACCEPT || response === Gtk.ResponseType.OK;
}

function addChooserButtons(dialog, Gtk, acceptLabel) {
    dialog.add_button(_("Cancel"), Gtk.ResponseType.CANCEL);
    dialog.add_button(acceptLabel, Gtk.ResponseType.ACCEPT);
}

function requireScheduler(candidate) {
    if (!candidate || typeof candidate.schedule !== "function"
        || typeof candidate.cancel !== "function") {
        throw new TypeError("A chooser scheduler is required");
    }
    return candidate;
}

function applyNativeChooserHints(dialog, environment) {
    dialog.realize();
    const nativeWindow = dialog.get_window();
    const setters = ["set_type_hint", "set_skip_taskbar_hint", "set_skip_pager_hint"];
    if (!nativeWindow || setters.some((name) => typeof nativeWindow[name] !== "function")) {
        throw new Error("Chooser native window is unavailable");
    }
    // Parentless GTK dialogs inherit Cinnamon's own WM_CLASS. Utility type is
    // therefore required in addition to skip hints: Muffin otherwise treats
    // the chooser as an interesting cinnamon.desktop window while mapping.
    nativeWindow.set_type_hint(environment.Gdk.WindowTypeHint.UTILITY);
    nativeWindow.set_skip_taskbar_hint(true);
    nativeWindow.set_skip_pager_hint(true);
}

class GtkChooserLifecycle {
    constructor(candidate, scheduler) {
        this._environment = requireEnvironment(candidate);
        this._scheduler = requireScheduler(scheduler);
        this._dialogs = new Map();
        this._pending = new Set();
        this._disposed = false;
    }

    present(dialog, selected, callback) {
        if (typeof selected !== "function" || typeof callback !== "function") {
            throw new TypeError("Chooser selection and callback functions are required");
        }
        if (this._disposed) {
            throw new Error("Chooser lifecycle is disposed");
        }
        let signalId = null;
        try {
            signalId = dialog.connect(
                "response",
                (_dialog, response) => this._respond(dialog, response, selected, callback),
            );
            this._dialogs.set(dialog, signalId);
            // Cinnamon's popup has no Gtk.Window that can be a transient
            // parent. Keep this dialog out of grouped-window-list and pager
            // ownership instead: it remains modal and visibly focused without
            // creating an app-group entry whose GC teardown can re-enter GJS.
            dialog.set_skip_taskbar_hint(true);
            dialog.set_skip_pager_hint(true);
            dialog.set_modal(true);
            // GTK remembers both properties before realization, but on
            // Cinnamon/X11 the resulting GdkWindow can still be mapped once
            // without them. Realize without mapping, then apply the native
            // hints too so grouped-window-list never owns the dialog even for
            // one main-loop turn.
            applyNativeChooserHints(dialog, this._environment);
            dialog.show_all();
            dialog.present();
        } catch (error) {
            this._dialogs.delete(dialog);
            const closeError = this._close(dialog, signalId);
            this._defer(callback, error || closeError, null);
        }
        return true;
    }

    _respond(dialog, response, selected, callback) {
        if (!this._dialogs.has(dialog)) {
            return false;
        }
        const signalId = this._dialogs.get(dialog);
        this._dialogs.delete(dialog);
        let error = null;
        let value = null;
        try {
            value = responseAccepted(this._environment.Gtk, response) ? selected(dialog) : [];
        } catch (selectionError) {
            error = selectionError;
        }
        const closeError = this._close(dialog, signalId);
        this._defer(callback, error || closeError, value);
        return true;
    }

    _close(dialog, signalId) {
        let failure = null;
        const steps = [];
        if (signalId !== null && signalId !== undefined) {
            steps.push(() => dialog.disconnect(signalId));
        }
        steps.push(() => dialog.hide(), () => dialog.destroy());
        for (const step of steps) {
            try {
                step();
            } catch (error) {
                if (failure === null) {
                    failure = error;
                }
            }
        }
        return failure;
    }

    _defer(callback, error, value) {
        const pending = {handle: null};
        this._pending.add(pending);
        try {
            pending.handle = this._scheduler.schedule(0, () => {
                if (!this._pending.delete(pending) || this._disposed) {
                    return;
                }
                callback(error, value);
            });
        } catch (scheduleError) {
            this._pending.delete(pending);
            callback(scheduleError, null);
        }
    }

    dispose() {
        if (this._disposed) {
            return false;
        }
        this._disposed = true;
        const dialogs = [...this._dialogs.entries()];
        this._dialogs.clear();
        for (const [dialog, signalId] of dialogs) {
            this._close(dialog, signalId);
        }
        for (const pending of this._pending) {
            if (pending.handle !== null && pending.handle !== undefined) {
                try {
                    this._scheduler.cancel(pending.handle);
                } catch {
                    // Teardown remains best-effort and must continue through
                    // every native dialog and scheduled completion.
                }
            }
        }
        this._pending.clear();
        return true;
    }
}

function requireChooserLifecycle(candidate) {
    if (!candidate || typeof candidate.present !== "function"
        || typeof candidate.dispose !== "function") {
        throw new TypeError("A GTK chooser lifecycle is required");
    }
    return candidate;
}

function connectChooser(dialog, environment, selected, callback, candidate) {
    if (typeof selected !== "function" || typeof callback !== "function") {
        throw new TypeError("Chooser selection and callback functions are required");
    }
    requireEnvironment(environment);
    return requireChooserLifecycle(candidate).present(dialog, selected, callback);
}

function sourceFilter(Gtk) {
    const filter = new Gtk.FileFilter();
    filter.set_name(_("Documents, calendars, and images"));
    for (const suffix of EventImport.SOURCE_SUFFIXES) {
        filter.add_pattern(`*${suffix}`);
        filter.add_pattern(`*${suffix.toUpperCase()}`);
    }
    return filter;
}

function createGtkEventSourcePicker(candidate, chooserLifecycle) {
    const environment = requireEnvironment(candidate);
    const lifecycle = requireChooserLifecycle(chooserLifecycle);
    const Gtk = environment.Gtk;
    return {
        chooseFiles(callback) {
            const dialog = new Gtk.FileChooserDialog({
                title: _("Choose event source files"),
                action: Gtk.FileChooserAction.OPEN,
            });
            addChooserButtons(dialog, Gtk, _("Choose files"));
            dialog.set_select_multiple(true);
            dialog.add_filter(sourceFilter(Gtk));
            return connectChooser(
                dialog,
                environment,
                (current) => describeSourcePaths(current.get_filenames(), environment),
                callback,
                lifecycle,
            );
        },
        chooseFolder(callback) {
            const dialog = new Gtk.FileChooserDialog({
                title: _("Choose one event source folder"),
                action: Gtk.FileChooserAction.SELECT_FOLDER,
            });
            addChooserButtons(dialog, Gtk, _("Choose folder"));
            return connectChooser(
                dialog,
                environment,
                (current) => folderSources(current.get_filename(), environment),
                callback,
                lifecycle,
            );
        },
    };
}

function writeNewPrivateFile(path, text, environment) {
    const Gio = environment.Gio;
    const stream = Gio.File.new_for_path(path).create(Gio.FileCreateFlags.PRIVATE, null);
    try {
        const bytes = environment.ByteArray.fromString(text);
        stream.write_all(bytes, null);
    } finally {
        stream.close(null);
    }
    return path;
}

function createGtkEventExporter(candidate, chooserLifecycle) {
    const environment = requireEnvironment(candidate);
    const lifecycle = requireChooserLifecycle(chooserLifecycle);
    const Gtk = environment.Gtk;
    return {
        saveIcs(calendar, forbiddenPaths, callback) {
            const forbidden = new Set(forbiddenPaths);
            const dialog = new Gtk.FileChooserDialog({
                title: _("Save confirmed events"),
                action: Gtk.FileChooserAction.SAVE,
            });
            addChooserButtons(dialog, Gtk, _("Save new file"));
            dialog.set_current_name("confirmed-events.ics");
            return connectChooser(dialog, environment, (current) => {
                const path = current.get_filename();
                if (forbidden.has(path)) {
                    throw new EventImport.EventImportError(
                        "export-invalid", "output must differ from every selected source",
                    );
                }
                return writeNewPrivateFile(path, calendar, environment);
            }, callback, lifecycle);
        },
    };
}

module.exports = {
    SOURCE_ATTRIBUTES,
    GtkChooserLifecycle,
    addChooserButtons,
    connectChooser,
    createGtkEventExporter,
    createGtkEventSourcePicker,
    describeSourcePaths,
    folderSources,
    requireChooserLifecycle,
    requireEnvironment,
    requireScheduler,
    responseAccepted,
    sourceDescription,
    sourceFilter,
    writeNewPrivateFile,
};
