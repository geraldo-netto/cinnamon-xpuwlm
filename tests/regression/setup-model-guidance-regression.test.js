"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const ViewModel = require("../../files/cinnamon-xpuwlm@geraldo-netto/lib/view-model.js");

function blocked(id, reason) {
    return ViewModel.profileModel({
        id,
        title: id,
        status: "unavailable",
        detail: "localized detail",
        reason,
        executable: false,
    });
}

test("a profile with no model is never told to attach arbitrary weights", () => {
    const setup = ViewModel.setupModel([
        blocked("hardware-health", "no-model"),
        blocked("document-intelligence", "no-model"),
    ]);

    assert.deepEqual(setup.sections.map((section) => section.kind), ["model-design"]);
    assert.equal(setup.sections[0].command, "");
    assert.doesNotMatch(JSON.stringify(setup), /omnitensor-prepare-artifact/u);
});

test("resource scheduler keeps its supported local recipe separate", () => {
    const setup = ViewModel.setupModel([blocked("resource-scheduler", "no-model")]);

    assert.deepEqual(setup.sections.map((section) => section.kind), ["forecast"]);
    assert.match(setup.sections[0].command, /queueDepth/u);
    assert.match(setup.sections[0].command, /runningProfiles/u);
});
