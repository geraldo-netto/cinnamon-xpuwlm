"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const Fixture = require("../helpers/presentation-review-fixture.js");
const Review = require("../../files/cinnamon-xpuwlm@geraldo-netto/lib/presentation-review.js");

test("PPTX, ODP, and PDF are the complete selected-source set", () => {
    assert.deepEqual(Review.SUPPORTED_SUFFIXES, [".odp", ".pdf", ".pptx"]);
    for (const [fileName, modality] of [
        ["deck.pptx", "presentation"], ["deck.ODP", "presentation"], ["deck.pdf", "document"],
    ]) {
        assert.equal(Review.validSource(Fixture.transcription({fileName, modality}).source), true);
    }
    for (const changes of [
        {fileName: "deck.key", modality: "presentation"},
        {fileName: "deck.pdf", modality: "image"},
    ]) {
        assert.equal(Review.validSource(Fixture.transcription(changes).source), false);
    }
    assert.equal(Review.validSource(null), false);
    assert.equal(Review.suffixOf("DECK.PPTX"), ".pptx");
    assert.equal(Review.suffixOf("README"), "");
    assert.equal(Review.suffixOf(null), "");
});

test("source evidence preserves every slide and page in order", () => {
    for (const source of [Fixture.transcription(), Fixture.transcription({
        fileName: "deck.pdf", modality: "document",
    })]) {
        assert.deepEqual(Review.sourceSlides(source).map((slide) => slide.number), [1, 2]);
    }
    const source = Fixture.transcription();
    for (const fault of [
        null,
        {...source, visuals: []},
        {...source, visuals: [{...source.visuals[0], slideNumber: 2}]},
        {...source, visuals: [{...source.visuals[0], description: ""}]},
        {...source, source: {...source.source, sourceSha256: "bad"}},
    ]) {
        assert.throws(() => Review.sourceSlides(fault), /source is invalid|evidence is invalid/u);
    }
});

test("review lists are bounded non-empty prose", () => {
    assert.equal(Review.validStringList([]), true);
    assert.equal(Review.validStringList(["One"]), true);
    assert.equal(Review.validStringList(null), false);
    assert.equal(Review.validStringList([""]), false);
    assert.equal(Review.validStringList(Array(17).fill("x")), false);
});

test("evidence cites a non-empty visible-text or description span", () => {
    const slide = Review.sourceSlides(Fixture.transcription())[0];
    assert.equal(Review.validEvidence({source: "visible-text", start: 0, end: 5}, slide), true);
    assert.equal(Review.validEvidence({source: "visual-description", start: 0, end: 5}, slide), true);
    for (const fault of [
        null,
        {source: "notes", start: 0, end: 1},
        {source: "visible-text", start: -1, end: 1},
        {source: "visible-text", start: 1, end: 1},
        {source: "visible-text", start: 0, end: 100},
        {source: "visible-text", start: 0, end: 1, extra: true},
    ]) {
        assert.equal(Review.validEvidence(fault, slide), false);
    }
});

test("slide reviews are exact, ordered, and accessibility-complete", () => {
    const slide = Review.sourceSlides(Fixture.transcription())[0];
    const valid = Fixture.slide(1);
    assert.equal(Review.validReview(valid, slide), true);
    for (const fault of [
        null,
        {...valid, extra: true},
        {...valid, number: 2},
        {...valid, accessibilityText: ""},
        {...valid, observations: [""]},
        {...valid, evidence: []},
    ]) {
        assert.equal(Review.validReview(fault, slide), false);
    }
});

test("validated review stays editable without a writer", () => {
    const source = Fixture.transcription();
    const result = Review.reviewResult(Fixture.result(source), source);
    assert.equal(result.editable, true);
    assert.equal(result.slides.every((slide) => slide.editable), true);
    assert.equal(Object.isFrozen(result.slides[0].evidence[0]), true);
    for (const key of ["write", "export", "save", "apply"]) {
        assert.equal(Object.hasOwn(result, key), false);
    }
});
