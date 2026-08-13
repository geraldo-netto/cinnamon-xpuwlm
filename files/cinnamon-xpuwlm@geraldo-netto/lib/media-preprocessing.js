"use strict";

// Shared host-side contract for bounded media preparation. Decoders remain
// behind an injected port: this module owns format routing, lossless
// intermediate policy, limits, result validation, cancellation, and cleanup.

const Validation = require("./validation.js");

const VERSION = 1;
const MAX_SOURCE_BYTES = 128 * 1024 * 1024;
const MAX_DURATION_MS = 600_000;
const MAX_VIDEO_DURATION_MS = 300_000;
const MAX_PAGES = 64;
const MAX_VISUALS = 12;
const MAX_ARCHIVE_ENTRIES = 4096;
const MAX_ARCHIVE_EXPANDED_BYTES = 256 * 1024 * 1024;
const MAX_RENDER_DIMENSION = 1600;
const MAX_INFERENCE_DIMENSION = 768;
const FRAME_INTERVAL_MS = 15_000;
const AUDIO_SAMPLE_RATE_HZ = 16_000;
const AUDIO_CHANNELS = 1;
const AUDIO_SAMPLE_FORMAT = "float32-planar";
const IMAGE_MIME_TYPE = "image/png";
const FORMAT_DEFINITIONS = Object.freeze([
    Object.freeze({format: "flac", family: "audio", suffixes: [".flac"]}),
    Object.freeze({format: "m4a", family: "audio", suffixes: [".m4a"]}),
    Object.freeze({format: "mp3", family: "audio", suffixes: [".mp3"]}),
    Object.freeze({format: "ogg", family: "audio", suffixes: [".ogg"]}),
    Object.freeze({format: "opus", family: "audio", suffixes: [".opus"]}),
    Object.freeze({format: "wav", family: "audio", suffixes: [".wav"]}),
    Object.freeze({format: "pdf", family: "document", suffixes: [".pdf"]}),
    Object.freeze({format: "tiff", family: "document", suffixes: [".tif", ".tiff"]}),
    Object.freeze({format: "jpeg", family: "image", suffixes: [".jpeg", ".jpg"]}),
    Object.freeze({format: "png", family: "image", suffixes: [".png"]}),
    Object.freeze({format: "svg", family: "image", suffixes: [".svg"]}),
    Object.freeze({format: "webp", family: "image", suffixes: [".webp"]}),
    Object.freeze({format: "odp", family: "presentation", suffixes: [".odp"]}),
    Object.freeze({format: "pptx", family: "presentation", suffixes: [".pptx"]}),
    Object.freeze({format: "avi", family: "video", suffixes: [".avi"]}),
    Object.freeze({format: "m4v", family: "video", suffixes: [".m4v"]}),
    Object.freeze({format: "mkv", family: "video", suffixes: [".mkv"]}),
    Object.freeze({format: "mov", family: "video", suffixes: [".mov"]}),
    Object.freeze({format: "mp4", family: "video", suffixes: [".mp4"]}),
    Object.freeze({format: "webm", family: "video", suffixes: [".webm"]}),
]);
const SOURCE_SUFFIXES = Object.freeze(FORMAT_DEFINITIONS.flatMap((item) => item.suffixes));
const AUDIO_SUFFIXES = suffixesFor("audio");
const DOCUMENT_SUFFIXES = suffixesFor("document");
const IMAGE_SUFFIXES = suffixesFor("image");
const PRESENTATION_SUFFIXES = suffixesFor("presentation");
const VIDEO_SUFFIXES = suffixesFor("video");
const PROBE_FIELDS = Object.freeze([
    "format", "durationMs", "width", "height", "pageCount", "hasAudio",
    "archiveEntries", "archiveExpandedBytes",
]);
const DECODED_FIELDS = Object.freeze(["images", "audio"]);
const IMAGE_FIELDS = Object.freeze([
    "name", "width", "height", "timestampMs", "pageNumber", "slideNumber",
    "mimeType", "colorSpace", "orientation",
]);
const AUDIO_FIELDS = Object.freeze([
    "name", "durationMs", "sampleRateHz", "channels", "sampleFormat",
]);
const FILE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,254}$/u;

class MediaPreprocessingError extends Error {
    constructor(code, detail) {
        super(detail);
        this.name = "MediaPreprocessingError";
        this.code = code;
    }
}

const isRecord = Validation.isRecord;
const exactKeys = Validation.exactKeys;

