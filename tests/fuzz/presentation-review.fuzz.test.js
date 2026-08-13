"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const Fixture = require("../helpers/presentation-review-fixture.js");
const Review = require("../../files/cinnamon-xpuwlm@geraldo-netto/lib/presentation-review.js");

test("property: only exact non-empty evidence spans are admitted", () => {
    const slide = Review.sourceSlides(Fixture.transcription())[0];
    const length = [...slide.visibleText].length;
    for (let start = -1; start <= length; start += 1) {
        for (let end = 0; end <= length + 1; end += 1) {
            const valid = start >= 0 && end > start && end <= length;
            assert.equal(Review.validEvidence({source: "visible-text", start, end}, slide), valid);
        }
    }
});

test("fuzz: hostile shallow values never escape review validators", () => {
    const slide = Review.sourceSlides(Fixture.transcription())[0];
    const values = [null, undefined, true, false, 0, 1, "", [], {}, Symbol("x")];
    for (let index = 0; index < 1000; index += 1) {
        const value = values[index % values.length];
        assert.doesNotThrow(() => Review.validSource(value));
        assert.doesNotThrow(() => Review.validStringList(value));
        assert.doesNotThrow(() => Review.validEvidence(value, slide));
        assert.doesNotThrow(() => Review.validReview(value, slide));
    }
});
