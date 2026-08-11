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
    if (!environment || !environment.Gtk || !environment.Gio || !environment.ByteArray) {
        throw new TypeError("GTK, GIO, and ByteArray are required for event file access");
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

function connectChooser(dialog, environment, selected, callback) {
    if (typeof selected !== "function" || typeof callback !== "function") {
        throw new TypeError("Chooser selection and callback functions are required");
    }
    const Gtk = environment.Gtk;
    dialog.connect("response", (_dialog, response) => {
        try {
            callback(null, responseAccepted(Gtk, response) ? selected(dialog) : []);
        } catch (error) {
            callback(error, null);
        } finally {
            dialog.destroy();
        }
    });
    dialog.show_all();
    return true;
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

function createGtkEventSourcePicker(candidate) {
    const environment = requireEnvironment(candidate);
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

function createGtkEventExporter(candidate) {
    const environment = requireEnvironment(candidate);
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
            }, callback);
        },
    };
}

module.exports = {
    SOURCE_ATTRIBUTES,
    addChooserButtons,
    connectChooser,
    createGtkEventExporter,
    createGtkEventSourcePicker,
    describeSourcePaths,
    folderSources,
    requireEnvironment,
    responseAccepted,
    sourceDescription,
    sourceFilter,
    writeNewPrivateFile,
};
