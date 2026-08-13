"use strict";

const FileSystem = require("./gio-file-adapter.js");
const Devices = require("./linux-device-adapter.js");

const {isIoError} = FileSystem;
const {closeEnumeratorAsync} = Devices;

// Reading a picture, and writing the buffer a model wants from it.
//
// GdkPixbuf ships with every Cinnamon desktop and is the decoder the panel
// already trusts for icons and thumbnails, so nothing new is installed and no
// image decoder is added to a service that runs models on a shared
// accelerator. `new_from_stream_at_scale_async` scales while it decodes rather
// than after, so a very large picture never becomes a very large allocation;
// the byte ceiling below is a second, cheaper bound in front of it.
const MAX_IMAGE_BYTES = 32 * 1024 * 1024;
const MAX_INPUT_FILES = 64;
const INPUT_BATCH_SIZE = 32;
const IMAGE_SUFFIXES = Object.freeze([
    ".png", ".jpg", ".jpeg", ".webp", ".bmp", ".tif", ".tiff",
]);

function isImageFilename(name) {
    const lowered = String(name).toLowerCase();
    return !lowered.startsWith(".")
        && IMAGE_SUFFIXES.some((suffix) => lowered.endsWith(suffix));
}

// GdkPixbuf's own filters, named by the contract rather than by this enum, so
// a manifest asking for bicubic gets gdk's high-quality resampler and not
// whichever constant happened to be first.
const RESIZE_INTERPOLATION = Object.freeze({
    nearest: "NEAREST",
    bilinear: "BILINEAR",
    bicubic: "HYPER",
});
// `new_from_stream_at_scale_async` scales while it decodes, which is what keeps
// a 9600x5400 picture from becoming a 155 MB allocation — but it is always
// bilinear. Honouring any other declared filter means decoding above the target
// and resampling once, and this bounds how far above.
const RESAMPLE_HEADROOM = 4;

function interpolation(environment, filter) {
    const names = environment.GdkPixbuf.InterpType;
    return names[RESIZE_INTERPOLATION[filter] || "BILINEAR"];
}

// The smallest size covering both axes of the target: what `cover` decodes to
// before its crop.
function coverGeometry(source, geometry) {
    const scale = Math.max(geometry.width / source.width, geometry.height / source.height);
    return {
        width: Math.max(geometry.width, Math.round(source.width * scale)),
        height: Math.max(geometry.height, Math.round(source.height * scale)),
    };
}

// The size to ask the decoder for. Bilinear lands straight on the size the fit
// resolved to, because the streaming scaler already is bilinear; every other
// filter needs pixels above the target to resample from.
function decodeSize(source, geometry, resize) {
    if (source === null) {
        return geometry;
    }
    const headroom = resize.filter === "bilinear" ? 1 : RESAMPLE_HEADROOM;
    const covered = resize.fit === "cover" ? coverGeometry(source, geometry) : geometry;
    return {
        width: Math.min(source.width, covered.width * headroom),
        height: Math.min(source.height, covered.height * headroom),
    };
}

// The largest centred rectangle with the target's aspect ratio. Taken before
// the final scale so `cover` discards the edges rather than squashing them.
function aspectCrop(pixbuf, geometry) {
    const width = pixbuf.get_width();
    const height = pixbuf.get_height();
    const scale = Math.min(width / geometry.width, height / geometry.height);
    const cropWidth = Math.max(1, Math.min(width, Math.round(geometry.width * scale)));
    const cropHeight = Math.max(1, Math.min(height, Math.round(geometry.height * scale)));
    return pixbuf.new_subpixbuf(
        Math.floor((width - cropWidth) / 2),
        Math.floor((height - cropHeight) / 2),
        cropWidth,
        cropHeight,
    );
}

function resolvedPixbuf(environment, pixbuf, geometry, resize) {
    const cropped = resize.fit === "cover" ? aspectCrop(pixbuf, geometry) : pixbuf;
    if (cropped.get_width() === geometry.width && cropped.get_height() === geometry.height) {
        return cropped;
    }
    return cropped.scale_simple(
        geometry.width,
        geometry.height,
        interpolation(environment, resize.filter),
    );
}

