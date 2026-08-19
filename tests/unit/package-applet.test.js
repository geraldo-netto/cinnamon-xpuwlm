"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const Package = require("../../scripts/package-applet.js");

function temporaryDirectory() {
    return fs.mkdtempSync(path.join(os.tmpdir(), "xpuwlm-package-"));
}

function writeTree(root, files) {
    for (const [relativePath, contents] of Object.entries(files)) {
        const target = path.join(root, relativePath);
        fs.mkdirSync(path.dirname(target), {recursive: true});
        fs.writeFileSync(target, contents);
    }
}

function png(width = 585, height = 770) {
    const contents = Buffer.alloc(24);
    Buffer.from("89504e470d0a1a0a", "hex").copy(contents);
    contents.write("IHDR", 12, "ascii");
    contents.writeUInt32BE(width, 16);
    contents.writeUInt32BE(height, 20);
    return contents;
}

function writeSpiceSources(root, overrides = {}) {
    const license = overrides.license || "MIT text";
    const appletLicense = overrides.appletLicense || license;
    writeTree(root, {
        "LICENSE": license,
        "README.md": "# Applet",
        "info.json": JSON.stringify(overrides.info || {author: "geraldo-netto", license: "MIT"}),
        "screenshot.png": overrides.screenshot || png(),
        [`files/${Package.UUID}/LICENSE`]: appletLicense,
        [`files/${Package.UUID}/applet.js`]: "code",
    });
    return path.join(root, "files", Package.UUID);
}

test("payload enumeration is sorted, recursive, and rejects irregular entries", () => {
    const root = temporaryDirectory();
    writeTree(root, {"z.txt": "z", "a/b.txt": "b", "a/a.txt": "a"});
    assert.deepEqual(Package.payloadFiles(root), ["a/a.txt", "a/b.txt", "z.txt"]);
    fs.symlinkSync(path.join(root, "z.txt"), path.join(root, "link.txt"));
    assert.throws(() => Package.payloadFiles(root), /regular files or directories/u);
    fs.rmSync(root, {recursive: true, force: true});
});

test("production require graph is static, closed, and carries only required root shims", () => {
    const root = temporaryDirectory();
    writeTree(root, {
        "applet.js": "const Entry = require(\"./lib/entry.js\");\n",
        "dep.js": "module.exports = require(\"./lib/dep.js\");\n",
        "lib/dep.js": "module.exports = {value: true};\n",
        "lib/entry.js": "const Dep = require(\"./dep.js\");\nmodule.exports = Dep;\n",
        "lib/unreachable.js": "module.exports = false;\n",
        "metadata.json": "{}",
        "unreachable.js": "module.exports = require(\"./lib/unreachable.js\");\n",
    });

    assert.deepEqual(Package.productionRequireGraph(root), {
        entry: "applet.js",
        modules: ["applet.js", "lib/dep.js", "lib/entry.js"],
        rootShims: ["dep.js"],
    });
    assert.deepEqual(Package.appletPayloadFiles(root), [
        "applet.js", "dep.js", "lib/dep.js", "lib/entry.js", "metadata.json",
    ]);
    assert.deepEqual(Package.payloadFiles(root), [
        "applet.js", "dep.js", "lib/dep.js", "lib/entry.js", "lib/unreachable.js",
        "metadata.json", "unreachable.js",
    ]);
    assert.throws(
        () => Package.productionRequireGraph(root, "../outside.js"),
        /entry escapes/u,
    );

    fs.rmSync(path.join(root, "dep.js"));
    assert.throws(() => Package.productionRequireGraph(root), /missing: dep\.js/u);
    writeTree(root, {"dep.js": "module.exports = require(\"./lib/entry.js\");\n"});
    assert.throws(() => Package.productionRequireGraph(root), /must resolve only lib\/dep\.js/u);
    writeTree(root, {
        "lib/entry.js": "require(\"./nested/dep.js\");\n",
        "lib/nested/dep.js": "module.exports = true;\n",
    });
    assert.throws(() => Package.productionRequireGraph(root), /unsupported root shim/u);
    fs.rmSync(root, {recursive: true, force: true});
});

test("production require scanning rejects dynamic, external, escaping, and missing edges", () => {
    assert.deepEqual(Package.sourceRequires([
        "const One = require(\"./one.js\");",
        "const Two = require(\"../two.js\");",
    ].join("\n"), "fixture.js"), ["./one.js", "../two.js"]);
    for (const source of [
        "const Dynamic = require(name);",
        "const Single = require('./single.js');",
        "const Open = require(\"./open.js\";",
    ]) {
        assert.throws(() => Package.sourceRequires(source, "fixture.js"), /static string/u);
    }

    const root = temporaryDirectory();
    for (const [source, pattern] of [
        ["require(\"node:fs\");", /must be relative/u],
        ["require(\"../outside.js\");", /escapes the applet/u],
        ["require(\"./missing.js\");", /missing: missing\.js/u],
    ]) {
        writeTree(root, {"applet.js": source});
        assert.throws(() => Package.productionRequireGraph(root), pattern);
    }
    fs.rmSync(root, {recursive: true, force: true});
});

