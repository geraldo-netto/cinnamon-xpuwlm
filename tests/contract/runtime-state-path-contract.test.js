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
// The default is only half the contract: an operator who moves the file has to
// name the new path on both sides, and the service side is an environment
// variable rather than a setting the applet can read.
const SERVICE_OVERRIDE = "OMNITENSOR_STATE_PATH";
const SERVICE_SNAPSHOT_SOURCE
    = /snapshot_path=_env_path\("(?<variable>[A-Z_]+)", DEFAULT_STATE_PATH\)/u;

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

test("the applet documents both names an operator has to change to move the file", () => {
    const documentation = readText(repositoryRoot, "docs/applet.md");
    assert.equal(
        documentation.includes(SERVICE_OVERRIDE),
        true,
        `docs/applet.md must name ${SERVICE_OVERRIDE}, the only way to move the service side`,
    );
    assert.equal(
        documentation.includes("runtime-state-path"),
        true,
        "docs/applet.md must name the applet setting that has to match it",
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
    const text = fs.readFileSync(source, "utf8");
    const match = SERVICE_DEFAULT.exec(text);
    assert.notEqual(match, null, `${source} no longer declares DEFAULT_STATE_PATH`);
    assert.equal(
        match.groups.path,
        SHARED_SNAPSHOT_PATH,
        "the applet and the runtime service disagree on the snapshot path",
    );
    const override = SERVICE_SNAPSHOT_SOURCE.exec(text);
    assert.notEqual(
        override,
        null,
        `${source} no longer reads the snapshot path from the environment`,
    );
    assert.equal(
        override.groups.variable,
        SERVICE_OVERRIDE,
        "the documented override no longer names the variable the service reads",
    );
});
