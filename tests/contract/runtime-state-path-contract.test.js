"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const {omnitensorRepository} = require("../helpers/sibling-repository.js");

// The applet and the runtime service meet at exactly one file. Neither side
// derives the path from the other, so the only thing keeping them together was
// prose in a README: a rename on either side leaves the applet reading a file
// nobody writes, reported to the user as "no runtime service is publishing
// state" rather than as the configuration mistake it is.
const SHARED_SNAPSHOT_PATH = "~/.local/state/xpu-workload-manager/state.json";
// Resolved by name rather than matched by spelling. This gate used to pin one
// syntactic form — `DEFAULT_STATE_PATH = "<path>"` — and went red the day the
// service moved the literal into `paths.py` and left an alias behind, a rename
// that changed nothing about the agreement. What has to hold is the *value*,
// so a literal is read as a literal and a one-hop alias to a sibling module's
// literal is followed. Only one hop: a chain of aliases is a place the value
// could be recomputed, and this gate would rather say so than guess.
const SERVICE_CONSTANT = "DEFAULT_STATE_PATH";
const SERVICE_SOURCE = "src/omnitensor/composition.py";
// The default is only half the contract: an operator who moves the file has to
// name the new path on both sides, and the service side is an environment
// variable rather than a setting the applet can read.
const SERVICE_OVERRIDE = "OMNITENSOR_STATE_PATH";
const SERVICE_SNAPSHOT_SOURCE
    = /snapshot_path=_env_path\("(?<variable>[A-Z_]+)", DEFAULT_STATE_PATH(?:, environ)?\)/u;

const repositoryRoot = path.resolve(__dirname, "../..");
const appletRoot = path.join(repositoryRoot, "files/cinnamon-xpuwlm@geraldo-netto");

function readText(...segments) {
    return fs.readFileSync(path.join(...segments), "utf8");
}

const service = omnitensorRepository();

function pythonLiteral(source, name) {
    return new RegExp(`^${name} = "(?<value>[^"\\\\]*)"$`, "mu").exec(source);
}

function pythonAlias(source, name) {
    return new RegExp(`^${name} = (?<module>[a-z_]+)\\.(?<target>[A-Z][A-Z0-9_]*)$`, "mu")
        .exec(source);
}

// The value the service actually defaults to, however it chooses to spell it.
function resolveServiceConstant(source, relativePath, name) {
    const literal = pythonLiteral(source, name);
    if (literal) {
        return literal.groups.value;
    }
    const alias = pythonAlias(source, name);
    assert.notEqual(
        alias,
        null,
        `${relativePath} declares ${name} as neither a string literal nor a `
        + "constant of a sibling module; this gate can no longer read the "
        + "path the service defaults to",
    );
    const aliasedPath = `${path.posix.dirname(relativePath)}/${alias.groups.module}.py`;
    const aliasedSource = service.readText(aliasedPath);
    assert.notEqual(aliasedSource, null, `${relativePath} aliases ${name} to a missing ${aliasedPath}`);
    const resolved = pythonLiteral(aliasedSource, alias.groups.target);
    assert.notEqual(
        resolved,
        null,
        `${aliasedPath} does not declare ${alias.groups.target} as a string literal`,
    );
    return resolved.groups.value;
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

// An operator installing the service reads the service's own guide, not the
// applet's. Documenting the two-sided edit only here left the variable
// discoverable exclusively from the side that cannot set it.
test("the service installation guide names the variable that moves the file", (t) => {
    const guide = "docs/installation.md";
    const text = service.readText(guide);
    if (text === null) {
        t.skip(service.skipReason);
        return;
    }
    assert.equal(
        text.includes(SERVICE_OVERRIDE),
        true,
        `${guide} must name ${SERVICE_OVERRIDE}, not only the file it defaults to`,
    );
    assert.equal(
        text.includes("runtime-state-path"),
        true,
        `${guide} must name the applet setting that has to be changed with it`,
    );
});

test("the runtime service default matches the applet default", (t) => {
    const text = service.readText(SERVICE_SOURCE);
    if (text === null) {
        t.skip(service.skipReason);
        return;
    }
    assert.equal(
        resolveServiceConstant(text, SERVICE_SOURCE, SERVICE_CONSTANT),
        SHARED_SNAPSHOT_PATH,
        "the applet and the runtime service disagree on the snapshot path",
    );
    const override = SERVICE_SNAPSHOT_SOURCE.exec(text);
    assert.notEqual(
        override,
        null,
        `${SERVICE_SOURCE} no longer reads the snapshot path from the environment`,
    );
    assert.equal(
        override.groups.variable,
        SERVICE_OVERRIDE,
        "the documented override no longer names the variable the service reads",
    );
});