function suffixesFor(family) {
    return Object.freeze(FORMAT_DEFINITIONS
        .filter((item) => item.family === family)
        .flatMap((item) => item.suffixes));
}

function formatDefinition(path) {
    if (typeof path !== "string") {
        return null;
    }
    const lowered = path.toLowerCase();
    return FORMAT_DEFINITIONS.find((item) => item.suffixes.some(
        (suffix) => lowered.endsWith(suffix),
    )) || null;
}

function sourceFormat(path) {
    return formatDefinition(path)?.format || "";
}

function mediaFamily(path) {
    return formatDefinition(path)?.family || "";
}

function validSourceIdentity(value) {
    return typeof value.path === "string"
        && value.path.startsWith("/")
        && value.path.length <= 4096
        && typeof value.name === "string"
        && FILE_NAME.test(value.name);
}

function validSourceKind(value) {
    return Number.isSafeInteger(value.size)
        && value.size >= 1
        && value.size <= MAX_SOURCE_BYTES
        && value.regular === true
        && value.symlink === false
        && formatDefinition(value.path) !== null;
}

function validSource(value) {
    return exactKeys(value, ["path", "name", "size", "regular", "symlink"])
        && validSourceIdentity(value)
        && validSourceKind(value);
}

function ownedSource(value) {
    if (!validSource(value)) {
        throw new MediaPreprocessingError("source-invalid", "media source is invalid");
    }
    return Object.freeze({
        path: value.path,
        name: value.name,
        size: value.size,
        regular: true,
        symlink: false,
    });
}

function positiveInteger(value, maximum) {
    return Number.isSafeInteger(value) && value >= 1 && value <= maximum;
}

function nullGeometry(probe) {
    return probe.width === null && probe.height === null;
}

function noArchive(probe) {
    return probe.archiveEntries === null && probe.archiveExpandedBytes === null;
}

function noPages(probe) {
    return probe.pageCount === null;
}

function validAudioProbe(probe) {
    return positiveInteger(probe.durationMs, MAX_DURATION_MS)
        && nullGeometry(probe)
        && noPages(probe)
        && probe.hasAudio === true
        && noArchive(probe);
}

function validDocumentProbe(probe) {
    return probe.durationMs === null
        && nullGeometry(probe)
        && positiveInteger(probe.pageCount, MAX_PAGES)
        && probe.hasAudio === false
        && noArchive(probe);
}

function validImageProbe(probe) {
    return probe.durationMs === null
        && positiveInteger(probe.width, 65_535)
        && positiveInteger(probe.height, 65_535)
        && noPages(probe)
        && probe.hasAudio === false
        && noArchive(probe);
}

function validPresentationProbe(probe) {
    return probe.durationMs === null
        && nullGeometry(probe)
        && positiveInteger(probe.pageCount, MAX_PAGES)
        && probe.hasAudio === false
        && positiveInteger(probe.archiveEntries, MAX_ARCHIVE_ENTRIES)
        && positiveInteger(probe.archiveExpandedBytes, MAX_ARCHIVE_EXPANDED_BYTES);
}

function validVideoProbe(probe) {
    return positiveInteger(probe.durationMs, MAX_VIDEO_DURATION_MS)
        && positiveInteger(probe.width, 65_535)
        && positiveInteger(probe.height, 65_535)
        && noPages(probe)
        && typeof probe.hasAudio === "boolean"
        && noArchive(probe);
}

const PROBE_VALIDATORS = Object.freeze({
    audio: validAudioProbe,
    document: validDocumentProbe,
    image: validImageProbe,
    presentation: validPresentationProbe,
    video: validVideoProbe,
});

function validProbe(source, probe) {
    const definition = formatDefinition(source.path);
    return definition !== null
        && exactKeys(probe, PROBE_FIELDS)
        && probe.format === definition.format
        && PROBE_VALIDATORS[definition.family](probe);
}

function sampleTimestamps(durationMs) {
    if (!positiveInteger(durationMs, MAX_VIDEO_DURATION_MS)) {
        throw new MediaPreprocessingError("duration-invalid", "video duration is invalid");
    }
    const count = Math.min(MAX_VISUALS, Math.max(1, Math.ceil(durationMs / FRAME_INTERVAL_MS)));
    if (count === 1) {
        return Object.freeze([0]);
    }
    return Object.freeze(Array.from({length: count}, (_value, index) => (
        Math.round(index * (durationMs - 1) / (count - 1))
    )));
}

