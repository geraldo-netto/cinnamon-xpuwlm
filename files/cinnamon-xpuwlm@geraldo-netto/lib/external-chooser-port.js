"use strict";

// File choosers run outside Cinnamon. A native GTK dialog owned by the shell
// shares Cinnamon's process, GJS heap, and window identity; native chooser
// teardown can therefore take the desktop down with it. Zenity keeps that
// lifecycle in a short-lived helper process while this port retains strict,
// callback-based selection semantics for the application controllers.

const Validation = require("./validation.js");

const CHOOSER_PROGRAM = "zenity";
const PATH_SEPARATOR = "\u001e";
const MAX_OUTPUT_BYTES = 128 * 1024;
const MAX_PATHS = 32;
const MAX_PATH_LENGTH = 4096;
const MAX_ERROR_LENGTH = 500;

function hasSubprocessApi(Gio) {
    return Boolean(Gio && typeof Gio.Subprocess?.new === "function"
        && Gio.SubprocessFlags && typeof Gio.Cancellable === "function");
}

function hasProgramLookup(GLib) {
    return Boolean(GLib && typeof GLib.find_program_in_path === "function");
}

function requireEnvironment(environment) {
    if (!hasSubprocessApi(environment?.Gio) || !hasProgramLookup(environment?.GLib)) {
        throw new TypeError("GIO subprocess and GLib program lookup are required for file selection");
    }
    return environment;
}

const boundedText = Validation.boundedText;

function chooserExecutable(environment, override = null) {
    if (override !== null) {
        if (!boundedText(override, 1, MAX_PATH_LENGTH)) {
            throw new TypeError("File chooser executable path is invalid");
        }
        return override;
    }
    const executable = environment.GLib.find_program_in_path(CHOOSER_PROGRAM);
    if (!boundedText(executable, 1, MAX_PATH_LENGTH)) {
        throw new Error(`${CHOOSER_PROGRAM} is required for isolated file selection`);
    }
    return executable;
}

function validPatterns(value) {
    return Array.isArray(value)
        && value.length <= 64
        && value.every((pattern) => boundedText(pattern, 1, 80));
}

function appendModeArguments(args, options) {
    if (options.mode === "folder") {
        args.push("--directory");
        return;
    }
    if (options.mode !== "save") {
        return;
    }
    args.push("--save");
    if (options.filename === undefined) {
        return;
    }
    if (!boundedText(options.filename, 1, 255) || options.filename.includes("/")) {
        throw new TypeError("File chooser default filename is invalid");
    }
    args.push(`--filename=${options.filename}`);
}

function appendMultipleArgument(args, options) {
    if (options.multiple !== true) {
        return;
    }
    if (options.mode !== "open") {
        throw new TypeError("Only open file choosers can select multiple paths");
    }
    args.push("--multiple", `--separator=${PATH_SEPARATOR}`);
}

function appendFilterArgument(args, filter) {
    if (filter === undefined) {
        return;
    }
    if (!filter || !boundedText(filter.name, 1, 120)
        || !validPatterns(filter.patterns) || filter.patterns.length === 0) {
        throw new TypeError("File chooser filter is invalid");
    }
    args.push(`--file-filter=${filter.name} | ${filter.patterns.join(" ")}`);
}

function chooserArguments(executable, options) {
    if (!options || !["open", "folder", "save"].includes(options.mode)
        || !boundedText(options.title, 1, 160)) {
        throw new TypeError("File chooser mode and title are required");
    }
    const args = [executable, "--file-selection", `--title=${options.title}`];
    appendModeArguments(args, options);
    appendMultipleArgument(args, options);
    appendFilterArgument(args, options.filter);
    return args;
}

function stripOutputTerminator(text) {
    if (text.endsWith("\r\n")) {
        return text.slice(0, -2);
    }
    return text.endsWith("\n") ? text.slice(0, -1) : text;
}

