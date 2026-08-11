"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const ViewModel = require("../../files/cinnamon-xpuwlm@geraldo-netto/lib/view-model.js");

test("regression: blocked profiles describe setup, not service availability", () => {
    const group = ViewModel.blockedGroupModel([{}, {}, {}, {}, {}, {}, {}, {}]);

    assert.equal(group.title, "Needs setup");
    assert.equal(group.label, "Needs setup (8)");
    assert.equal(group.collapsedName, "Needs setup, 8 profiles, collapsed");
    assert.equal(group.expandedName, "Needs setup, 8 profiles, expanded");
    assert.equal(JSON.stringify(group).includes("Not available"), false);
});