function operationNames(definition, probe) {
    const first = {
        audio: "decode-audio",
        document: definition.format === "pdf" ? "render-pdf-pages" : "decode-tiff-pages",
        image: definition.format === "svg" ? "render-svg" : "decode-raster-image",
        presentation: "inspect-presentation-archive",
        video: "decode-video-frames",
    }[definition.family];
    const operations = [first];
    if (["document", "image", "presentation", "video"].includes(definition.family)) {
        operations.push("apply-orientation", "convert-srgb", "resize-contain", "encode-lossless-png");
    }
    if (definition.family === "presentation") {
        operations.splice(1, 0, "extract-slide-text");
    }
    if (definition.family === "audio" || probe.hasAudio) {
        operations.push("resample-mono-float32");
    }
    return Object.freeze(operations);
}

function frozenLimits() {
    return Object.freeze({
        sourceBytes: MAX_SOURCE_BYTES,
        durationMs: MAX_DURATION_MS,
        videoDurationMs: MAX_VIDEO_DURATION_MS,
        pages: MAX_PAGES,
        visuals: MAX_VISUALS,
        archiveEntries: MAX_ARCHIVE_ENTRIES,
        archiveExpandedBytes: MAX_ARCHIVE_EXPANDED_BYTES,
    });
}

function frozenImagePolicy() {
    return Object.freeze({
        mimeType: IMAGE_MIME_TYPE,
        colorSpace: "srgb",
        orientation: "apply-metadata",
        renderMaxDimension: MAX_RENDER_DIMENSION,
        inferenceMaxDimension: MAX_INFERENCE_DIMENSION,
        resizeMode: "contain",
        resizeFilter: "lanczos",
    });
}

function frozenAudioPolicy() {
    return Object.freeze({
        sampleRateHz: AUDIO_SAMPLE_RATE_HZ,
        channels: AUDIO_CHANNELS,
        sampleFormat: AUDIO_SAMPLE_FORMAT,
        intermediate: "memory",
    });
}

function preprocessingPlan(source, probe) {
    const selected = ownedSource(source);
    if (!validProbe(selected, probe)) {
        throw new MediaPreprocessingError("probe-invalid", "media probe is invalid");
    }
    const definition = formatDefinition(selected.path);
    const timestamps = definition.family === "video"
        ? sampleTimestamps(probe.durationMs)
        : Object.freeze([]);
    return Object.freeze({
        version: VERSION,
        source: Object.freeze({
            path: selected.path,
            name: selected.name,
            sizeBytes: selected.size,
            format: definition.format,
            family: definition.family,
        }),
        limits: frozenLimits(),
        image: frozenImagePolicy(),
        audio: frozenAudioPolicy(),
        frameTimestampsMs: timestamps,
        operations: operationNames(definition, probe),
    });
}

function safeTemporaryName(value) {
    return typeof value === "string" && FILE_NAME.test(value);
}

function validImageIdentity(image) {
    return exactKeys(image, IMAGE_FIELDS)
        && safeTemporaryName(image.name)
        && positiveInteger(image.width, MAX_INFERENCE_DIMENSION)
        && positiveInteger(image.height, MAX_INFERENCE_DIMENSION)
        && image.mimeType === IMAGE_MIME_TYPE
        && image.colorSpace === "srgb"
        && image.orientation === "applied";
}

function documentImagePosition(image, _plan, index) {
    return image.pageNumber === index + 1
        && image.slideNumber === null && image.timestampMs === null;
}

function presentationImagePosition(image, _plan, index) {
    return image.slideNumber === index + 1
        && image.pageNumber === null && image.timestampMs === null;
}

function videoImagePosition(image, plan, index) {
    return image.timestampMs === plan.frameTimestampsMs[index]
        && image.pageNumber === null && image.slideNumber === null;
}

function staticImagePosition(image) {
    return image.timestampMs === null && image.pageNumber === null && image.slideNumber === null;
}

const IMAGE_POSITION_VALIDATORS = Object.freeze({
    audio: staticImagePosition,
    document: documentImagePosition,
    image: staticImagePosition,
    presentation: presentationImagePosition,
    video: videoImagePosition,
});

function validImagePosition(image, plan, index) {
    return IMAGE_POSITION_VALIDATORS[plan.source.family](image, plan, index);
}

function expectedImageCount(plan, probe) {
    return {
        audio: 0,
        document: probe.pageCount,
        image: 1,
        presentation: probe.pageCount,
        video: plan.frameTimestampsMs.length,
    }[plan.source.family];
}

