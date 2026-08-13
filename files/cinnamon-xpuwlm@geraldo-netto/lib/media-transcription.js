"use strict";

// One explicitly selected media file in, one immutable textual representation
// out. Only a qualified accelerator worker can make this workflow available.

const Job = require("./runtime-job-contract.js");
const Workflow = require("./workflow-controller.js");

const PROFILE_ID = "media-transcription";
const MAX_SOURCE_BYTES = 128 * 1024 * 1024;
const MAX_DURATION_MS = 600_000;
const MAX_VIDEO_DURATION_MS = 300_000;
const MAX_SEGMENTS = 2048;
const MAX_VISUALS = 12;
const MAX_PRESENTATION_SLIDES = 64;
const MAX_TEXT_CHARACTERS = 16_384;
const MAX_SPEECH_TEXT_CHARACTERS = 4096;
const MAX_POLLS = 600;
const POLL_INTERVAL_MS = 500;
const AUDIO_SUFFIXES = Object.freeze([".flac", ".m4a", ".mp3", ".ogg", ".opus", ".wav"]);
const IMAGE_SUFFIXES = Object.freeze([".jpeg", ".jpg", ".png", ".svg", ".webp"]);
const VIDEO_SUFFIXES = Object.freeze([".avi", ".m4v", ".mkv", ".mov", ".mp4", ".webm"]);
const PRESENTATION_SUFFIXES = Object.freeze([".odp", ".pptx"]);
const DOCUMENT_SUFFIXES = Object.freeze([".pdf", ".tif", ".tiff"]);
const SOURCE_SUFFIXES = Object.freeze([
    ...AUDIO_SUFFIXES, ...DOCUMENT_SUFFIXES, ...IMAGE_SUFFIXES,
    ...VIDEO_SUFFIXES, ...PRESENTATION_SUFFIXES,
]);
const REQUEST_ID = /^[A-Za-z0-9._-]{1,120}$/u;
const IDENTIFIER = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const DIGEST = /^[a-f0-9]{64}$/u;
const LANGUAGE = /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/u;
const RESULT_FIELDS = new Set([
    "version", "requestId", "providerId", "accelerator", "source", "speech", "visuals",
]);
const SOURCE_FIELDS = new Set(["fileName", "sourceSha256", "modality", "durationMs"]);
const SPEECH_FIELDS = new Set(["language", "segments"]);
const SEGMENT_FIELDS = new Set(["startMs", "endMs", "text"]);
const VISUAL_FIELDS = new Set([
    "timestampMs", "slideNumber", "pageNumber", "visibleText", "description",
]);

class MediaTranscriptionError extends Error {
    constructor(code, detail) {
        super(`${code}: ${detail}`);
        this.name = "MediaTranscriptionError";
        this.code = code;
        this.detail = detail;
    }
}

function isRecord(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value);
}

function exactRecord(value, fields) {
    return isRecord(value)
        && Object.keys(value).length === fields.size
        && Object.keys(value).every((name) => fields.has(name));
}

function boundedText(value, minimum, maximum) {
    return typeof value === "string"
        && !value.includes("\0")
        && [...value].length >= minimum
        && [...value].length <= maximum;
}

function suffixOf(path) {
    const lowered = String(path).toLowerCase();
    return SOURCE_SUFFIXES.find((suffix) => lowered.endsWith(suffix)) || "";
}

function modalityOf(path) {
    const suffix = suffixOf(path);
    if (AUDIO_SUFFIXES.includes(suffix)) {
        return "audio";
    }
    if (IMAGE_SUFFIXES.includes(suffix)) {
        return "image";
    }
    if (DOCUMENT_SUFFIXES.includes(suffix)) {
        return "document";
    }
    if (VIDEO_SUFFIXES.includes(suffix)) {
        return "video";
    }
    return PRESENTATION_SUFFIXES.includes(suffix) ? "presentation" : "";
}

function validSourceIdentity(candidate) {
    return isRecord(candidate)
        && boundedText(candidate.path, 1, 4096)
        && candidate.path.startsWith("/")
        && boundedText(candidate.name, 1, 255)
        && !candidate.name.includes("/")
        && !candidate.name.includes("\\")
        && !candidate.name.startsWith(".");
}

