"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const Fixture = require("../helpers/presentation-review-fixture.js");
const Review = require("../../files/cinnamon-xpuwlm@geraldo-netto/lib/presentation-review.js");

test("PPTX, ODP, and PDF reviews retain source order and editability", () => {
    for (const [fileName, modality] of [
        ["deck.pptx", "presentation"], ["deck.odp", "presentation"], ["deck.pdf", "document"],
    ]) {
        const source = Fixture.transcription({fileName, modality, count: 3});
        const result = Review.reviewResult(Fixture.result(source), source);
        assert.deepEqual(result.slides.map((slide) => slide.number), [1, 2, 3]);
        assert.equal(result.sourceSha256, Fixture.DIGEST);
        assert.equal(result.slides.every((slide) => slide.editable), true);
    }
});
