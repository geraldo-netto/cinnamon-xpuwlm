"use strict";

// Rehearsal analysis joins a validated recording to an independently reviewed
// deck. Model prose may cite bounded evidence, but cannot create tasks/events.

const Media = require("./media-transcription.js");
const Validation = require("./validation.js");

const VERSION = 1;
const MAX_TEXT = 16_384;
const MAX_ITEMS = 128;
const SOURCE_FIELDS = Object.freeze(["fileName", "sourceSha256", "modality", "durationMs"]);
const CHANGE_FIELDS = Object.freeze(["timestampMs", "slideNumber"]);
const EVIDENCE_FIELDS = Object.freeze(["transcriptIndices", "frameIndices"]);
const ITEM_FIELDS = Object.freeze(["text", "evidence"]);
const TASK_FIELDS = Object.freeze(["text", "assigneeSuggestion", "evidence"]);
const EVENT_FIELDS = Object.freeze(["title", "startMs", "endMs", "evidence"]);
const CANDIDATE_FIELDS = Object.freeze([
    "version", "sourceSha256", "summary", "decisions", "proposedTasks", "questions",
    "proposedEvents",
]);
const {DIGEST} = Validation;

class RehearsalBriefingError extends Error {
    constructor(code, detail) {
        super(detail);
        this.name = "RehearsalBriefingError";
        this.code = code;
    }
}

const isRecord = Validation.isRecord;
const exactKeys = Validation.exactKeys;

function boundedText(value, minimum = 1) {
    return typeof value === "string" && !value.includes("\0")
        && Validation.boundedText(value, minimum, MAX_TEXT);
}

function validRecordingSource(value) {
    return exactKeys(value, SOURCE_FIELDS) && value.modality === "video"
        && DIGEST.test(value.sourceSha256) && Number.isInteger(value.durationMs)
        && value.durationMs > 0 && value.durationMs <= Media.MAX_VIDEO_DURATION_MS;
}

function validRecording(value) {
    return isRecord(value) && validRecordingSource(value.source)
        && Media.validSpeech(value.speech, value.source)
        && Media.validVisuals(value.visuals, value.source);
}

function validDeck(value) {
    return isRecord(value) && value.version === 1 && value.editable === true
        && DIGEST.test(value.sourceSha256) && Array.isArray(value.slides)
        && value.slides.length >= 1 && value.slides.length <= Media.MAX_PRESENTATION_SLIDES
        && value.slides.every((slide, index) => (
            isRecord(slide) && slide.number === index + 1 && slide.editable === true
        ));
}

function validSlideChanges(changes, durationMs, slideCount) {
    if (!Array.isArray(changes) || changes.length < 1 || changes.length > MAX_ITEMS) {
        return false;
    }
    let previous = -1;
    let previousSlide = 0;
    return changes.every((change, index) => {
        const valid = validSlideChange(
            change, index, previous, previousSlide, durationMs, slideCount,
        );
        if (isRecord(change)) {
            previous = change.timestampMs;
            previousSlide = change.slideNumber;
        }
        return valid;
    });
}

function validSlideChange(change, index, previous, previousSlide, durationMs, slideCount) {
    if (!exactKeys(change, CHANGE_FIELDS) || !Number.isInteger(change.timestampMs)
        || !Number.isInteger(change.slideNumber)) {
        return false;
    }
    return validChangeTime(change.timestampMs, index, previous, durationMs)
        && validChangedSlide(change.slideNumber, previousSlide, slideCount);
}

function validChangeTime(timestampMs, index, previous, durationMs) {
    return timestampMs > previous && timestampMs < durationMs
        && (index !== 0 || timestampMs === 0);
}

function validChangedSlide(slideNumber, previousSlide, slideCount) {
    return slideNumber >= 1 && slideNumber <= slideCount && slideNumber !== previousSlide;
}

function slideAt(timestampMs, changes) {
    let slideNumber = changes[0].slideNumber;
    for (const change of changes) {
        if (change.timestampMs > timestampMs) {
            break;
        }
        slideNumber = change.slideNumber;
    }
    return slideNumber;
}

function alignedTranscript(recording, changes) {
    return Object.freeze(recording.speech.segments.map((segment) => Object.freeze({
        startMs: segment.startMs,
        endMs: segment.endMs,
        text: segment.text,
        slideNumber: slideAt(segment.startMs, changes),
    })));
}

function alignedFrames(recording, changes) {
    return Object.freeze(recording.visuals.map((frame) => Object.freeze({
        timestampMs: frame.timestampMs,
        slideNumber: slideAt(frame.timestampMs, changes),
        visibleText: frame.visibleText,
        description: frame.description,
    })));
}

function timing(changes, durationMs) {
    return Object.freeze(changes.map((change, index) => {
        const endMs = changes[index + 1]?.timestampMs ?? durationMs;
        return Object.freeze({
            slideNumber: change.slideNumber,
            startMs: change.timestampMs,
            endMs,
            durationMs: endMs - change.timestampMs,
        });
    }));
}