function validSourceKind(candidate) {
    return isRecord(candidate)
        && candidate.regular === true
        && candidate.symlink !== true
        && Number.isInteger(candidate.size)
        && candidate.size >= 1
        && candidate.size <= MAX_SOURCE_BYTES
        && modalityOf(candidate.path) !== "";
}

function supportedSource(candidate) {
    return validSourceIdentity(candidate) && validSourceKind(candidate);
}

function selectedSource(candidates) {
    if (!Array.isArray(candidates) || candidates.length !== 1) {
        throw new MediaTranscriptionError("source-invalid", "choose exactly one media file");
    }
    if (!supportedSource(candidates[0])) {
        throw new MediaTranscriptionError(
            "source-invalid", "choose one supported non-empty regular media file",
        );
    }
    const source = candidates[0];
    return Object.freeze({
        path: source.path,
        name: source.name,
        size: source.size,
        regular: true,
        symlink: false,
    });
}

function validDuration(value, modality) {
    if (["document", "image", "presentation"].includes(modality)) {
        return value === null;
    }
    return Number.isInteger(value)
        && value > 0
        && value <= (modality === "video" ? MAX_VIDEO_DURATION_MS : MAX_DURATION_MS);
}

function validSourceResult(value, selected) {
    const modality = modalityOf(selected.path);
    return exactRecord(value, SOURCE_FIELDS)
        && value.fileName === selected.name
        && DIGEST.test(value.sourceSha256)
        && value.modality === modality
        && validDuration(value.durationMs, modality);
}

function validSegment(value, duration, previousEnd) {
    return exactRecord(value, SEGMENT_FIELDS)
        && Number.isInteger(value.startMs)
        && Number.isInteger(value.endMs)
        && value.startMs >= previousEnd
        && value.startMs < value.endMs
        && value.endMs <= duration
        && boundedText(value.text, 1, MAX_SPEECH_TEXT_CHARACTERS);
}

function validSpeechIdentity(value) {
    return exactRecord(value, SPEECH_FIELDS)
        && (value.language === null || LANGUAGE.test(value.language))
        && Array.isArray(value.segments)
        && value.segments.length <= MAX_SEGMENTS;
}

function validSpeechSegments(segments, duration) {
    let previousEnd = 0;
    for (const segment of segments) {
        if (!validSegment(segment, duration, previousEnd)) {
            return false;
        }
        previousEnd = segment.endMs;
    }
    return true;
}

function validSpeech(value, source) {
    if (!validSpeechIdentity(value)) {
        return false;
    }
    if (["document", "image", "presentation"].includes(source.modality)) {
        return value.language === null && value.segments.length === 0;
    }
    return validSpeechSegments(value.segments, source.durationMs);
}

function validVisualTimestamp(timestamp, modality, previousTimestamp) {
    if (["document", "image", "presentation"].includes(modality)) {
        return timestamp === null;
    }
    return Number.isInteger(timestamp)
        && timestamp >= previousTimestamp
        && timestamp <= MAX_VIDEO_DURATION_MS;
}

function validSlideNumber(slide, modality) {
    if (modality !== "presentation") {
        return slide === null;
    }
    return Number.isInteger(slide)
        && slide >= 1
        && slide <= MAX_PRESENTATION_SLIDES;
}

function validPageNumber(page, modality) {
    if (modality !== "document") {
        return page === null;
    }
    return Number.isInteger(page) && page >= 1 && page <= MAX_PRESENTATION_SLIDES;
}

function validVisual(value, modality, previousTimestamp) {
    return exactRecord(value, VISUAL_FIELDS)
        && validVisualTimestamp(value.timestampMs, modality, previousTimestamp)
        && validSlideNumber(value.slideNumber, modality)
        && validPageNumber(value.pageNumber, modality)
        && boundedText(value.visibleText, 0, MAX_TEXT_CHARACTERS)
        && boundedText(value.description, 1, MAX_TEXT_CHARACTERS);
}

