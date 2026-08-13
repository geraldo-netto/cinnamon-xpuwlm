"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const Actions = require("../../files/cinnamon-xpuwlm@geraldo-netto/lib/deterministic-action-port.js");
const Fixture = require("../helpers/presentation-planning-fixture.js");
const Planning = require("../../files/cinnamon-xpuwlm@geraldo-netto/lib/presentation-planning.js");

test("selected assets are closed, unique, and source-digested", () => {
    const valid = Fixture.asset();
    assert.equal(Planning.validAsset(valid), true);
    assert.equal(Planning.selectedAssets([valid]).get("chart-1").sourceSha256, "b".repeat(64));
    for (const values of [
        null,
        [{...valid, extra: true}],
        [{...valid, id: "Bad id"}],
        [{...valid, sourceSha256: "bad"}],
        [valid, valid],
        Array.from({length: 65}, (_value, index) => Fixture.asset(`asset-${index}`)),
    ]) {
        assert.throws(() => Planning.selectedAssets(values), /assets are invalid/u);
    }
});

test("citations resolve to actual review evidence", () => {
    const review = Fixture.reviewed();
    assert.equal(Planning.validCitation({sourceSlide: 1, evidenceIndex: 0}, review), true);
    for (const value of [
        null,
        {sourceSlide: 0, evidenceIndex: 0},
        {sourceSlide: 1, evidenceIndex: -1},
        {sourceSlide: 1, evidenceIndex: 1},
        {sourceSlide: 1, evidenceIndex: 0, extra: true},
    ]) {
        assert.equal(Planning.validCitation(value, review), false);
    }
    assert.equal(Planning.validCitations([], review), false);
    assert.equal(Planning.validCitations(null, review), false);
});

test("planned slides remain ordered and selected-asset scoped", () => {
    const review = Fixture.reviewed();
    const assets = Planning.selectedAssets([Fixture.asset()]);
    assert.equal(Planning.validPlannedSlide(Fixture.slide(1, {assetRefs: ["chart-1"]}), 0,
        review, assets), true);
    for (const fault of [
        null,
        {...Fixture.slide(1), extra: true},
        {...Fixture.slide(1), number: 2},
        {...Fixture.slide(1), title: ""},
        {...Fixture.slide(1), accessibilityText: ""},
        {...Fixture.slide(1), citations: []},
        {...Fixture.slide(1), assetRefs: ["other"]},
        {...Fixture.slide(1), assetRefs: ["chart-1", "chart-1"]},
    ]) {
        assert.equal(Planning.validPlannedSlide(fault, 0, review, assets), false);
    }
});

test("deck intermediate is editable, bounded, and source-bound", () => {
    const review = Fixture.reviewed();
    const deck = Planning.plannedDeck(Fixture.plan(review, {
        slides: [Fixture.slide(1, {assetRefs: ["chart-1"]}), Fixture.slide(2)],
    }), review, [Fixture.asset()]);
    assert.equal(deck.editable, true);
    assert.equal(deck.slides.every((slide) => slide.editable), true);
    assert.equal(Object.isFrozen(deck.slides[0].citations[0]), true);
    assert.equal(deck.assets[0].id, "chart-1");
    for (const fault of [
        null,
        {...Fixture.plan(review), extra: true},
        {...Fixture.plan(review), sourceSha256: "b".repeat(64)},
        {...Fixture.plan(review), title: ""},
        {...Fixture.plan(review), slides: []},
    ]) {
        assert.throws(() => Planning.plannedDeck(fault, review), /plan is invalid/u);
    }
    assert.throws(() => Planning.plannedDeck(Fixture.plan(review), {}), /plan is invalid/u);
});

test("export destinations are absolute, traversal-free, and format-matched", () => {
    assert.equal(Planning.validDestination("/home/user/deck.pptx", "pptx"), true);
    assert.equal(Planning.validDestination("/home/user/deck.ODP", "odp"), true);
    const exact = `/${"a".repeat(16_378)}.pptx`;
    assert.equal(Planning.validDestination(exact, "pptx"), true);
    for (const [path, format] of [
        ["deck.pptx", "pptx"], ["/tmp/deck.odp", "pptx"],
        [`${exact}x`, "pptx"], ["/tmp/../deck.pptx", "pptx"], ["/tmp/..", "pptx"],
        ["/tmp/deck.txt", "txt"], ["/tmp/deck\0.pptx", "pptx"], [null, "pptx"],
    ]) {
        assert.equal(Planning.validDestination(path, format), false);
    }
});

test("export is a valid deterministic action request, never a direct write", () => {
    const review = Fixture.reviewed();
    const deck = Planning.plannedDeck(Fixture.plan(review), review);
    const request = Planning.exportActionRequest(deck, {
        requestId: "export-1", format: "pptx", destination: "/tmp/deck.pptx",
    });
    const definition = {
        id: "export-presentation", maxTargets: 1, maxEffects: 1,
        allowedEffects: ["create-file"], rollbackSupported: true,
        validate(parameters) {
            return parameters.version === 1 && parameters.overwrite === false;
        },
        port: {preview() {}, conflicts() {}, apply() {}, rollback() {}},
    };
    assert.doesNotThrow(() => Actions.ownedRequest(request, Actions.ownedDefinition(definition)));
    assert.equal(request.parameters.overwrite, false);
    for (const key of ["write", "save", "apply", "confirmed"]) {
        assert.equal(Object.hasOwn(request, key), false);
    }
});
