"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const Fixture = require("../helpers/workflow-validation-boundaries-fixture.js");
const Captions = require(
    "../../files/cinnamon-xpuwlm@geraldo-netto/lib/caption-export.js"
);
const Media = require(
    "../../files/cinnamon-xpuwlm@geraldo-netto/lib/media-transcription.js"
);
const Preprocessing = require(
    "../../files/cinnamon-xpuwlm@geraldo-netto/lib/media-preprocessing.js"
);
const Screenshot = require(
    "../../files/cinnamon-xpuwlm@geraldo-netto/lib/screenshot-assistant.js"
);
const ScreenshotFixture = require("../helpers/screenshot-assistant-fixture.js");

test("regression: media duration accepts both exact documented bounds", () => {
    assert.equal(Media.MAX_DURATION_MS, Fixture.MAX_MEDIA_DURATION_MS);
    assert.equal(Media.MAX_VIDEO_DURATION_MS, Fixture.MAX_VIDEO_DURATION_MS);
    for (const boundary of Fixture.DURATION_CASES) {
        assert.equal(
            Media.validDuration(boundary.value, boundary.modality),
            boundary.accepted,
            `${boundary.modality}:${boundary.value}`,
        );
    }
});

test("regression: caption cue count accepts 2,048 and refuses 2,049", () => {
    assert.equal(Media.MAX_SEGMENTS, Fixture.MAX_CUES);
    assert.equal(
        Captions.validCueSequence(Fixture.cues(Fixture.MAX_CUES), Fixture.MAX_CUES),
        true,
    );
    assert.equal(
        Captions.validCueSequence(Fixture.cues(Fixture.MAX_CUES + 1), Fixture.MAX_CUES + 1),
        false,
    );
});

test("regression: screenshot bytes accept both exact documented bounds", () => {
    assert.equal(Preprocessing.MAX_SOURCE_BYTES, Fixture.MAX_SCREENSHOT_BYTES);
    for (const boundary of Fixture.SCREENSHOT_SIZE_CASES) {
        assert.equal(
            Screenshot.imageFile({...ScreenshotFixture.source(), size: boundary.value}),
            boundary.accepted,
            `size:${boundary.value}`,
        );
    }
});

test("regression: capture start accepts epoch zero and safe-integer maximum", () => {
    for (const boundary of Fixture.CAPTURE_START_CASES) {
        assert.equal(Screenshot.validCaptureTime({
            ...ScreenshotFixture.source(boundary.kind),
            captureStartedMs: boundary.value,
        }), boundary.accepted, `${boundary.kind}:${boundary.value}`);
    }
});