function validVisualCount(value, modality) {
    const bounds = {
        audio: [0, 0],
        document: [1, MAX_PRESENTATION_SLIDES],
        image: [1, 1],
        video: [1, MAX_VISUALS],
        presentation: [1, MAX_PRESENTATION_SLIDES],
    }[modality];
    return Array.isArray(value)
        && bounds !== undefined
        && value.length >= bounds[0]
        && value.length <= bounds[1];
}

function validVisualSequence(value, modality) {
    let previousTimestamp = 0;
    for (const visual of value) {
        if (!validVisual(visual, modality, previousTimestamp)) {
            return false;
        }
        previousTimestamp = visual.timestampMs || 0;
    }
    return true;
}

function validVisuals(value, source) {
    if (!validVisualCount(value, source.modality)
        || !validVisualSequence(value, source.modality)) {
        return false;
    }
    if (source.modality === "presentation") {
        return value.every((item, index) => item.slideNumber === index + 1);
    }
    return source.modality !== "document"
        || value.every((item, index) => item.pageNumber === index + 1);
}

function validResultIdentity(value, jobId) {
    return exactRecord(value, RESULT_FIELDS)
        && value.version === 1
        && value.requestId === jobId
        && REQUEST_ID.test(value.requestId)
        && IDENTIFIER.test(value.providerId)
        && ["gpu", "npu"].includes(value.accelerator);
}

function validResultContent(value, selected) {
    return validSourceResult(value.source, selected)
        && validSpeech(value.speech, value.source)
        && validVisuals(value.visuals, value.source);
}

function transcriptionResult(value, jobId, selected) {
    if (!validResultIdentity(value, jobId) || !validResultContent(value, selected)) {
        throw new MediaTranscriptionError(
            "result-invalid", "media transcription does not match version 1",
        );
    }
    return Object.freeze({
        version: 1,
        requestId: value.requestId,
        providerId: value.providerId,
        accelerator: value.accelerator,
        source: Object.freeze({...value.source}),
        speech: Object.freeze({
            language: value.speech.language,
            segments: Object.freeze(value.speech.segments.map((item) => Object.freeze({...item}))),
        }),
        visuals: Object.freeze(value.visuals.map((item) => Object.freeze({...item}))),
    });
}

function submission(requestId, source) {
    const document = {
        version: Job.JOB_VERSION,
        requestId,
        workloadId: PROFILE_ID,
        payload: {sources: [selectedSource([source]).path]},
    };
    if (!Job.isJobSubmission(document)) {
        throw new MediaTranscriptionError(
            "request-invalid", "media transcription submission is invalid",
        );
    }
    return document;
}

function timestampText(milliseconds) {
    const total = Math.max(0, Math.floor(milliseconds));
    const hours = Math.floor(total / 3_600_000);
    const minutes = Math.floor((total % 3_600_000) / 60_000);
    const seconds = Math.floor((total % 60_000) / 1000);
    const millis = total % 1000;
    return [hours, minutes, seconds].map((part) => String(part).padStart(2, "0")).join(":")
        + `.${String(millis).padStart(3, "0")}`;
}

function appendSpeechTranscript(lines, speech) {
    if (speech.segments.length === 0) {
        return;
    }
    lines.push(`Speech${speech.language ? ` (${speech.language})` : ""}:`);
    for (const segment of speech.segments) {
        lines.push(`[${timestampText(segment.startMs)}–${timestampText(segment.endMs)}] ${segment.text}`);
    }
}

function appendVisualTranscript(lines, visuals) {
    for (const visual of visuals) {
        const time = visual.pageNumber !== null
            ? `Page ${visual.pageNumber}`
            : visual.slideNumber !== null
            ? `Slide ${visual.slideNumber}`
            : visual.timestampMs === null
                ? "Image"
                : `Frame ${timestampText(visual.timestampMs)}`;
        lines.push(`${time}:`);
        if (visual.visibleText !== "") {
            lines.push(`Visible text: ${visual.visibleText}`);
        }
        lines.push(`Description: ${visual.description}`);
    }
}

