"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const I18n = require("../../files/cinnamon-tpuwm@geraldo-netto/lib/i18n.js");

test("identity fallback returns msgids and English plural selection", () => {
    I18n.reset();
    assert.equal(I18n._("Pause all"), "Pause all");
    assert.equal(I18n.N_("Marker"), "Marker");
    assert.equal(I18n.ngettext("%d item", "%d items", 1), "%d item");
    assert.equal(I18n.ngettext("%d item", "%d items", 0), "%d items");
    assert.equal(I18n.ngettext("%d item", "%d items", 2), "%d items");
    assert.equal(I18n.identityTranslate("x"), "x");
    assert.equal(I18n.identityTranslatePlural("a", "b", 1), "a");
    assert.equal(I18n.identityTranslatePlural("a", "b", 5), "b");
});

test("an installed translator serves lookups until reset restores identity", () => {
    try {
        const previous = I18n.install({
            translate: (msgid) => `<${msgid}>`,
            translatePlural: (singular, plural, count) => (count === 1 ? `1${singular}` : `n${plural}`),
        });
        assert.equal(previous, I18n.IDENTITY_TRANSLATOR);
        assert.equal(I18n._("Pause all"), "<Pause all>");
        assert.equal(I18n.ngettext("item", "items", 1), "1item");
        assert.equal(I18n.ngettext("item", "items", 3), "nitems");
        assert.equal(I18n.N_("Pause all"), "Pause all", "markers never translate");
    } finally {
        I18n.reset();
    }
    assert.equal(I18n._("Pause all"), "Pause all");
});

test("broken catalog answers fall back to the msgid instead of blanking the UI", () => {
    try {
        I18n.install({
            translate: () => "",
            translatePlural: () => null,
        });
        assert.equal(I18n._("Pause all"), "Pause all");
        assert.equal(I18n.ngettext("one", "many", 1), "one");
        assert.equal(I18n.ngettext("one", "many", 4), "many");
    } finally {
        I18n.reset();
    }
});

test("translator installation validates the port shape", () => {
    assert.throws(() => I18n.install(null), /translator/u);
    assert.throws(() => I18n.install({translate: () => ""}), /translator/u);
    assert.throws(() => I18n.install({translatePlural: () => ""}), /translator/u);
    assert.equal(I18n.requireTranslator(I18n.IDENTITY_TRANSLATOR), I18n.IDENTITY_TRANSLATOR);
    assert.equal(I18n._("still identity"), "still identity");
});

test("positional formatting substitutes %s and %d in order", () => {
    assert.equal(I18n.format("%s tab", "Overview"), "Overview tab");
    assert.equal(I18n.format("%d of %d available", 1, 3), "1 of 3 available");
    assert.equal(I18n.format("no placeholders"), "no placeholders");
    assert.equal(I18n.format("%s and %s", "left"), "left and %s", "missing values keep the token");
    assert.equal(I18n.format(42), "42");
});
