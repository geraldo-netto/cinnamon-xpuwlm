"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const Package = require("../../scripts/package-applet.js");

function temporaryDirectory() {
    return fs.mkdtempSync(path.join(os.tmpdir(), "tpuwm-package-"));
}

function writeTree(root, files) {
    for (const [relativePath, contents] of Object.entries(files)) {
        const target = path.join(root, relativePath);
        fs.mkdirSync(path.dirname(target), {recursive: true});
        fs.writeFileSync(target, contents);
    }
}

test("payload enumeration is sorted, recursive, and rejects irregular entries", () => {
    const root = temporaryDirectory();
    writeTree(root, {"z.txt": "z", "a/b.txt": "b", "a/a.txt": "a"});
    assert.deepEqual(Package.payloadFiles(root), ["a/a.txt", "a/b.txt", "z.txt"]);
    fs.symlinkSync(path.join(root, "z.txt"), path.join(root, "link.txt"));
    assert.throws(() => Package.payloadFiles(root), /regular files or directories/u);
    fs.rmSync(root, {recursive: true, force: true});
});

test("checksum manifests are deterministic and round-trip through the parser", () => {
    const root = temporaryDirectory();
    writeTree(root, {"b.txt": "beta", "a.txt": "alpha"});
    const first = Package.buildChecksums(root);
    assert.equal(first, Package.buildChecksums(root));
    const entries = Package.parseChecksums(first);
    assert.deepEqual([...entries.keys()], ["a.txt", "b.txt"]);
    assert.equal(entries.get("a.txt"), Package.sha256Hex(Buffer.from("alpha")));
    assert.throws(() => Package.parseChecksums("not a checksum line"), /Malformed/u);
    assert.deepEqual([...Package.parseChecksums("").keys()], []);
    fs.rmSync(root, {recursive: true, force: true});
});

test("staging copies exactly the payload files and replaces stale targets", () => {
    const source = temporaryDirectory();
    const target = path.join(temporaryDirectory(), "staged");
    writeTree(source, {"applet.js": "code", "lib/module.js": "module"});
    writeTree(path.dirname(target), {"staged/stale.txt": "stale"});
    const staged = Package.stagePayload(source, target);
    assert.deepEqual(staged, ["applet.js", "lib/module.js"]);
    assert.equal(fs.readFileSync(path.join(target, "lib/module.js"), "utf8"), "module");
    assert.equal(fs.existsSync(path.join(target, "stale.txt")), false);
    fs.rmSync(source, {recursive: true, force: true});
    fs.rmSync(path.dirname(target), {recursive: true, force: true});
});

test("install verification reports missing, mismatched, and unexpected files", () => {
    const source = temporaryDirectory();
    const installed = temporaryDirectory();
    writeTree(source, {"a.txt": "alpha", "lib/b.txt": "beta"});
    const checksums = Package.buildChecksums(source);
    writeTree(installed, {"a.txt": "alpha", "lib/b.txt": "beta"});
    assert.deepEqual(Package.verifyInstall(installed, checksums), {
        ok: true, missing: [], mismatched: [], unexpected: [],
    });

    writeTree(installed, {"a.txt": "tampered", "extra.txt": "extra"});
    fs.rmSync(path.join(installed, "lib/b.txt"));
    const report = Package.verifyInstall(installed, checksums);
    assert.equal(report.ok, false);
    assert.deepEqual(report.missing, ["lib/b.txt"]);
    assert.deepEqual(report.mismatched, ["a.txt"]);
    assert.deepEqual(report.unexpected, ["extra.txt"]);

    const absent = Package.verifyInstall(path.join(installed, "not-there"), checksums);
    assert.equal(absent.ok, false);
    assert.deepEqual(absent.missing, ["a.txt", "lib/b.txt"]);
    assert.deepEqual(absent.unexpected, []);
    fs.rmSync(source, {recursive: true, force: true});
    fs.rmSync(installed, {recursive: true, force: true});
});

test("uninstall verification requires the directory to be gone", () => {
    const installed = temporaryDirectory();
    writeTree(installed, {"a.txt": "alpha"});
    const present = Package.verifyAbsent(installed);
    assert.equal(present.ok, false);
    assert.deepEqual(present.remaining, ["a.txt"]);
    fs.rmSync(installed, {recursive: true, force: true});
    assert.deepEqual(Package.verifyAbsent(installed), {ok: true, remaining: []});
});

test("archives are byte-deterministic valid ustar with fixed metadata", () => {
    const root = temporaryDirectory();
    writeTree(root, {"applet.js": "x".repeat(600), "lib/module.js": "y"});
    const first = Package.buildArchive(root, "member");
    const second = Package.buildArchive(root, "member");
    assert.deepEqual(first, second);
    assert.equal(first.length % Package.BLOCK_SIZE, 0);

    const members = [];
    for (let offset = 0; offset < first.length; ) {
        const header = first.subarray(offset, offset + Package.BLOCK_SIZE);
        if (header.every((byte) => byte === 0)) {
            break;
        }
        const name = header.subarray(0, 100).toString("utf8").replace(/\0+$/u, "");
        const size = parseInt(header.subarray(124, 135).toString("ascii"), 8);
        const typeflag = String.fromCharCode(header[156]);
        const mtime = parseInt(header.subarray(136, 147).toString("ascii"), 8);
        assert.equal(header.subarray(257, 262).toString("ascii"), "ustar");
        assert.equal(mtime, Package.ARCHIVE_MTIME);
        let checksum = 0;
        for (const [index, byte] of header.entries()) {
            checksum += index >= 148 && index < 156 ? 32 : byte;
        }
        assert.equal(parseInt(header.subarray(148, 154).toString("ascii"), 8), checksum);
        members.push({name, size, typeflag});
        offset += Package.BLOCK_SIZE + Math.ceil(size / Package.BLOCK_SIZE) * Package.BLOCK_SIZE;
    }
    assert.deepEqual(members, [
        {name: "member/", size: 0, typeflag: "5"},
        {name: "member/lib/", size: 0, typeflag: "5"},
        {name: "member/applet.js", size: 600, typeflag: "0"},
        {name: "member/lib/module.js", size: 1, typeflag: "0"},
    ]);
    assert.throws(() => Package.tarHeader(`member/${"n".repeat(120)}`, 0, "0"), /100 characters/u);
    fs.rmSync(root, {recursive: true, force: true});
});

test("member directory expansion is complete, unique, and sorted", () => {
    assert.deepEqual(Package.memberDirectories(["u/a/b/c.txt", "u/a/d.txt", "u/e.txt"]), [
        "u", "u/a", "u/a/b",
    ]);
    assert.deepEqual(Package.memberDirectories([]), []);
    assert.equal(Package.octal(0, 8), "0000000\0");
    assert.equal(Package.tarPadding(Package.BLOCK_SIZE).length, 0);
    assert.equal(Package.tarPadding(1).length, Package.BLOCK_SIZE - 1);
    assert.equal(Package.compareText("a", "a"), 0);
    assert.equal(Package.compareText("a", "b") < 0, true);
    assert.equal(Package.compareText("b", "a") > 0, true);
});

test("command runner reports usage for unknown or incomplete invocations", () => {
    const lines = [];
    const log = (line) => lines.push(line);
    assert.equal(Package.runCommand([], log), 2);
    assert.equal(Package.runCommand(["verify"], log), 2);
    assert.equal(Package.runCommand(["unknown"], log), 2);
    assert.equal(lines.every((line) => line.startsWith("usage:")), true);
});
