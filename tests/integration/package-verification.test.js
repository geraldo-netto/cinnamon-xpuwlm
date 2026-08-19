"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const Package = require("../../scripts/package-applet.js");

function temporaryDirectory() {
    return fs.mkdtempSync(path.join(os.tmpdir(), "xpuwlm-release-"));
}

// End-to-end against the real payload: stage, checksum, install into a
// scratch prefix, verify the install, remove it, and verify the uninstall.
test("staging, checksums, install and uninstall verification round-trip", () => {
    const dist = temporaryDirectory();
    const lines = [];
    assert.equal(Package.runCommand(["stage"], (line) => lines.push(line), dist), 0);
    const stagedRoot = path.join(dist, Package.UUID);
    const checksums = fs.readFileSync(path.join(dist, `${Package.UUID}.SHA256SUMS`), "utf8");
    assert.equal(checksums, Package.buildChecksums(
        Package.payloadRoot,
        Package.appletPayloadFiles(Package.payloadRoot),
    ));
    assert.match(lines[0], /^staged \d+ payload files/u);

    // The staged tree is the payload: byte-identical files, nothing extra.
    const installReport = Package.verifyInstall(stagedRoot, checksums);
    assert.deepEqual(installReport, {ok: true, missing: [], mismatched: [], unexpected: []});
    // Everything the helper needs ships, and the shim that Cinnamon's nested
    // resolution requires ships beside it. A module nothing requires does not
    // exist here any more, which is what keeps staging honest.
    for (const relativePath of [
        "applet.js", "lib/panel-status.js",
        "lib/snapshot-reader.js", "lib/window-placement.js", "lib/xpuwlm-launcher.js",
        "stylesheet.css",
    ]) {
        assert.equal(fs.existsSync(path.join(stagedRoot, relativePath)), true, relativePath);
    }
    assert.equal(fs.existsSync(path.join(stagedRoot, "lib/domain.js")), false);
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
    const firstSpice = path.join(firstDist, "spices", Package.UUID);
    const secondSpice = path.join(secondDist, "spices", Package.UUID);
    assert.equal(Package.buildChecksums(firstSpice), Package.buildChecksums(secondSpice));
    assert.deepEqual(fs.readdirSync(path.join(firstSpice, "files")), [Package.UUID]);
    assert.deepEqual(Package.inspectSpiceSources(
        firstSpice,
        path.join(firstSpice, "files", Package.UUID),
    ), {
        info: {author: "geraldo-netto", license: "MIT"},
        screenshot: {width: 585, height: 770},
    });
    fs.rmSync(firstDist, {recursive: true, force: true});
    fs.rmSync(secondDist, {recursive: true, force: true});
});

// The staging guard refuses a symlink by throwing, which is right for a
// payload about to be released and wrong for an installed tree: there, a
// symlink is what the report exists to name.
test("an installed tree is inspected rather than refused", () => {
    const dist = temporaryDirectory();
    assert.equal(Package.runCommand(["stage"], () => {}, dist), 0);
    const stagedRoot = path.join(dist, Package.UUID);
    const checksums = fs.readFileSync(path.join(dist, `${Package.UUID}.SHA256SUMS`), "utf8");

    fs.symlinkSync(path.join(stagedRoot, "metadata.json"), path.join(stagedRoot, "extra.json"));
    const withLink = Package.verifyInstall(stagedRoot, checksums);
    assert.equal(withLink.ok, false);
    assert.deepEqual(withLink.unexpected, ["extra.json"]);
    assert.deepEqual(withLink.mismatched, []);

    // And a payload file replaced by a link to an identical file is the file
    // not being there, however well its contents hash.
    fs.rmSync(path.join(stagedRoot, "extra.json"));
    const metadata = path.join(stagedRoot, "metadata.json");
    fs.cpSync(metadata, path.join(dist, "metadata.json"));
    fs.rmSync(metadata);
    fs.symlinkSync(path.join(dist, "metadata.json"), metadata);
    const linked = Package.verifyInstall(stagedRoot, checksums);
    assert.deepEqual(linked.mismatched, ["metadata.json"]);
    assert.deepEqual(linked.missing, []);

    // Uninstall verification walks the same tree, and must name what is left
    // rather than throw on it.
    assert.deepEqual(Package.verifyAbsent(stagedRoot).remaining.includes("metadata.json"), true);
    fs.rmSync(dist, {recursive: true, force: true});
});

// A pack that dies partway must not leave a dist that reads as a release.
// The checksum manifest is written first, so a failure after it leaves the
// previous run's archive and its digest sidecar beside a manifest for a
// different payload — three files that agree in pairs and describe nothing.
test("a pack that fails partway leaves no archive digest from the previous run", () => {
    const dist = temporaryDirectory();
    const archive = path.join(dist, `${Package.UUID}.tar`);
    const digest = `${archive}.sha256`;
    fs.writeFileSync(digest, `${"0".repeat(64)}  ${Package.UUID}.tar\n`);
    // The archive cannot be written over a directory, which is this test's way
    // of interrupting the pack after the payload has been staged.
    fs.mkdirSync(archive);

    assert.throws(() => Package.commandPack(() => {}, dist));

    assert.equal(fs.existsSync(digest), false, "a stale digest survived a failed pack");
    fs.rmSync(dist, {recursive: true, force: true});
});