function validImages(images, plan, probe) {
    if (!Array.isArray(images) || images.length !== expectedImageCount(plan, probe)) {
        return false;
    }
    if (!images.every((image, index) => (
        validImageIdentity(image) && validImagePosition(image, plan, index)
    ))) {
        return false;
    }
    return new Set(images.map((image) => image.name)).size === images.length;
}

function validAudio(audio, plan, probe) {
    const expected = plan.source.family === "audio"
        || (plan.source.family === "video" && probe.hasAudio);
    if (!expected) {
        return audio === null;
    }
    return validAudioIdentity(audio, probe);
}

function validAudioIdentity(audio, probe) {
    return exactKeys(audio, AUDIO_FIELDS)
        && safeTemporaryName(audio.name)
        && audio.durationMs === probe.durationMs
        && audio.sampleRateHz === AUDIO_SAMPLE_RATE_HZ
        && audio.channels === AUDIO_CHANNELS
        && audio.sampleFormat === AUDIO_SAMPLE_FORMAT;
}

function frozenImage(image) {
    return Object.freeze({...image});
}

function normalizedOutput(value, plan, probe) {
    if (!exactKeys(value, DECODED_FIELDS)
        || !validImages(value.images, plan, probe)
        || !validAudio(value.audio, plan, probe)) {
        throw new MediaPreprocessingError("decode-invalid", "decoded media is invalid");
    }
    if (value.audio !== null && value.images.some((image) => image.name === value.audio.name)) {
        throw new MediaPreprocessingError("decode-invalid", "temporary output names conflict");
    }
    return Object.freeze({
        version: VERSION,
        source: plan.source,
        images: Object.freeze(value.images.map(frozenImage)),
        audio: value.audio === null ? null : Object.freeze({...value.audio}),
    });
}

function requirePort(candidate, methods, label) {
    if (!isRecord(candidate) || methods.some((name) => typeof candidate[name] !== "function")) {
        throw new MediaPreprocessingError("port-invalid", `${label} port is invalid`);
    }
    return candidate;
}

async function preprocessMedia({source, adapter, temporary, signal, consume}) {
    const selected = ownedSource(source);
    const decoder = requirePort(adapter, ["inspect", "decode"], "media adapter");
    const temporaryFiles = requirePort(temporary, ["open", "cleanup"], "temporary file");
    const cancellation = requirePort(signal, ["throwIfCancelled"], "cancellation");
    if (typeof consume !== "function") {
        throw new MediaPreprocessingError("consumer-invalid", "media consumer is invalid");
    }
    cancellation.throwIfCancelled();
    const probe = await decoder.inspect(selected, cancellation);
    cancellation.throwIfCancelled();
    const plan = preprocessingPlan(selected, probe);
    const scope = await temporaryFiles.open(plan);
    try {
        cancellation.throwIfCancelled();
        const decoded = await decoder.decode(plan, scope, cancellation);
        cancellation.throwIfCancelled();
        return await consume(normalizedOutput(decoded, plan, probe), cancellation);
    } finally {
        await temporaryFiles.cleanup(scope);
    }
}

module.exports = {
    AUDIO_CHANNELS,
    AUDIO_SAMPLE_FORMAT,
    AUDIO_SAMPLE_RATE_HZ,
    AUDIO_SUFFIXES,
    DOCUMENT_SUFFIXES,
    FORMAT_DEFINITIONS,
    FRAME_INTERVAL_MS,
    IMAGE_MIME_TYPE,
    IMAGE_SUFFIXES,
    MAX_ARCHIVE_ENTRIES,
    MAX_ARCHIVE_EXPANDED_BYTES,
    MAX_DURATION_MS,
    MAX_INFERENCE_DIMENSION,
    MAX_PAGES,
    MAX_RENDER_DIMENSION,
    MAX_SOURCE_BYTES,
    MAX_VIDEO_DURATION_MS,
    MAX_VISUALS,
    MediaPreprocessingError,
    PRESENTATION_SUFFIXES,
    SOURCE_SUFFIXES,
    VIDEO_SUFFIXES,
    mediaFamily,
    normalizedOutput,
    operationNames,
    ownedSource,
    preprocessMedia,
    preprocessingPlan,
    sampleTimestamps,
    sourceFormat,
    validAudio,
    validImages,
    validProbe,
    validSource,
};
