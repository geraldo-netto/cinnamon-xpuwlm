"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const I18n = require("../../files/cinnamon-xpuwlm@geraldo-netto/lib/i18n.js");

function nextRandom(state) {
    return ((state * 1664525) + 1013904223) >>> 0;
}

test("property: identity plural selection picks the singular exactly at one", () => {
    let state = 0xBADD1CE;
    for (let round = 0; round < 500; round += 1) {
        state = nextRandom(state);
        const count = (state % 2001) - 1000;
        const selected = I18n.ngettext("one", "many", count);
        assert.equal(selected, count === 1 ? "one" : "many");
    }
});

test("property: formatting consumes placeholders in order and never throws", () => {
    let state = 0xF00D;
    const tokens = ["%s", "%d", "text", "·", ""];
    for (let round = 0; round < 300; round += 1) {
        state = nextRandom(state);
        const parts = [];
        for (let index = 0; index < state % 6; index += 1) {
            state = nextRandom(state);
            parts.push(tokens[state % tokens.length]);
        }
        const template = parts.join(" ");
        state = nextRandom(state);
        const values = Array.from({length: state % 4}, (unused, index) => index);
        const output = I18n.format(template, ...values);
        const placeholders = (template.match(/%[sd]/gu) || []).length;
        const remaining = (output.match(/%[sd]/gu) || []).length;
        assert.equal(remaining, Math.max(0, placeholders - values.length));
    }
});

test("property: a hostile translator can never blank a translated string", () => {
    const answers = [null, undefined, "", 0, false, {}, [], "ok"];
    let state = 0xACE;
    try {
        for (let round = 0; round < 200; round += 1) {
            state = nextRandom(state);
            const answer = answers[state % answers.length];
            I18n.install({
                translate: () => answer,
                translatePlural: () => answer,
            });
            const translated = I18n._("msgid");
            assert.equal(typeof translated === "string" && translated.length > 0, true);
            assert.equal(translated, answer === "ok" ? "ok" : "msgid");
            const plural = I18n.ngettext("one", "many", 2);
            assert.equal(plural, answer === "ok" ? "ok" : "many");
        }
    } finally {
        I18n.reset();
    }
});
