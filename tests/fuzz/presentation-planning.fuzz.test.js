"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const Fixture = require("../helpers/presentation-planning-fixture.js");
const Planning = require("../../files/cinnamon-xpuwlm@geraldo-netto/lib/presentation-planning.js");

test("property: citation indices match the cited review evidence bounds", () => {
    const review = Fixture.reviewed();
    for (let slide = 0; slide <= review.slides.length + 1; slide += 1) {
        for (let evidence = -1; evidence <= 2; evidence += 1) {
            const expected = slide >= 1 && slide <= review.slides.length && evidence === 0;
            assert.equal(Planning.validCitation({
                sourceSlide: slide, evidenceIndex: evidence,
            }, review), expected);
        }
    }
});

test("fuzz: hostile shallow values never escape planning validators", () => {
    const review = Fixture.reviewed();
    const assets = Planning.selectedAssets([]);
    const values = [null, undefined, true, false, 0, 1, "", [], {}, Symbol("x")];
    for (let index = 0; index < 1000; index += 1) {
        const value = values[index % values.length];
        assert.doesNotThrow(() => Planning.validAsset(value));
        assert.doesNotThrow(() => Planning.validCitation(value, review));
        assert.doesNotThrow(() => Planning.validCitations(value, review));
        assert.doesNotThrow(() => Planning.validAssetRefs(value, assets));
        assert.doesNotThrow(() => Planning.validDestination(value, "pptx"));
    }
});
