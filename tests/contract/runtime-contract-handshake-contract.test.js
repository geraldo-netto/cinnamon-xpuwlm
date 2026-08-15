"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const Contract = require("../../files/cinnamon-xpuwlm@geraldo-netto/lib/runtime-contract.js");
const Cinnamon = require("../../files/cinnamon-xpuwlm@geraldo-netto/lib/cinnamon-runtime.js");

// The handshake exists to catch exactly one thing: the applet and the service
// disagreeing about what they speak. A handshake that itself drifts would
// report agreement between two builds that do not agree, which is worse than
// having none — so it gets the strictest gate in the repository.
const repositoryRoot = path.resolve(__dirname, "../..");
const appletRoot = path.join(repositoryRoot, "files/cinnamon-xpuwlm@geraldo-netto");

function serviceRoot() {
    const configured = process.env.XPUWLM_OMNITENSOR_ROOT;
    const candidate = configured || path.resolve(repositoryRoot, "../omnitensor");
    return fs.existsSync(path.join(candidate, "src/omnitensor/service.py")) ? candidate : null;
}

function readJson(...segments) {
    return JSON.parse(fs.readFileSync(path.join(...segments), "utf8"));
}

test("the mirrored handshake schema is the service's, unchanged", (t) => {
    const root = serviceRoot();
    if (root === null) {
        t.skip(
            "the OmniTensor checkout is not available; "
            + "set XPUWLM_OMNITENSOR_ROOT to run the cross-repository half of this gate",
        );
        return;
    }

    assert.deepEqual(
        readJson(appletRoot, "runtime-contract.schema.json"),
        readJson(root, "schemas/runtime-contract.schema.json"),
        "the mirror drifted; the applet would reject a valid description",
    );
});

test("the method the applet calls is the method the service exports", (t) => {
    const root = serviceRoot();
    if (root === null) {
        t.skip("the OmniTensor checkout is not available");
        return;
    }
    const source = fs.readFileSync(
        path.join(root, "src/omnitensor/socket_transport.py"), "utf8",
    );
    const contract = fs.readFileSync(
        path.join(root, "src/omnitensor/contract.py"), "utf8",
    );

    assert.match(
        source,
        new RegExp(`"${Cinnamon.CONTRACT_METHOD}": `, "u"),
        `the service no longer dispatches ${Cinnamon.CONTRACT_METHOD}`,
    );
    // The dispatch table is asserted against the announced contract at
    // startup, so a divergence cannot ship silently.
    assert.match(source, /^from \.contract import RUNTIME_METHODS$/mu);
    assert.match(source, /set\(table\) != set\(RUNTIME_METHODS\)/u);
    const runtimeMethods = contract.match(
        /^RUNTIME_METHODS = \(\n(?<body>(?: {4}"[a-z-]+",\n)+)\)$/mu,
    );
    assert.notEqual(runtimeMethods, null, "the runtime method declaration is no longer closed");
    assert.equal(
        runtimeMethods.groups.body.includes(`    "${Cinnamon.CONTRACT_METHOD}",\n`),
        true,
        "the method is dispatched but not announced in RUNTIME_METHODS",
    );
});

test("every method this applet requires is one the service still exports", (t) => {
    const root = serviceRoot();
    if (root === null) {
        t.skip("the OmniTensor checkout is not available");
        return;
    }
    const source = fs.readFileSync(
        path.join(root, "src/omnitensor/socket_transport.py"), "utf8",
    );

    for (const method of Contract.REQUIRED_METHODS) {
        assert.match(
            source,
            new RegExp(`"${method}": `, "u"),
            `the applet would report a mismatch against every service: ${method} is gone`,
        );
    }
});

test("the versions this applet requires are the versions the service pins", (t) => {
    const root = serviceRoot();
    if (root === null) {
        t.skip("the OmniTensor checkout is not available");
        return;
    }
    // Without this, bumping a schema on the service side ships an applet that
    // reports every service incompatible — a handshake failing open would be
    // safer than one that cries wolf.
    for (const [name, required] of Object.entries(Contract.REQUIRED_CONTRACTS)) {
        const schema = readJson(root, "schemas", `${name}.schema.json`);
        assert.equal(
            schema.properties.version.const,
            required,
            `${name}: the applet requires ${required} and the service pins `
            + `${schema.properties.version.const}`,
        );
    }
});

test("every contract the applet requires is one it also mirrors and validates", () => {
    // A version check that passes on a document the applet cannot parse moves
    // the failure later without preventing it.
    for (const name of Object.keys(Contract.REQUIRED_CONTRACTS)) {
        const mirrored = path.join(appletRoot, `${name}.schema.json`);
        assert.equal(fs.existsSync(mirrored), true, `${name} is required but not mirrored here`);
    }
});
