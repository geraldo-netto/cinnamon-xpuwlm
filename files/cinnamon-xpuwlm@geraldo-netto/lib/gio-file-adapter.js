"use strict";

const Runtime = require("./runtime-gateway.js");

function expandHome(path, homeDirectory) {
    const text = String(path || "");
    if (text === "~") {
        return homeDirectory;
    }
    if (text.startsWith("~/")) {
        return `${homeDirectory}/${text.slice(2)}`;
    }
    return text;
}

function decodeBytes(bytes, ByteArray) {
    if (typeof bytes === "string") {
        return bytes;
    }
    return ByteArray.toString(bytes);
}

function readFileText(path, environment, maximumBytes = null) {
    const file = environment.Gio.File.new_for_path(path);
    if (!file.query_exists(null)) {
        return null;
    }
    if (maximumBytes !== null) {
        const info = file.query_info(
            "standard::size",
            environment.Gio.FileQueryInfoFlags.NONE,
            null,
        );
        if (info.get_size() > maximumBytes) {
            throw new RangeError("File exceeds configured maximum size");
        }
    }
    const [ok, contents] = environment.GLib.file_get_contents(path);
    if (!ok) {
        throw new Error(`Could not read ${path}`);
    }
    return decodeBytes(contents, environment.ByteArray);
}

function isIoError(environment, error, name) {
    const enumeration = environment.Gio?.IOErrorEnum;
    if (!enumeration || !error || typeof error.matches !== "function") {
        return false;
    }
    return error.matches(enumeration, enumeration[name]);
}

const IDENTITY_ATTRIBUTES = "standard::type,standard::size,unix::inode,unix::device";

function fileIdentity(info) {
    return {
        inode: info.get_attribute_uint64("unix::inode"),
        device: info.get_attribute_uint32("unix::device"),
    };
}

function sameIdentity(left, right) {
    return left.inode === right.inode && left.device === right.device;
}

function finishAsyncBytes(bytesSource, bytesResult, context) {
    const bytes = bytesSource.read_bytes_finish(bytesResult);
    const data = typeof bytes.get_data === "function" ? bytes.get_data() : bytes;
    if (!context.truncateOversize
            && context.maximumBytes !== null
            && data.length > context.maximumBytes) {
        context.fail(new RangeError("Runtime snapshot exceeds 1 MiB"));
        return;
    }
    context.callback(null, decodeBytes(data, context.environment.ByteArray));
}

function readAsyncBytes(stream, context) {
    const readBytes = context.maximumBytes === null
        ? Runtime.MAX_SNAPSHOT_BYTES + 1
        : context.maximumBytes;
    stream.read_bytes_async(
        readBytes,
        null,
        context.cancellable,
        (source, result) => context.guarded(() => finishAsyncBytes(source, result, context)),
    );
}

function finishAsyncOpen(readSource, readResult, expected, context) {
    const stream = readSource.read_finish(readResult);
    const opened = fileIdentity(stream.query_info(IDENTITY_ATTRIBUTES, context.cancellable));
    if (!sameIdentity(expected, opened)) {
        // A publisher that atomically replaces the snapshot between the
        // preflight and the open trips this check benignly, so the gateway
        // retries once with a fresh preflight instead of failing the poll.
        const raced = new Error(
            `Runtime snapshot path changed while opening: ${context.path}`,
        );
        raced.transientRace = true;
        context.fail(raced);
        return;
    }
    readAsyncBytes(stream, context);
}

function openAsyncFile(expected, context) {
    context.file.read_async(
        null,
        context.cancellable,
        (source, result) => context.guarded(
            () => finishAsyncOpen(source, result, expected, context),
        ),
    );
}

function finishAsyncPreflight(infoSource, infoResult, context) {
    const info = infoSource.query_info_finish(infoResult);
    if (info.get_file_type() !== context.environment.Gio.FileType.REGULAR) {
        context.fail(new Error(`Runtime snapshot is not a regular file: ${context.path}`));
        return;
    }
    if (!context.truncateOversize
            && context.maximumBytes !== null
            && info.get_size() > context.maximumBytes) {
        context.fail(new RangeError("Runtime snapshot exceeds 1 MiB"));
        return;
    }
    openAsyncFile(fileIdentity(info), context);
}

