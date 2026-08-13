"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const Fixture = require("../helpers/caption-export-fixture.js");
const Captions = require("../../files/cinnamon-xpuwlm@geraldo-netto/lib/caption-export.js");

test("regression: multilingual captions survive rendering byte-for-byte", () => {
    const source = Fixture.transcription("audio");
    source.speech.segments[0].text = "English — שלום — Привет — 日本語";
    const document = Captions.captionDocument(source);
    assert.match(Captions.renderTrack(document, "vtt", "speech"), /English — שלום — Привет — 日本語/u);
});

test("regression: export contract exposes no lossy transcode or direct writer", () => {
    const request = Captions.exportCaptionAction(
        Captions.captionDocument(Fixture.transcription()), Fixture.exportRequest(),
    );
    assert.equal(Object.hasOwn(request.parameters, "codec"), false);
    assert.equal(Object.hasOwn(request.parameters, "transcode"), false);
    assert.equal(Object.keys(Captions).some((name) => /write|ffmpeg|execute/iu.test(name)), false);
});
