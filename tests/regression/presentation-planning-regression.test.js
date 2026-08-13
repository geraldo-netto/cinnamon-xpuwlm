"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const Fixture = require("../helpers/presentation-planning-fixture.js");
const Planning = require("../../files/cinnamon-xpuwlm@geraldo-netto/lib/presentation-planning.js");

test("regression: no export request permits overwrite or unsupported formats", () => {
    const review = Fixture.reviewed();
    const deck = Planning.plannedDeck(Fixture.plan(review), review);
    for (const fault of [
        null,
        {requestId: "export", format: "pdf", destination: "/tmp/deck.pdf"},
        {requestId: "export", format: "pptx", destination: "/tmp/deck.odp"},
        {requestId: "Bad id!", format: "pptx", destination: "/tmp/deck.pptx"},
        {requestId: "export", format: "pptx", destination: "/tmp/deck.pptx", overwrite: true},
    ]) {
        assert.throws(() => Planning.exportActionRequest(deck, fault), /export request is invalid/u);
    }
    assert.throws(() => Planning.exportActionRequest({}, {
        requestId: "export", format: "pptx", destination: "/tmp/deck.pptx",
    }), /export request is invalid/u);
});