test("checksum manifests are deterministic and round-trip through the parser", () => {
    const root = temporaryDirectory();
    writeTree(root, {"b.txt": "beta", "a.txt": "alpha"});
    const first = Package.buildChecksums(root);
    assert.equal(first, Package.buildChecksums(root));
    assert.equal(first, Package.buildChecksums(root, ["b.txt", "a.txt"]));
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

test("PNG dimensions require the signature and IHDR header", () => {
    assert.deepEqual(Package.pngDimensions(png(640, 480)), {width: 640, height: 480});
    assert.throws(() => Package.pngDimensions(Buffer.alloc(23)), /PNG with an IHDR/u);
    const badSignature = png();
    badSignature[0] = 0;
    assert.throws(() => Package.pngDimensions(badSignature), /PNG with an IHDR/u);
    const badHeader = png();
    badHeader.write("NOPE", 12, "ascii");
    assert.throws(() => Package.pngDimensions(badHeader), /PNG with an IHDR/u);
});

test("Spice sources enforce author, screenshot, and matching payload license", () => {
    const project = temporaryDirectory();
    const applet = writeSpiceSources(project);
    assert.deepEqual(Package.inspectSpiceSources(project, applet), {
        info: {author: "geraldo-netto", license: "MIT"},
        screenshot: {width: 585, height: 770},
    });

    fs.writeFileSync(path.join(project, "info.json"), JSON.stringify({author: "wrong", license: "MIT"}));
    assert.throws(() => Package.inspectSpiceSources(project, applet), /GitHub author/u);
    fs.writeFileSync(path.join(project, "info.json"), JSON.stringify({author: "geraldo-netto", license: "GPL"}));
    assert.throws(() => Package.inspectSpiceSources(project, applet), /MIT license/u);
    fs.writeFileSync(path.join(project, "info.json"), JSON.stringify({author: "geraldo-netto", license: "MIT"}));

    fs.writeFileSync(path.join(project, "screenshot.png"), png(399, 770));
    assert.throws(() => Package.inspectSpiceSources(project, applet), /at least 400px/u);
    fs.writeFileSync(path.join(project, "screenshot.png"), png(585, 399));
    assert.throws(() => Package.inspectSpiceSources(project, applet), /at least 400px/u);
    fs.writeFileSync(path.join(project, "screenshot.png"), png());

    fs.writeFileSync(path.join(applet, "LICENSE"), "different");
    assert.throws(() => Package.inspectSpiceSources(project, applet), /must match/u);
    fs.rmSync(project, {recursive: true, force: true});
});

test("Spice staging creates only the official release tree and replaces stale files", () => {
    const project = temporaryDirectory();
    const applet = writeSpiceSources(project);
    const targetParent = temporaryDirectory();
    const target = path.join(targetParent, Package.UUID);
    writeTree(target, {"stale.txt": "stale"});

    const staged = Package.stageSpiceRelease(project, applet, target);

    assert.deepEqual(staged, [
        "LICENSE",
        "README.md",
        `files/${Package.UUID}/LICENSE`,
        `files/${Package.UUID}/applet.js`,
        "info.json",
        "screenshot.png",
    ]);
    assert.equal(fs.existsSync(path.join(target, "stale.txt")), false);
    assert.deepEqual(fs.readdirSync(path.join(target, "files")), [Package.UUID]);
    assert.equal(fs.readFileSync(path.join(target, "info.json"), "utf8"), JSON.stringify({
        author: "geraldo-netto", license: "MIT",
    }));
    fs.rmSync(project, {recursive: true, force: true});
    fs.rmSync(targetParent, {recursive: true, force: true});
});

test("Spice metadata must be present as regular files", () => {
    const project = temporaryDirectory();
    const applet = writeSpiceSources(project);
    fs.rmSync(path.join(project, "README.md"));
    assert.throws(() => Package.inspectSpiceSources(project, applet), /missing: README.md/u);
    fs.symlinkSync(path.join(project, "LICENSE"), path.join(project, "README.md"));
    assert.throws(() => Package.inspectSpiceSources(project, applet), /regular file: README.md/u);
    fs.rmSync(project, {recursive: true, force: true});
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
    assert.deepEqual(
        first,
        Package.buildArchive(root, "member", ["lib/module.js", "applet.js"]),
    );
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
    assert.throws(() => Package.tarHeader(`member/${"n".repeat(120)}`, 0, "0"), /100 bytes/u);
    // The field is 100 bytes, so a name that fits in characters and not in
    // bytes is refused rather than written truncated.
    assert.throws(() => Package.tarHeader("é".repeat(51), 0, "0"), /100 bytes/u);
    assert.equal(Package.tarHeader("é".repeat(50), 0, "0").length, Package.BLOCK_SIZE);
    fs.rmSync(root, {recursive: true, force: true});
});

test("member directory expansion is complete, unique, and sorted", () => {
    assert.deepEqual(Package.memberDirectories(["u/a/b/c.txt", "u/a/d.txt", "u/e.txt"]), [
        "u", "u/a", "u/a/b",
    ]);
    assert.deepEqual(Package.memberDirectories([]), []);
    assert.equal(Package.octal(0, 8), "0000000\0");
    // A value too wide for its field used to be written a digit short and
    // still checksum, so the archive said a size or a mode it did not mean.
    assert.equal(Package.octal(0o7777777, 8), "7777777\0");
    assert.throws(() => Package.octal(0o77777777, 8), RangeError);
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

test("Spice command stages the repository release tree", () => {
    const dist = temporaryDirectory();
    const lines = [];

    assert.equal(Package.runCommand(["spice"], (line) => lines.push(line), dist), 0);

    const release = path.join(dist, "spices", Package.UUID);
    assert.deepEqual(Package.inspectSpiceSources(release, path.join(release, "files", Package.UUID)), {
        info: {author: "geraldo-netto", license: "MIT"},
        screenshot: {width: 585, height: 770},
    });
    assert.match(lines[0], /^staged \d+ Spice files/u);
    fs.rmSync(dist, {recursive: true, force: true});
});
