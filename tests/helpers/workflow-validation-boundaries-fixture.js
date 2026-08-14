"use strict";

const MAX_CAPTURE_STARTED_MS = Number.MAX_SAFE_INTEGER;
const MAX_CUES = 2048;
const MAX_MEDIA_DURATION_MS = 600_000;
const MAX_SCREENSHOT_BYTES = 134_217_728;
const MAX_VIDEO_DURATION_MS = 300_000;

const DURATION_CASES = Object.freeze([
    Object.freeze({accepted: false, modality: "audio", value: 0}),
    Object.freeze({accepted: true, modality: "audio", value: 1}),
    Object.freeze({accepted: true, modality: "audio", value: MAX_MEDIA_DURATION_MS}),
    Object.freeze({accepted: false, modality: "audio", value: MAX_MEDIA_DURATION_MS + 1}),
    Object.freeze({accepted: true, modality: "video", value: MAX_VIDEO_DURATION_MS}),
    Object.freeze({accepted: false, modality: "video", value: MAX_VIDEO_DURATION_MS + 1}),
    Object.freeze({accepted: true, modality: "image", value: null}),
    Object.freeze({accepted: false, modality: "image", value: 1}),
]);

const SCREENSHOT_SIZE_CASES = Object.freeze([
    Object.freeze({accepted: false, value: 0}),
    Object.freeze({accepted: true, value: 1}),
    Object.freeze({accepted: true, value: MAX_SCREENSHOT_BYTES}),
    Object.freeze({accepted: false, value: MAX_SCREENSHOT_BYTES + 1}),
]);

const CAPTURE_START_CASES = Object.freeze([
    Object.freeze({accepted: false, kind: "screenshot", value: -1}),
    Object.freeze({accepted: true, kind: "screenshot", value: 0}),
    Object.freeze({accepted: true, kind: "screenshot", value: MAX_CAPTURE_STARTED_MS}),
    Object.freeze({accepted: false, kind: "screenshot", value: MAX_CAPTURE_STARTED_MS + 1}),
    Object.freeze({accepted: true, kind: "file", value: null}),
    Object.freeze({accepted: false, kind: "file", value: 0}),
]);

function cues(count) {
    return Array.from({length: count}, (_value, index) => ({
        startMs: index,
        endMs: index + 1,
        text: "cue",
    }));
}

function overlappingCues() {
    return [
        {startMs: 0, endMs: 2, text: "first"},
        {startMs: 1, endMs: 3, text: "overlap"},
    ];
}

module.exports = {
    CAPTURE_START_CASES,
    DURATION_CASES,
    MAX_CAPTURE_STARTED_MS,
    MAX_CUES,
    MAX_MEDIA_DURATION_MS,
    MAX_SCREENSHOT_BYTES,
    MAX_VIDEO_DURATION_MS,
    SCREENSHOT_SIZE_CASES,
    cues,
    overlappingCues,
};
