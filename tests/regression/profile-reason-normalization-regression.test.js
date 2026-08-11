"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const Domain = require("../../files/cinnamon-tpuwm@geraldo-netto/lib/domain.js");
const BuiltIns = require("../helpers/built-in-workloads.js");
const ViewModel = require("../../files/cinnamon-tpuwm@geraldo-netto/lib/view-model.js");

test("a machine-readable blocker reason is not dropped before the view model", () => {
    const profiles = new Domain.WorkloadPortfolio(null, BuiltIns.coreCatalog()).list({
        "resource-scheduler": {
            status: "unavailable",
            queued: 0,
            detail: "completely translated detail",
            reason: "no-model",
        },
    });
    const projected = ViewModel.profileModel(
        profiles.find((profile) => profile.id === "resource-scheduler"),
    );

    assert.equal(projected.reason, "no-model");
    assert.equal(projected.blocker.kind, "model");
    assert.equal(projected.blocker.detail, "completely translated detail");
});
