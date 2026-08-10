"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const BuiltIns = require("../helpers/built-in-workloads.js");

// The service owns the catalog; the manifests bundled here are the fallback the
// popup renders whenever no runtime has published anything. A fallback that has
// drifted is worse than no fallback: it describes a profile the runtime would
// refuse, or hides one it would run, and nothing on either side notices. That
// is exactly how the bundled `visual-library` came to declare a TPU and no
// model long after the service had given it an ncnn model on the GPU, so the
// copies are pinned to each other instead of to a remembered snapshot of them.
const repositoryRoot = path.resolve(__dirname, "../..");

// The service repository is a sibling checkout, not a dependency: the gate runs
// wherever both are present and reports itself unavailable, never as passing,
// where only one is.
function serviceWorkloads() {
    const configured = process.env.TPUWM_OMNITENSOR_ROOT;
    const candidate = configured || path.resolve(repositoryRoot, "../omnitensor");
    const workloads = path.join(candidate, "workloads");
    return fs.existsSync(workloads) ? workloads : null;
}

function identifiers(root) {
    return fs.readdirSync(root, {withFileTypes: true})
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
        .sort();
}

function readManifest(root, identifier) {
    return JSON.parse(fs.readFileSync(path.join(root, identifier, "manifest.json"), "utf8"));
}

test("every bundled workload manifest matches the service's copy", (t) => {
    const service = serviceWorkloads();
    if (service === null) {
        t.skip(
            "the OmniTensor checkout is not available; "
            + "set TPUWM_OMNITENSOR_ROOT to run the cross-repository half of this gate",
        );
        return;
    }
    const bundled = identifiers(BuiltIns.ROOT);
    assert.notEqual(bundled.length, 0);
    for (const identifier of bundled) {
        assert.deepEqual(
            readManifest(BuiltIns.ROOT, identifier),
            readManifest(service, identifier),
            `the bundled ${identifier} manifest no longer describes what the service loads`,
        );
    }
});

test("the bundled catalog covers every workload the service ships", (t) => {
    const service = serviceWorkloads();
    if (service === null) {
        t.skip("the OmniTensor checkout is not available");
        return;
    }
    // A workload the service gained and the applet never bundled is invisible
    // until a runtime publishes state, which is the one moment the fallback
    // exists for.
    assert.deepEqual(identifiers(BuiltIns.ROOT), identifiers(service));
});