function validIndices(value, length) {
    return Array.isArray(value) && value.length <= MAX_ITEMS
        && value.every((index, offset) => (
            Number.isInteger(index) && index >= 0 && index < length
            && (offset === 0 || index > value[offset - 1])
        ));
}

function validEvidence(value, transcriptCount, frameCount) {
    return exactKeys(value, EVIDENCE_FIELDS)
        && validIndices(value.transcriptIndices, transcriptCount)
        && validIndices(value.frameIndices, frameCount)
        && value.transcriptIndices.length + value.frameIndices.length > 0;
}

function validItem(value, fields, transcriptCount, frameCount) {
    return exactKeys(value, fields) && boundedText(value.text)
        && validEvidence(value.evidence, transcriptCount, frameCount);
}

function validItems(value, fields, transcriptCount, frameCount) {
    return Array.isArray(value) && value.length <= MAX_ITEMS
        && value.every((item) => validItem(item, fields, transcriptCount, frameCount));
}

function validTasks(value, transcriptCount, frameCount) {
    return validItems(value, TASK_FIELDS, transcriptCount, frameCount)
        && value.every((task) => (
            task.assigneeSuggestion === null || boundedText(task.assigneeSuggestion)
        ));
}

function validEvents(value, transcriptCount, frameCount, durationMs) {
    return Array.isArray(value) && value.length <= MAX_ITEMS && value.every((event) => (
        exactKeys(event, EVENT_FIELDS) && boundedText(event.title)
        && Number.isInteger(event.startMs) && Number.isInteger(event.endMs)
        && event.startMs >= 0 && event.startMs < event.endMs && event.endMs <= durationMs
        && validEvidence(event.evidence, transcriptCount, frameCount)
    ));
}

function validateCandidate(value, recording, transcript, frames) {
    return exactKeys(value, CANDIDATE_FIELDS) && value.version === VERSION
        && value.sourceSha256 === recording.source.sourceSha256
        && validItem(value.summary, ITEM_FIELDS, transcript.length, frames.length)
        && validItems(value.decisions, ITEM_FIELDS, transcript.length, frames.length)
        && validTasks(value.proposedTasks, transcript.length, frames.length)
        && validItems(value.questions, ITEM_FIELDS, transcript.length, frames.length)
        && validEvents(
            value.proposedEvents, transcript.length, frames.length, recording.source.durationMs,
        );
}

function freezeEvidence(value) {
    return Object.freeze({
        transcriptIndices: Object.freeze([...value.transcriptIndices]),
        frameIndices: Object.freeze([...value.frameIndices]),
    });
}

function freezeItem(value, extra = {}) {
    return Object.freeze({...value, evidence: freezeEvidence(value.evidence), ...extra});
}

function validSources(recording, deck, slideChanges) {
    return validRecording(recording) && validDeck(deck)
        && validSlideChanges(slideChanges, recording.source.durationMs, deck.slides.length);
}

function rehearsalBriefing(value, recording, deck, slideChanges) {
    if (!validSources(recording, deck, slideChanges)) {
        throw new RehearsalBriefingError("source-invalid", "recording, deck, or slide changes are invalid");
    }
    const transcript = alignedTranscript(recording, slideChanges);
    const frames = alignedFrames(recording, slideChanges);
    if (!validateCandidate(value, recording, transcript, frames)) {
        throw new RehearsalBriefingError("result-invalid", "briefing evidence is invalid");
    }
    return Object.freeze({
        version: VERSION,
        sourceSha256: value.sourceSha256,
        summary: freezeItem(value.summary),
        decisions: Object.freeze(value.decisions.map((item) => freezeItem(item))),
        proposedTasks: Object.freeze(value.proposedTasks.map((item) => (
            freezeItem(item, {status: "proposed"})
        ))),
        questions: Object.freeze(value.questions.map((item) => freezeItem(item))),
        proposedEvents: Object.freeze(value.proposedEvents.map((item) => (
            freezeItem(item, {status: "proposed"})
        ))),
        transcript,
        frames,
        timing: timing(slideChanges, recording.source.durationMs),
        reviewOnly: true,
    });
}

module.exports = {
    MAX_ITEMS,
    MAX_TEXT,
    VERSION,
    RehearsalBriefingError,
    alignedFrames,
    alignedTranscript,
    boundedText,
    exactKeys,
    freezeEvidence,
    freezeItem,
    rehearsalBriefing,
    slideAt,
    timing,
    validDeck,
    validChangeTime,
    validChangedSlide,
    validEvidence,
    validEvents,
    validIndices,
    validItem,
    validItems,
    validRecording,
    validRecordingSource,
    validSlideChange,
    validSlideChanges,
    validSources,
    validTasks,
    validateCandidate,
};
