"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const Fixture = require("../helpers/presentation-planning-fixture.js");
const Planning = require("../../files/cinnamon-xpuwlm@geraldo-netto/lib/presentation-planning.js");

test("review citations and selected assets survive into PPTX and ODP action requests", () => {
    const review = Fixture.reviewed();
    const deck = Planning.plannedDeck(Fixture.plan(review, {
        slides: [Fixture.slide(1, {assetRefs: ["chart-1"]}), Fixture.slide(2)],
    }), review, [Fixture.asset()]);
    for (const format of ["pptx", "odp"]) {
        const request = Planning.exportActionRequest(deck, {
            requestId: `export-${format}`, format, destination: `/tmp/deck.${format}`,
        });
        assert.equal(request.parameters.deck.slides[0].citations[0].sourceSlide, 1);
        assert.equal(request.parameters.deck.slides[0].assetRefs[0], "chart-1");
        assert.equal(request.parameters.format, format);
    }
});
