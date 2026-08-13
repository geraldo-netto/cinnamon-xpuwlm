"use strict";

// Captions are rendered from validated media evidence. Host-owned deterministic
// actions perform atomic writes only after preview and fresh confirmation.

const Actions = require("./deterministic-action-port.js");
const Media = require("./media-transcription.js");

const VERSION = 1;
const MAX_RENDERED_CHARACTERS = 24_000;
const SOURCE_FIELDS = Object.freeze(["fileName", "sourceSha256", "modality", "durationMs"]);
const CUE_FIELDS = Object.freeze(["startMs", "endMs", "text"]);
const MEASUREMENT_FIELDS = Object.freeze([
    "decodeMs", "preprocessingMs", "inferenceMs", "postprocessingMs", "renderMs", "exportMs",
    "totalMs",
]);
const EXPORT_FIELDS = Object.freeze([
    "requestId", "format", "track", "destination", "measurements",
]);
const REQUEST_ID = /^[A-Za-z0-9._-]{1,120}$/u;
const DIGEST = /^[a-f0-9]{64}$/u;

class CaptionExportError extends Error {
    constructor(code, detail) {
        super(detail);
        this.name = "CaptionExportError";
        this.code = code;
    }
}

function isRecord(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value);
}

function exactKeys(value, fields) {
    return isRecord(value) && Object.keys(value).length === fields.length
        && fields.every((name) => Object.hasOwn(value, name));
}

function boundedText(value, minimum = 1, maximum = Media.MAX_SPEECH_TEXT_CHARACTERS) {
    return typeof value === "string" && !value.includes("\0")
        && [...value].length >= minimum && [...value].length <= maximum;
}

function validCaptionSource(value) {
    return isRecord(value) && exactKeys(value.source, SOURCE_FIELDS)
        && ["audio", "video"].includes(value.source.modality)
        && DIGEST.test(value.source.sourceSha256)
        && Number.isInteger(value.source.durationMs) && value.source.durationMs > 0
        && Media.validSpeech(value.speech, value.source)
        && Media.validVisuals(value.visuals, value.source);
}

function validCue(value, durationMs, previousEnd) {
    return exactKeys(value, CUE_FIELDS) && Number.isInteger(value.startMs)
        && Number.isInteger(value.endMs) && value.startMs >= previousEnd
        && value.startMs < value.endMs && value.endMs <= durationMs
        && boundedText(value.text);
}

function validCueSequence(value, durationMs) {
    if (!Array.isArray(value) || value.length > Media.MAX_SEGMENTS) {
        return false;
    }
    let previousEnd = 0;
    for (const cue of value) {
        if (!validCue(cue, durationMs, previousEnd)) {
            return false;
        }
        previousEnd = cue.endMs;
    }
    return true;
}

function speechCues(transcription) {
    return Object.freeze(transcription.speech.segments.map((segment) => Object.freeze({
        startMs: segment.startMs,
        endMs: segment.endMs,
        text: segment.text,
    })));
}

function visualCueEnd(visuals, index, durationMs) {
    return visuals[index + 1]?.timestampMs ?? durationMs;
}

function visualCues(transcription) {
    if (transcription.source.modality === "audio") {
        return Object.freeze([]);
    }
    const cues = transcription.visuals.map((visual, index) => Object.freeze({
        startMs: visual.timestampMs,
        endMs: visualCueEnd(transcription.visuals, index, transcription.source.durationMs),
        text: visual.visibleText === ""
            ? visual.description
            : `${visual.description}\nVisible text: ${visual.visibleText}`,
    }));
    if (!validCueSequence(cues, transcription.source.durationMs)) {
        throw new CaptionExportError("visual-timing-invalid", "frame descriptions overlap or lack duration");
    }
    return Object.freeze(cues);
}

function captionDocument(transcription) {
    if (!validCaptionSource(transcription)) {
        throw new CaptionExportError("source-invalid", "audio or video transcription is invalid");
    }
    const speech = speechCues(transcription);
    if (!validCueSequence(speech, transcription.source.durationMs)) {
        throw new CaptionExportError("speech-timing-invalid", "speech captions overlap");
    }
    return Object.freeze({
        version: VERSION,
        sourceSha256: transcription.source.sourceSha256,
        durationMs: transcription.source.durationMs,
        speech,
        visual: visualCues(transcription),
    });
}