// Bounded, cancellable GIO read that never follows a symlink and never trusts
// the path between calls. The no-follow preflight rejects anything that is not
// a regular file, and the identity of the opened stream must match the identity
// the preflight saw, so a path object swapped in between is rejected rather
// than read. An absent file reports no text so the caller can fall back to
// device discovery; a cancelled read never calls back at all.
function readFileTextAsync(path, environment, options, callback) {
    const maximumBytes = options && Number.isFinite(options.maximumBytes)
        ? options.maximumBytes
        : null;
    // Sysfs attribute files declare a page-sized st_size (4096) regardless of
    // content, so bounded identity reads opt out of the declared-size gate and
    // rely on the actual bounded byte read plus truncation instead. The
    // snapshot path keeps the strict declared-size rejection.
    const truncateOversize = options?.truncateOversize === true;
    const cancellable = options ? options.cancellable || null : null;
    const Gio = environment.Gio;
    const file = Gio.File.new_for_path(path);

    const fail = (error) => callback(error, null);
    const guarded = (step) => {
        try {
            step();
        } catch (error) {
            if (isIoError(environment, error, "CANCELLED")) {
                return;
            }
            if (isIoError(environment, error, "NOT_FOUND")) {
                callback(null, null);
                return;
            }
            fail(error);
        }
    };
    const context = {
        callback,
        cancellable,
        environment,
        fail,
        file,
        guarded,
        maximumBytes,
        path,
        truncateOversize,
    };

    file.query_info_async(
        IDENTITY_ATTRIBUTES,
        Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS,
        null,
        cancellable,
        (source, result) => guarded(() => finishAsyncPreflight(source, result, context)),
    );
}

// Trust-boundary read for declarative plug-in manifests: the no-follow
// preflight rejects symlinks and anything that is not a regular file (a fifo
// would block the main loop forever), the declared size is checked before the
// open, the identity of the opened stream must match the preflight so a path
// object swapped in between is rejected, and the bytes actually read are
// bounded rather than trusted from the declared size. An absent file reports
// null so discovery can distinguish "missing" from "invalid".
function readBoundedRegularFileText(path, environment, maximumBytes) {
    const Gio = environment.Gio;
    const file = Gio.File.new_for_path(path);
    let info;
    try {
        info = file.query_info(IDENTITY_ATTRIBUTES, Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS, null);
    } catch (error) {
        if (isIoError(environment, error, "NOT_FOUND")) {
            return null;
        }
        throw error;
    }
    if (info.get_file_type() !== Gio.FileType.REGULAR) {
        throw new Error(`Not a regular file: ${path}`);
    }
    if (info.get_size() > maximumBytes) {
        throw new RangeError(`File exceeds configured maximum size: ${path}`);
    }
    const stream = file.read(null);
    try {
        const opened = fileIdentity(stream.query_info(IDENTITY_ATTRIBUTES, null));
        if (!sameIdentity(fileIdentity(info), opened)) {
            throw new Error(`File changed while opening: ${path}`);
        }
        return decodeBytes(readBoundedStreamBytes(stream, maximumBytes, path), environment.ByteArray);
    } finally {
        stream.close(null);
    }
}

function readBoundedStreamBytes(stream, maximumBytes, path) {
    const chunks = [];
    let total = 0;
    for (;;) {
        const bytes = stream.read_bytes(maximumBytes + 1, null);
        const data = typeof bytes.get_data === "function" ? bytes.get_data() : bytes;
        const length = data === null ? 0 : data.length;
        if (length === 0) {
            return joinChunks(chunks, total);
        }
        total += length;
        if (total > maximumBytes) {
            throw new RangeError(`File exceeds configured maximum size: ${path}`);
        }
        chunks.push(data);
    }
}

function joinChunks(chunks, total) {
    if (chunks.length === 1) {
        return chunks[0];
    }
    if (chunks.every((chunk) => typeof chunk === "string")) {
        return chunks.join("");
    }
    const merged = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
        merged.set(chunk, offset);
        offset += chunk.length;
    }
    return merged;
}

function createCancellableFactory(environment) {
    return () => (environment.Gio?.Cancellable
        ? new environment.Gio.Cancellable()
        : null);
}


module.exports = {
    createCancellableFactory,
    decodeBytes,
    expandHome,
    fileIdentity,
    isIoError,
    joinChunks,
    readBoundedRegularFileText,
    readBoundedStreamBytes,
    readFileText,
    readFileTextAsync,
    sameIdentity,
};
