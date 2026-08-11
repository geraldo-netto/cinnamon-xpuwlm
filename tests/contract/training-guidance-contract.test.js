"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const ViewModel = require("../../files/cinnamon-tpuwm@geraldo-netto/lib/view-model.js");

const repositoryRoot = path.resolve(__dirname, "../..");

function serviceRoot() {
    const configured = process.env.TPUWM_OMNITENSOR_ROOT;
    const candidate = configured || path.resolve(repositoryRoot, "../omnitensor");
    return fs.existsSync(path.join(candidate, "src/omnitensor/training/forecast.py"))
        ? candidate
        : null;
}

test("setup offers local training only for the profile the trainer supports", (t) => {
    const root = serviceRoot();
    if (root === null) {
        t.skip("the OmniTensor checkout is unavailable; set TPUWM_OMNITENSOR_ROOT");
        return;
    }
    const forecast = fs.readFileSync(
        path.join(root, "src/omnitensor/training/forecast.py"), "utf8",
    );
    const snapshot = fs.readFileSync(
        path.join(root, "src/omnitensor/training/snapshot_recording.py"), "utf8",
    );
    const project = fs.readFileSync(path.join(root, "pyproject.toml"), "utf8");

    assert.match(forecast, /SUPPORTED_PROFILES = frozenset\(\{"resource-scheduler"\}\)/u);
    assert.equal(ViewModel.LOCAL_FORECAST_PROFILE, "resource-scheduler");
    assert.match(snapshot, /"queueDepth"/u);
    assert.match(snapshot, /"runningProfiles"/u);
    for (const command of [
        "omnitensor-record-runtime-snapshot",
        "omnitensor-train-model",
        "omnitensor-install-trained-model",
        "omnitensor-run-forecast",
    ]) {
        assert.match(project, new RegExp(`^${command} = `, "mu"), command);
    }
});
