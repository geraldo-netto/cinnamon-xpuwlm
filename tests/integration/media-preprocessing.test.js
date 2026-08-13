"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const Fixture = require("../helpers/media-preprocessing-fixture.js");
const Media = require("../../files/cinnamon-xpuwlm@geraldo-netto/lib/media-preprocessing.js");
const Transcription = require("../../files/cinnamon-xpuwlm@geraldo-netto/lib/media-transcription.js");

test("media transcription and shared preprocessing use one source catalog", () => {
    assert.equal(Transcription.SOURCE_SUFFIXES, Media.SOURCE_SUFFIXES);
    assert.equal(Transcription.AUDIO_SUFFIXES, Media.AUDIO_SUFFIXES);
    assert.equal(Transcription.DOCUMENT_SUFFIXES, Media.DOCUMENT_SUFFIXES);
    assert.equal(Transcription.IMAGE_SUFFIXES, Media.IMAGE_SUFFIXES);
    assert.equal(Transcription.PRESENTATION_SUFFIXES, Media.PRESENTATION_SUFFIXES);
    assert.equal(Transcription.VIDEO_SUFFIXES, Media.VIDEO_SUFFIXES);
    assert.equal(Transcription.MAX_SOURCE_BYTES, Media.MAX_SOURCE_BYTES);
    assert.equal(Transcription.MAX_DURATION_MS, Media.MAX_DURATION_MS);
    assert.equal(Transcription.MAX_VIDEO_DURATION_MS, Media.MAX_VIDEO_DURATION_MS);
    for (const suffix of Media.SOURCE_SUFFIXES) {
        assert.equal(Transcription.modalityOf(`FILE${suffix.toUpperCase()}`), Media.mediaFamily(`file${suffix}`));
    }
});

test("every media family crosses the decoder port with its bounded plan", async () => {
    const families = [];
    for (const suffix of [".flac", ".pdf", ".tiff", ".jpeg", ".svg", ".odp", ".pptx", ".webm"]) {
        const selected = Fixture.source(suffix);
        const inspected = Fixture.probe(selected);
        const output = await Media.preprocessMedia({
            source: selected,
            adapter: {
                async inspect() { return inspected; },
                async decode(plan) {
                    families.push(plan.source.family);
                    return Fixture.decoded(plan, inspected);
                },
            },
            temporary: {async open() { return {}; }, async cleanup() {}},
            signal: {throwIfCancelled() {}},
            async consume(value) { return value; },
        });
        assert.equal(output.source.format, Media.sourceFormat(selected.path));
    }
    assert.deepEqual([...new Set(families)].sort(), ["audio", "document", "image", "presentation", "video"]);
});
