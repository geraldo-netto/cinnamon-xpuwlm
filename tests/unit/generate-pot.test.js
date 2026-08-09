"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const test = require("node:test");

const Pot = require("../../scripts/generate-pot.js");

test("po escaping protects quotes, backslashes, and control characters", () => {
    assert.equal(Pot.escapePo("plain text"), "plain text");
    assert.equal(Pot.escapePo("a \"quoted\" word"), "a \\\"quoted\\\" word");
    assert.equal(Pot.escapePo("back\\slash"), "back\\\\slash");
    assert.equal(Pot.escapePo("line\nbreak\ttab"), "line\\nbreak\\ttab");
});

test("message catalog deduplicates, merges references, and sorts entries", () => {
    const catalog = new Pot.MessageCatalog();
    assert.equal(catalog.add("Zulu", "b.json"), true);
    assert.equal(catalog.add("Alpha", "b.json"), true);
    assert.equal(catalog.add("Alpha", "a.json"), true);
    assert.equal(catalog.add("", "a.json"), false);
    assert.equal(catalog.add(42, "a.json"), false);
    assert.equal(catalog.add("Alpha", "c.js", "%d Alphas"), true);
    assert.deepEqual(catalog.entries(), [
        {msgid: "Alpha", msgidPlural: null, references: ["a.json", "b.json"]},
        {msgid: "Alpha", msgidPlural: "%d Alphas", references: ["c.js"]},
        {msgid: "Zulu", msgidPlural: null, references: ["b.json"]},
    ]);
    assert.equal(Pot.compareText("same", "same"), 0);
    assert.equal(Pot.compareText("a", "b") < 0, true);
    assert.equal(Pot.compareText("b", "a") > 0, true);
});

test("settings extraction harvests exactly the Cinnamon text keys", () => {
    const catalog = new Pot.MessageCatalog();
    Pot.collectSettingsStrings({
        "layout": {
            "type": "layout",
            "pages": ["page"],
            "page": {"type": "page", "title": "General", "sections": []},
        },
        "some-switch": {
            "type": "switch",
            "default": "untranslated-default",
            "description": "Switch it",
            "tooltip": "Helpful",
            "units": "seconds",
        },
        "some-combo": {
            "type": "combobox",
            "options": {"First choice": "first", "Second choice": "second"},
        },
        "generic-state": {"type": "generic", "default": {"profiles": {}}},
    }, "settings-schema.json", catalog);
    assert.deepEqual(catalog.entries().map((entry) => entry.msgid), [
        "First choice",
        "General",
        "Helpful",
        "Second choice",
        "Switch it",
        "seconds",
    ]);
});

test("metadata extraction harvests the name and description", () => {
    const catalog = new Pot.MessageCatalog();
    Pot.collectMetadataStrings({
        uuid: "x@y",
        name: "Applet name",
        description: "Applet description",
        version: "1.0.0",
    }, "metadata.json", catalog);
    assert.deepEqual(catalog.entries().map((entry) => entry.msgid), [
        "Applet description",
        "Applet name",
    ]);
});

test("pot formatting renders singular and plural entries deterministically", () => {
    const catalog = new Pot.MessageCatalog();
    catalog.add("One item", "lib/a.js", "%d items");
    catalog.add("Simple", "lib/b.js");
    const pot = Pot.buildPot(catalog);
    assert.equal(pot.startsWith("# Translation template"), true);
    assert.equal(pot.includes("\"Content-Type: text/plain; charset=UTF-8\\n\""), true);
    assert.equal(pot.includes([
        "#: lib/a.js",
        "msgid \"One item\"",
        "msgid_plural \"%d items\"",
        "msgstr[0] \"\"",
        "msgstr[1] \"\"",
    ].join("\n")), true);
    assert.equal(pot.includes([
        "#: lib/b.js",
        "msgid \"Simple\"",
        "msgstr \"\"",
    ].join("\n")), true);
    assert.equal(pot.endsWith("\"\n"), true);
    assert.equal(pot, Pot.buildPot(catalog), "generation must be deterministic");
});

test("the shipped translation template stays in lockstep with the sources", () => {
    const committed = fs.readFileSync(Pot.potPath, "utf8");
    assert.equal(
        committed,
        Pot.buildRepositoryPot(),
        "po template is stale; run: node scripts/generate-pot.js",
    );
});

test("every harvestable settings and metadata string is catalogued", () => {
    const catalog = Pot.buildRepositoryCatalog();
    const messages = new Set(catalog.entries().map((entry) => entry.msgid));
    for (const expected of [
        "General",
        "Runtime integration",
        "Panel",
        "Monitoring",
        "Workload runtime",
        "Safety boundary",
        "Show TPU status beside the panel icon",
        "Refresh interval",
        "seconds",
        "Runtime snapshot file",
        "TPU Workload Manager",
    ]) {
        assert.equal(messages.has(expected), true, `missing catalog string: ${expected}`);
    }
});
