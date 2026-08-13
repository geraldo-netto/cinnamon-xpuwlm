"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const Fixture = require("../helpers/screenshot-assistant-fixture.js");
const Assistant = require("../../files/cinnamon-xpuwlm@geraldo-netto/lib/screenshot-assistant.js");

test("regression: Unicode selections use code-point rather than byte offsets", () => {
    const result = Assistant.screenshotResult(
        Fixture.candidate(), Fixture.vision(), Fixture.source(),
    );
    assert.equal(result.visibleText, "Error 42 — שלום");
    assert.equal(result.transformations[0].selectedText, "שלום");
});

test("regression: assistant exports no UI or mutation capability", () => {
    assert.equal(Object.keys(Assistant).some((name) => (
        /activate|click|inject|execute|write|apply/iu.test(name)
    )), false);
});