function transcriptText(result) {
    if (!isRecord(result) || !isRecord(result.source) || !isRecord(result.speech)) {
        return "";
    }
    const lines = [`Media: ${result.source.fileName}`];
    appendSpeechTranscript(lines, result.speech);
    appendVisualTranscript(lines, Array.isArray(result.visuals) ? result.visuals : []);
    return lines.join("\n");
}

function initialState() {
    return {
        available: false,
        availabilityDetail: "Media transcription provider is not ready",
        phase: "idle",
        sources: [],
        jobId: "",
        message: "",
        progress: null,
        providerId: "",
        accelerator: "",
        result: null,
    };
}

function cloneState(state) {
    return {
        ...state,
        sources: state.sources.map((source) => ({...source})),
        progress: state.progress === null ? null : {...state.progress},
        result: state.result === null ? null : {
            ...state.result,
            source: {...state.result.source},
            speech: {
                ...state.result.speech,
                segments: state.result.speech.segments.map((item) => ({...item})),
            },
            visuals: state.result.visuals.map((item) => ({...item})),
        },
    };
}

class MediaTranscriptionController extends Workflow.RuntimeWorkflowController {
    constructor({picker, gateway, scheduler, clock = Date}) {
        const pickerPort = Workflow.requirePort(picker, ["chooseFiles"], "Media picker");
        super({
            clock,
            cloneState,
            gateway,
            initialState,
            labels: {
                clock: "Media clock",
                disposed: "Media transcription controller",
                failure: "Media transcription failed",
                gateway: "Media gateway",
                listener: "Media transcription listener",
                scheduler: "Media scheduler",
            },
            pollIntervalMs: POLL_INTERVAL_MS,
            scheduler,
        });
        this._picker = pickerPort;
    }

    chooseFiles() {
        this._ensureActive();
        if (!this._state.available
            || ["selecting", "submitting", "running", "cancelling"].includes(this._state.phase)) {
            return false;
        }
        const sequence = this._nextSequence();
        this._replace({phase: "selecting", message: "", result: null});
        try {
            this._picker.chooseFiles((error, sources) => this._selected(sequence, error, sources));
        } catch (error) {
            this._selected(sequence, error, null);
        }
        return true;
    }

    _selected(sequence, error, candidates) {
        if (!this._current(sequence)) {
            return false;
        }
        if (error) {
            return this._fail(String(error));
        }
        if (Array.isArray(candidates) && candidates.length === 0) {
            this._replace({phase: "idle", message: "Selection cancelled"});
            return true;
        }
        try {
            const source = selectedSource(candidates);
            this._replace({
                phase: "selected",
                sources: [source],
                message: "Media selected for local transcription",
            });
            return true;
        } catch (selectionError) {
            return this._fail(selectionError.detail || String(selectionError));
        }
    }

    start() {
        this._ensureActive();
        if (!this._state.available || this._state.phase !== "selected") {
            return false;
        }
        const sequence = this._nextSequence();
        let request;
        try {
            request = submission(
                `xpuwlm-media-${this._clock.now()}-${sequence}`,
                this._state.sources[0],
            );
        } catch (error) {
            return this._fail(error.detail || String(error), "selected");
        }
        this._replace({phase: "submitting", message: "Submitting selected media…", progress: null});
        try {
            this._gateway.submit(request, (error, reply) => this._accepted(sequence, error, reply));
        } catch (error) {
            this._accepted(sequence, error, null);
        }
        return true;
    }

    _accepted(sequence, error, acknowledgement) {
        if (!this._current(sequence)) {
            return false;
        }
        if (error) {
            return this._fail(String(error));
        }
        if (!acknowledgement || acknowledgement.status !== "accepted" || !acknowledgement.jobId) {
            return this._fail(acknowledgement?.message || "Runtime rejected media transcription");
        }
        this._polls = 0;
        this._replace({
            phase: "running",
            jobId: acknowledgement.jobId,
            message: acknowledgement.message,
            progress: {fraction: 0, detail: "Queued"},
        });
        this._schedulePoll(sequence);
        return true;
    }

