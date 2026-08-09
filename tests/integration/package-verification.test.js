"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const Package = require("../../scripts/package-applet.js");

function temporaryDirectory() {
    return fs.mkdtempSync(path.join(os.tmpdir(), "tpuwm-release-"));
}

// End-to-end against the real payload: stage, checksum, install into a
// scratch prefix, verify the install, remove it, and verify the uninstall.
test("staging, checksums, install and uninstall verification round-trip", () => {
    const dist = temporaryDirectory();
    const lines = [];
    assert.equal(Package.runCommand(["stage"], (line) => lines.push(line), dist), 0);
    const stagedRoot = path.join(dist, Package.UUID);
    const checksums = fs.readFileSync(path.join(dist, `${Package.UUID}.SHA256SUMS`), "utf8");
    assert.equal(checksums, Package.buildChecksums(Package.payloadRoot));
    assert.match(lines[0], /^staged \d+ payload files/u);

    // The staged tree is the payload: byte-identical files, nothing extra.
    const installReport = Package.verifyInstall(stagedRoot, checksums);
    assert.deepEqual(installReport, {ok: true, missing: [], mismatched: [], unexpected: []});
    assert.equal(Package.runCommand(["verify", stagedRoot], () => {}), 0);

    // A tampered install fails verification with the offending path named.
    fs.appendFileSync(path.join(stagedRoot, "metadata.json"), " ");
    const tampered = Package.verifyInstall(stagedRoot, checksums);
    assert.equal(tampered.ok, false);
    assert.deepEqual(tampered.mismatched, ["metadata.json"]);
    const failureLines = [];
    assert.equal(Package.commandVerify(stagedRoot, (line) => failureLines.push(line)), 1);
    assert.equal(failureLines.some((line) => line.includes("metadata.json")), true);

    // Uninstall verification only passes once the tree is gone.
    assert.equal(Package.runCommand(["verify-absent", stagedRoot], () => {}), 1);
    fs.rmSync(stagedRoot, {recursive: true, force: true});
    assert.equal(Package.runCommand(["verify-absent", stagedRoot], () => {}), 0);
    fs.rmSync(dist, {recursive: true, force: true});
});

test("packing the real payload is deterministic across runs", () => {
    const firstDist = temporaryDirectory();
    const secondDist = temporaryDirectory();
    assert.equal(Package.runCommand(["pack"], () => {}, firstDist), 0);
    assert.equal(Package.runCommand(["pack"], () => {}, secondDist), 0);
    const first = fs.readFileSync(path.join(firstDist, `${Package.UUID}.tar`));
    const second = fs.readFileSync(path.join(secondDist, `${Package.UUID}.tar`));
    assert.deepEqual(first, second);
    const recordedHash = fs.readFileSync(path.join(firstDist, `${Package.UUID}.tar.sha256`), "utf8");
    assert.equal(recordedHash, `${Package.sha256Hex(first)}  ${Package.UUID}.tar\n`);
    assert.equal(first.subarray(0, Package.UUID.length + 1).toString("utf8"), `${Package.UUID}/`);
    fs.rmSync(firstDist, {recursive: true, force: true});
    fs.rmSync(secondDist, {recursive: true, force: true});
});
