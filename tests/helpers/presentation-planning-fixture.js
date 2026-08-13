"use strict";

const Review = require("../../files/cinnamon-xpuwlm@geraldo-netto/lib/presentation-review.js");
const ReviewFixture = require("./presentation-review-fixture.js");

function reviewed() {
    const source = ReviewFixture.transcription();
    return Review.reviewResult(ReviewFixture.result(source), source);
}

function asset(id = "chart-1", sourceSha256 = "b".repeat(64)) {
    return {id, sourceSha256};
}

function slide(number, overrides = {}) {
    return {
        number,
        title: `Planned title ${number}`,
        body: `Planned body ${number}`,
        speakerNotes: `Planned notes ${number}`,
        accessibilityText: `Accessible plan ${number}`,
        citations: [{sourceSlide: number, evidenceIndex: 0}],
        assetRefs: [],
        ...overrides,
    };
}

function plan(review = reviewed(), overrides = {}) {
    return {
        version: 1,
        sourceSha256: review.sourceSha256,
        title: "Planned deck",
        slides: review.slides.map((_item, index) => slide(index + 1)),
        ...overrides,
    };
}

module.exports = {asset, plan, reviewed, slide};