function parseSelection(text, multiple = false) {
    if (typeof text !== "string") {
        throw new TypeError("File chooser output is not text");
    }
    // GJS lacks Node's binary helper. Bound Unicode code points instead; path count and
    // per-path limits below provide the stricter practical ceiling.
    if ([...text].length > MAX_OUTPUT_BYTES) {
        throw new RangeError("File chooser output is too large");
    }
    const selected = stripOutputTerminator(text);
    if (selected === "") {
        return [];
    }
    const paths = multiple ? selected.split(PATH_SEPARATOR) : [selected];
    if (paths.length > MAX_PATHS || paths.some(
        (path) => !boundedText(path, 1, MAX_PATH_LENGTH) || !path.startsWith("/")
            || path.includes("\0") || path.includes(PATH_SEPARATOR),
    )) {
        throw new RangeError("File chooser returned invalid paths");
    }
    return paths;
}

function processFailure(stderr, status) {
    const detail = typeof stderr === "string"
        ? [...stripOutputTerminator(stderr)].slice(0, MAX_ERROR_LENGTH).join("")
        : "";
    return new Error(detail === ""
        ? `File chooser failed with status ${status}`
        : `File chooser failed with status ${status}: ${detail}`);
}

class ExternalChooserLifecycle {
    constructor(candidate, executable = null) {
        this._environment = requireEnvironment(candidate);
        this._executable = chooserExecutable(this._environment, executable);
        this._pending = new Set();
        this._disposed = false;
    }

    choose(options, callback) {
        if (typeof callback !== "function") {
            throw new TypeError("File chooser callback is required");
        }
        if (this._disposed) {
            throw new Error("File chooser lifecycle is disposed");
        }
        const multiple = options?.multiple === true;
        const argv = chooserArguments(this._executable, options);
        const Gio = this._environment.Gio;
        const flags = Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE;
        let process;
        try {
            process = Gio.Subprocess.new(argv, flags);
        } catch (error) {
            callback(error, null);
            return false;
        }
        const pending = {process, cancellable: new Gio.Cancellable()};
        this._pending.add(pending);
        try {
            process.communicate_utf8_async(
                null,
                pending.cancellable,
                (source, result) => this._complete(pending, source, result, multiple, callback),
            );
        } catch (error) {
            this._pending.delete(pending);
            this._stop(pending);
            callback(error, null);
            return false;
        }
        return true;
    }

    _complete(pending, source, result, multiple, callback) {
        if (!this._pending.delete(pending) || this._disposed) {
            return false;
        }
        let stdout;
        let stderr;
        try {
            [, stdout, stderr] = source.communicate_utf8_finish(result);
        } catch (error) {
            callback(error, null);
            return true;
        }
        const status = typeof source.get_exit_status === "function" ? source.get_exit_status() : 0;
        if (status === 1) {
            callback(null, []);
            return true;
        }
        if (status !== 0) {
            callback(processFailure(stderr, status), null);
            return true;
        }
        try {
            callback(null, parseSelection(stdout, multiple));
        } catch (error) {
            callback(error, null);
        }
        return true;
    }

    _stop(pending) {
        try {
            pending.cancellable.cancel();
        } catch {
            // Continue to terminate helper even when cancellation fails.
        }
        try {
            if (typeof pending.process.force_exit === "function") {
                pending.process.force_exit();
            }
        } catch {
            // Helper may already have exited between cancellation and cleanup.
        }
    }

    dispose() {
        if (this._disposed) {
            return false;
        }
        this._disposed = true;
        const pending = [...this._pending];
        this._pending.clear();
        for (const item of pending) {
            this._stop(item);
        }
        return true;
    }
}

function requireChooserLifecycle(candidate) {
    if (!candidate || typeof candidate.choose !== "function"
        || typeof candidate.dispose !== "function") {
        throw new TypeError("An external file chooser lifecycle is required");
    }
    return candidate;
}

module.exports = {
    CHOOSER_PROGRAM,
    ExternalChooserLifecycle,
    MAX_ERROR_LENGTH,
    MAX_OUTPUT_BYTES,
    MAX_PATH_LENGTH,
    MAX_PATHS,
    PATH_SEPARATOR,
    appendFilterArgument,
    appendModeArguments,
    appendMultipleArgument,
    chooserArguments,
    chooserExecutable,
    parseSelection,
    processFailure,
    requireChooserLifecycle,
    requireEnvironment,
    stripOutputTerminator,
};