function pixbufImage(pixbuf) {
    return {
        width: pixbuf.get_width(),
        height: pixbuf.get_height(),
        channels: pixbuf.get_n_channels(),
        rowstride: pixbuf.get_rowstride(),
        pixels: pixbuf.get_pixels(),
    };
}

function sourceGeometry(environment, path) {
    const info = environment.GdkPixbuf.Pixbuf.get_file_info(path);
    const width = info[1];
    const height = info[2];
    return Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0
        ? {width, height}
        : null;
}

function decodeImageAsync(path, geometry, environment, options, callback) {
    const Gio = environment.Gio;
    const GdkPixbuf = environment.GdkPixbuf;
    const cancellable = options ? options.cancellable || null : null;
    if (!GdkPixbuf) {
        callback(new Error("No image decoder is available in this environment"), null);
        return;
    }
    const guarded = (step) => {
        try {
            step();
        } catch (error) {
            if (!isIoError(environment, error, "CANCELLED")) {
                callback(error, null);
            }
        }
    };
    guarded(() => {
        const file = Gio.File.new_for_path(path);
        const info = file.query_info(
            "standard::size,standard::type",
            Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS,
            cancellable,
        );
        if (info.get_file_type() !== Gio.FileType.REGULAR) {
            throw new Error(`Not a regular file: ${path}`);
        }
        if (info.get_size() > MAX_IMAGE_BYTES) {
            throw new RangeError(`Picture exceeds ${MAX_IMAGE_BYTES} bytes: ${path}`);
        }
        const resize = options?.resize || {filter: "bilinear", fit: "exact"};
        const decoded = decodeSize(sourceGeometry(environment, path), geometry, resize);
        file.read_async(0, cancellable, (source, result) => guarded(() => {
            scaleStreamAsync(source.read_finish(result), decoded, environment, cancellable, {
                geometry, resize, callback,
            });
        }));
    });
}

function scaleStreamAsync(stream, decoded, environment, cancellable, request) {
    const {geometry, resize, callback} = request;
    environment.GdkPixbuf.Pixbuf.new_from_stream_at_scale_async(
        stream,
        decoded.width,
        decoded.height,
        // Never preserve the aspect ratio here: the size asked for is already
        // the one the declared fit resolved to, so letting gdk letterbox it
        // would silently overrule the publisher's choice.
        false,
        cancellable,
        (source, result) => {
            try {
                const pixbuf = environment.GdkPixbuf.Pixbuf.new_from_stream_finish(result);
                callback(null, pixbufImage(
                    resolvedPixbuf(environment, pixbuf, geometry, resize),
                ));
            } catch (error) {
                if (!isIoError(environment, error, "CANCELLED")) {
                    callback(error, null);
                }
            }
        },
    );
}

function writeBufferAsync(path, bytes, environment, callback) {
    const Gio = environment.Gio;
    try {
        const file = Gio.File.new_for_path(path);
        const parent = file.get_parent();
        if (parent !== null && !parent.query_exists(null)) {
            parent.make_directory_with_parents(null);
        }
        file.replace_contents_bytes_async(
            new environment.GLib.Bytes(bytes),
            null,
            false,
            Gio.FileCreateFlags.REPLACE_DESTINATION,
            null,
            (source, result) => {
                try {
                    source.replace_contents_finish(result);
                    callback(null);
                } catch (error) {
                    callback(error);
                }
            },
        );
    } catch (error) {
        callback(error);
    }
}

function removeFile(path, environment) {
    try {
        return environment.Gio.File.new_for_path(path).delete(null);
    } catch {
        return false;
    }
}

// The same digest the service recomputes from the bytes it reads. Computed
// from the buffer in hand rather than from the file just written, so a write
// that lands differently is caught by the service's own comparison instead of
// being papered over by re-reading what was written.
function digestBytes(bytes, environment) {
    return environment.GLib.compute_checksum_for_bytes(
        environment.GLib.ChecksumType.SHA256,
        new environment.GLib.Bytes(bytes),
    );
}

