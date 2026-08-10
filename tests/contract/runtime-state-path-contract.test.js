"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

// The applet and the runtime service meet at exactly one file. Neither side
// derives the path from the other, so the only thing keeping them together was
// prose in a README: a rename on either side leaves the applet reading a file
// nobody writes, reported to the user as "no runtime service is publishing
// state" rather than as the configuration mistake it is.
const SHARED_SNAPSHOT_PATH = "~/.local/state/tpu-workload-manager/state.json";
const SERVICE_DEFAULT = /^DEFAULT_STATE_PATH = "(?<path>[^"]+)"$/mu;

const repositoryRoot = path.resolve(__dirname, "../..");
const appletRoot = path.join(repositoryRoot, "files/cinnamon-tpuwm@geraldo-netto");

function readText(...segments) {
    return fs.readFileSync(path.join(...segments), "utf8");
}

// The service repository is a sibling checkout, not a dependency: the
// cross-repository half of the gate runs wherever both are present and is
// reported as unavailable, never as passing, where only one is.
function serviceSourcePath() {
    const configured = process.env.TPUWM_OMNITENSOR_ROOT;
    const roots = configured
        ? [configured]
        : [path.resolve(repositoryRoot, "../omnitensor")];
    for (const root of roots) {
        const candidate = path.join(root, "src/omnitensor/service.py");
        if (fs.existsSync(candidate)) {
            return candidate;
        }
    }
    return null;
}

test("the applet defaults to the agreed runtime snapshot path", () => {
    const settings = JSON.parse(readText(appletRoot, "settings-schema.json"));
    assert.equal(settings["runtime-state-path"].default, SHARED_SNAPSHOT_PATH);
    assert.equal(
        readText(repositoryRoot, "docs/applet.md").includes(SHARED_SNAPSHOT_PATH.slice(2)),
        true,
        "the documented path must match the shipped default",
    );
});

test("the runtime service default matches the applet default", (t) => {
    const source = serviceSourcePath();
    if (source === null) {
        t.skip(
            "the OmniTensor checkout is not available; "
            + "set TPUWM_OMNITENSOR_ROOT to run the cross-repository half of this gate",
        );
        return;
    }
    const match = SERVICE_DEFAULT.exec(fs.readFileSync(source, "utf8"));
    assert.notEqual(match, null, `${source} no longer declares DEFAULT_STATE_PATH`);
    assert.equal(
        match.groups.path,
        SHARED_SNAPSHOT_PATH,
        "the applet and the runtime service disagree on the snapshot path",
    );
});
