"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const Domain = require("../../files/cinnamon-xpuwlm@geraldo-netto/lib/domain.js");
const BuiltIns = require("../helpers/built-in-workloads.js");

test("regression: runtime labels stay well-formed at their code-point boundary", () => {
    const title = `${"a".repeat(159)}💡truncated`;
    const alert = Domain.normalizeAlert({
        id: "unicode-boundary",
        profileId: "hardware-health",
        title,
    }, 1_700_000_000_000, BuiltIns.coreCatalog());

    assert.ok(alert);
    assert.equal(Array.from(alert.title).length, 160);
    assert.equal(alert.title.endsWith("💡"), true);
    assert.equal(alert.title.includes("\ufffd"), false);
    assert.equal(Domain.safeText("broken-\udfff-label", 20), "broken-\ufffd-label");
});