function timestamp(milliseconds, separator) {
    const hours = Math.floor(milliseconds / 3_600_000);
    const minutes = Math.floor(milliseconds % 3_600_000 / 60_000);
    const seconds = Math.floor(milliseconds % 60_000 / 1000);
    const millis = milliseconds % 1000;
    return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`
        + `:${String(seconds).padStart(2, "0")}${separator}${String(millis).padStart(3, "0")}`;
}

function renderSrt(cues) {
    return cues.map((cue, index) => (
        `${index + 1}\n${timestamp(cue.startMs, ",")} --> ${timestamp(cue.endMs, ",")}`
        + `\n${cue.text}\n`
    )).join("\n");
}

function renderWebVtt(cues) {
    const body = cues.map((cue) => (
        `${timestamp(cue.startMs, ".")} --> ${timestamp(cue.endMs, ".")}\n${cue.text}\n`
    )).join("\n");
    return `WEBVTT\n\n${body}`;
}

function validRenderRequest(document, format, track) {
    return isRecord(document) && document.version === VERSION
        && ["srt", "vtt"].includes(format) && ["speech", "visual"].includes(track);
}

function renderTrack(document, format, track) {
    if (!validRenderRequest(document, format, track)) {
        throw new CaptionExportError("render-invalid", "caption format or track is invalid");
    }
    const cues = document[track];
    if (!validCueSequence(cues, document.durationMs)) {
        throw new CaptionExportError("render-invalid", "caption cues are invalid");
    }
    const rendered = format === "srt" ? renderSrt(cues) : renderWebVtt(cues);
    if (!boundedText(rendered, format === "vtt" ? 8 : 0, MAX_RENDERED_CHARACTERS)) {
        throw new CaptionExportError("render-too-large", "rendered captions exceed action bounds");
    }
    return rendered;
}

function validMeasurements(value) {
    if (!exactKeys(value, MEASUREMENT_FIELDS)
        || !MEASUREMENT_FIELDS.every((name) => Number.isFinite(value[name]) && value[name] >= 0)) {
        return false;
    }
    const stages = MEASUREMENT_FIELDS.slice(0, -1).reduce((sum, name) => sum + value[name], 0);
    return value.totalMs >= stages;
}

function fullStageMeasurements(value) {
    if (!validMeasurements(value)) {
        throw new CaptionExportError("measurements-invalid", "caption stage measurements are invalid");
    }
    return Object.freeze({...value});
}

function validDestination(value, format) {
    return boundedText(value, 1, 4096) && value.startsWith("/")
        && !value.includes("/../") && !value.endsWith("/..")
        && value.toLowerCase().endsWith(`.${format}`);
}

function validExport(value) {
    return exactKeys(value, EXPORT_FIELDS) && REQUEST_ID.test(value.requestId)
        && ["srt", "vtt"].includes(value.format)
        && ["speech", "visual"].includes(value.track)
        && validDestination(value.destination, value.format)
        && validMeasurements(value.measurements);
}

function exportCaptionAction(document, value) {
    if (!validExport(value)) {
        throw new CaptionExportError("export-invalid", "caption export request is invalid");
    }
    const content = renderTrack(document, value.format, value.track);
    const parameters = Object.freeze({
        version: VERSION,
        format: value.format,
        track: value.track,
        content,
        atomic: true,
        cleanupPartialOnCancel: true,
        overwrite: false,
        measurements: fullStageMeasurements(value.measurements),
    });
    if (!Actions.validParameters(parameters)) {
        throw new CaptionExportError("export-too-large", "caption action exceeds parameter bounds");
    }
    return Object.freeze({
        requestId: value.requestId,
        actionId: "export-captions",
        sourceResultSha256: document.sourceSha256,
        targets: Object.freeze([value.destination]),
        parameters,
    });
}

module.exports = {
    MAX_RENDERED_CHARACTERS,
    VERSION,
    CaptionExportError,
    boundedText,
    captionDocument,
    exactKeys,
    exportCaptionAction,
    fullStageMeasurements,
    renderSrt,
    renderTrack,
    renderWebVtt,
    speechCues,
    timestamp,
    validCaptionSource,
    validCue,
    validCueSequence,
    validDestination,
    validExport,
    validMeasurements,
    validRenderRequest,
    visualCueEnd,
    visualCues,
};
