"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const EventImportErrors = require(
    "../../files/cinnamon-xpuwlm@geraldo-netto/lib/event-import-error.js"
);

test("event import errors expose the stable public refusal contract", () => {
    assert.deepEqual(Object.keys(EventImportErrors), ["EventImportError"]);
    const error = new EventImportErrors.EventImportError("source-invalid", "bad bytes");
    assert.equal(error instanceof Error, true);
    assert.equal(error.name, "EventImportError");
    assert.equal(error.code, "source-invalid");
    assert.equal(error.detail, "bad bytes");
    assert.equal(error.message, "source-invalid: bad bytes");
});