// Buffers a previous session staged and never finished. A crash, a reload, or
// a logout between submission and outcome leaves the file behind, and nothing
// else ever looks at that directory — so an interrupted session accumulates
// them silently in a directory the user owns.
function sweepStagedBuffers(root, environment, suffix) {
    const Gio = environment.Gio;
    const directory = Gio.File.new_for_path(root);
    if (!directory.query_exists(null)) {
        return 0;
    }
    const enumerator = directory.enumerate_children(
        "standard::name,standard::type",
        Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS,
        null,
    );
    let removed = 0;
    try {
        let info = enumerator.next_file(null);
        while (info !== null) {
            const name = info.get_name();
            if (info.get_file_type() === Gio.FileType.REGULAR && name.endsWith(suffix)) {
                removed += removeFile(`${root}/${name}`, environment) ? 1 : 0;
            }
            info = enumerator.next_file(null);
        }
    } finally {
        enumerator.close(null);
    }
    return removed;
}

function createImagePort(environment) {
    return {
        decode(path, geometry, resize, callback) {
            decodeImageAsync(path, geometry, environment, {resize}, callback);
        },
        write(path, bytes, callback) {
            writeBufferAsync(path, bytes, environment, callback);
        },
        remove(path) {
            return removeFile(path, environment);
        },
        digest(bytes) {
            return digestBytes(bytes, environment);
        },
        sweep(root, suffix) {
            return sweepStagedBuffers(root, environment, suffix);
        },
    };
}

// The pictures a user has put where the runtime is allowed to read them. The
// input root is both the permission boundary and the way in: a file inside it
// is one the service will read, and a file anywhere else is one it refuses, so
// listing the root is the honest set of things that can actually be run.
function listInputImages(root, environment) {
    const Gio = environment.Gio;
    const directory = Gio.File.new_for_path(root);
    if (!directory.query_exists(null)) {
        return [];
    }
    const enumerator = directory.enumerate_children(
        "standard::name,standard::type",
        Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS,
        null,
    );
    const names = [];
    try {
        let info = enumerator.next_file(null);
        while (info !== null && names.length < MAX_INPUT_FILES) {
            if (info.get_file_type() === Gio.FileType.REGULAR && isImageFilename(info.get_name())) {
                names.push(info.get_name());
            }
            info = enumerator.next_file(null);
        }
    } finally {
        enumerator.close(null);
    }
    return names.sort();
}

function collectInputImagesAsync(
    enumerator, environment, cancellable, names, callback,
) {
    if (names.length >= MAX_INPUT_FILES) {
        closeEnumeratorAsync(enumerator, environment, cancellable, (error) => callback(error, names));
        return;
    }
    try {
        enumerator.next_files_async(
            INPUT_BATCH_SIZE,
            0,
            cancellable,
            (source, result) => {
                let batch;
                try {
                    batch = source.next_files_finish(result);
                } catch (error) {
                    closeEnumeratorAsync(enumerator, environment, null, () => callback(error, []));
                    return;
                }
                for (const info of batch) {
                    if (names.length >= MAX_INPUT_FILES) {
                        break;
                    }
                    if (info.get_file_type() === environment.Gio.FileType.REGULAR
                            && isImageFilename(info.get_name())) {
                        names.push(info.get_name());
                    }
                }
                if (batch.length === 0 || names.length >= MAX_INPUT_FILES) {
                    closeEnumeratorAsync(
                        enumerator,
                        environment,
                        cancellable,
                        (error) => callback(error, names.sort()),
                    );
                    return;
                }
                collectInputImagesAsync(
                    enumerator,
                    environment,
                    cancellable,
                    names,
                    callback,
                );
            },
        );
    } catch (error) {
        closeEnumeratorAsync(enumerator, environment, null, () => callback(error, []));
    }
}

