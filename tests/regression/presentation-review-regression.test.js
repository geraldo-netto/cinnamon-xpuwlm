"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const Fixture = require("../helpers/presentation-review-fixture.js");
const Review = require("../../files/cinnamon-xpuwlm@geraldo-netto/lib/presentation-review.js");

test("regression: reviews cannot drift to another source or slide", () => {
    const source = Fixture.transcription();
    const valid = Fixture.result(source);
    for (const fault of [
        null,
        {...valid, extra: true},
        {...valid, sourceSha256: "b".repeat(64)},
        {...valid, slides: valid.slides.slice(1)},
        {...valid, slides: [valid.slides[1], valid.slides[0]]},
    ]) {
        assert.throws(() => Review.reviewResult(fault, source), /review is invalid/u);
    }
});