    _poll(sequence) {
        if (!this._current(sequence) || this._state.phase !== "running") {
            return false;
        }
        this._polls += 1;
        if (this._polls > MAX_POLLS) {
            return this._fail("Runtime did not report a media transcription");
        }
        try {
            this._gateway.requestResult({
                requestId: `xpuwlm-media-poll-${this._clock.now()}-${this._polls}`,
                jobId: this._state.jobId,
            }, (error, result) => this._result(sequence, error, result));
        } catch (error) {
            this._result(sequence, error, null);
        }
        return true;
    }

    _result(sequence, error, result) {
        if (!this._current(sequence) || this._state.phase !== "running") {
            return false;
        }
        if (error) {
            this._schedulePoll(sequence);
            return false;
        }
        if (result.state === "running") {
            this._replace({progress: result.progress || this._state.progress, message: result.message});
            this._schedulePoll(sequence);
            return true;
        }
        return this._terminalResult(result);
    }

    _terminalResult(result) {
        if (result.state !== "succeeded") {
            return this._fail(result.message || `Media transcription ${result.state}`);
        }
        try {
            const output = transcriptionResult(result.output, result.jobId, this._state.sources[0]);
            this._replace({
                phase: "complete",
                progress: {fraction: 1, detail: "Transcription ready"},
                message: "Media transcription ready",
                providerId: output.providerId,
                accelerator: output.accelerator,
                result: output,
            });
            return true;
        } catch (parseError) {
            return this._fail(parseError.detail || String(parseError));
        }
    }

    cancel() {
        this._ensureActive();
        if (!["submitting", "running"].includes(this._state.phase)) {
            return false;
        }
        this._clearPoll();
        const sequence = this._nextSequence();
        const jobId = this._state.jobId;
        this._replace({phase: "cancelling", message: "Cancelling media transcription…"});
        if (jobId === "") {
            this._gateway.cancel();
            return this._cancelled(sequence, null);
        }
        try {
            this._gateway.cancelJob({
                requestId: `xpuwlm-media-cancel-${this._clock.now()}-${sequence}`,
                jobId,
            }, (error) => this._cancelled(sequence, error));
        } catch (error) {
            this._cancelled(sequence, error);
        }
        return true;
    }

    _cancelled(sequence, error) {
        if (!this._current(sequence)) {
            return false;
        }
        if (error) {
            return this._fail(String(error));
        }
        this._replace({
            phase: "selected", jobId: "", progress: null,
            message: "Media transcription cancelled",
        });
        return true;
    }

    reset() {
        return this._reset(["submitting", "running", "cancelling"]);
    }

    dispose() {
        return this._dispose();
    }
}

module.exports = {
    AUDIO_SUFFIXES,
    DOCUMENT_SUFFIXES,
    IMAGE_SUFFIXES,
    MAX_DURATION_MS,
    MAX_POLLS,
    MAX_PRESENTATION_SLIDES,
    MAX_SEGMENTS,
    MAX_SOURCE_BYTES,
    MAX_SPEECH_TEXT_CHARACTERS,
    MAX_TEXT_CHARACTERS,
    MAX_VIDEO_DURATION_MS,
    MAX_VISUALS,
    MediaTranscriptionController,
    MediaTranscriptionError,
    POLL_INTERVAL_MS,
    PRESENTATION_SUFFIXES,
    PROFILE_ID,
    SOURCE_SUFFIXES,
    VIDEO_SUFFIXES,
    boundedText,
    cloneState,
    exactRecord,
    initialState,
    modalityOf,
    selectedSource,
    submission,
    supportedSource,
    timestampText,
    transcriptText,
    transcriptionResult,
    validDuration,
    validSegment,
    validSourceResult,
    validSpeech,
    validSpeechIdentity,
    validSpeechSegments,
    validSourceIdentity,
    validSourceKind,
    validVisual,
    validVisualCount,
    validVisualTimestamp,
    validPageNumber,
    validSlideNumber,
    validVisualSequence,
    validVisuals,
};