function listInputImagesAsync(root, environment, cancellable, callback) {
    const directory = environment.Gio.File.new_for_path(root);
    try {
        directory.enumerate_children_async(
            "standard::name,standard::type",
            environment.Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS,
            0,
            cancellable,
            (source, result) => {
                let enumerator;
                try {
                    enumerator = source.enumerate_children_finish(result);
                } catch (error) {
                    if (isIoError(environment, error, "NOT_FOUND")) {
                        callback(null, []);
                    } else {
                        callback(error, []);
                    }
                    return;
                }
                collectInputImagesAsync(
                    enumerator, environment, cancellable, [], callback,
                );
            },
        );
    } catch (error) {
        callback(error, []);
    }
}

// Bounded per root rather than across all of them. Slicing the combined list
// let the first root fill the budget and the rest vanish entirely — the
// runtime would read a picture the popup never showed, which is the silence
// this project's own rule about capped lists exists to prevent.
function createInputCatalog(environment, logger) {
    const catalog = {
        pictures(roots) {
            const share = Math.max(1, Math.floor(MAX_INPUT_FILES / Math.max(1, roots.length)));
            const found = [];
            let omitted = 0;
            for (const root of roots) {
                try {
                    const names = listInputImages(root, environment);
                    omitted += Math.max(0, names.length - share);
                    for (const name of names.slice(0, share)) {
                        found.push({root, name, path: `${root}/${name}`});
                    }
                } catch (error) {
                    logger.warn(`Could not list runtime input root ${root}: ${error}`);
                }
            }
            if (omitted > 0) {
                logger.warn(
                    `${omitted} picture(s) in the runtime input roots are not listed; `
                    + `at most ${share} per root are shown`,
                );
            }
            return {pictures: found, omitted};
        },
    };
    if (typeof environment?.Gio?.File?.new_for_path !== "function"
            || typeof environment.Gio.Cancellable !== "function") {
        return catalog;
    }
    catalog.picturesAsync = (roots, callback) => {
        if (typeof callback !== "function") {
            throw new TypeError("An input catalog callback is required");
        }
        const cancellable = typeof environment.Gio.Cancellable === "function"
            ? new environment.Gio.Cancellable()
            : null;
        const share = Math.max(1, Math.floor(MAX_INPUT_FILES / Math.max(1, roots.length)));
        const found = [];
        let omitted = 0;
        let index = 0;
        const next = () => {
            if (index >= roots.length) {
                if (omitted > 0) {
                    logger.warn(
                        `${omitted} picture(s) in the runtime input roots are not listed; `
                        + `at most ${share} per root are shown`,
                    );
                }
                callback(null, {pictures: found, omitted});
                return;
            }
            const root = roots[index];
            index += 1;
            listInputImagesAsync(root, environment, cancellable, (error, names) => {
                if (error) {
                    if (!isIoError(environment, error, "CANCELLED")) {
                        logger.warn(`Could not list runtime input root ${root}: ${error}`);
                        next();
                    }
                    return;
                }
                omitted += Math.max(0, names.length - share);
                for (const name of names.slice(0, share)) {
                    found.push({root, name, path: `${root}/${name}`});
                }
                next();
            });
        };
        next();
        return () => {
            if (cancellable === null || cancellable.is_cancelled()) {
                return false;
            }
            cancellable.cancel();
            return true;
        };
    };
    return catalog;
}

module.exports = {
    IMAGE_SUFFIXES,
    INPUT_BATCH_SIZE,
    MAX_IMAGE_BYTES,
    MAX_INPUT_FILES,
    RESAMPLE_HEADROOM,
    RESIZE_INTERPOLATION,
    aspectCrop,
    collectInputImagesAsync,
    coverGeometry,
    createImagePort,
    createInputCatalog,
    decodeImageAsync,
    decodeSize,
    digestBytes,
    interpolation,
    isImageFilename,
    listInputImages,
    listInputImagesAsync,
    removeFile,
    resolvedPixbuf,
    sourceGeometry,
    sweepStagedBuffers,
    writeBufferAsync,
};
