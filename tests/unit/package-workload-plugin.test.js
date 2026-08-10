"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const Plugin = require("../../scripts/package-workload-plugin.js");
const Registry = require("../../files/cinnamon-tpuwm@geraldo-netto/lib/workload-registry.js");

const templatePath = path.resolve(__dirname, "../../templates/workload-plugin/manifest.json");
const template = JSON.parse(fs.readFileSync(templatePath, "utf8"));

function temporaryDirectory() {
    return fs.mkdtempSync(path.join(os.tmpdir(), "tpuwm-plugin-"));
}

// A third-party plug-in is one directory named after its workload, so every
// fixture is built the way an author would actually ship it.
function pluginDirectory(id, overrides = {}) {
    const root = path.join(temporaryDirectory(), id);
    fs.mkdirSync(root, {recursive: true});
    const manifest = {...template, id, ui: {...template.ui, order: 901}, ...overrides};
    fs.writeFileSync(path.join(root, "manifest.json"), JSON.stringify(manifest, null, 2));
    return root;
}

function bundled(entries = [{id: "hardware-health", ui: {order: 10}}]) {
    return entries;
}

test("bundled manifests are read from the shipped workload directory", () => {
    const manifests = Plugin.bundledManifests();
    assert.equal(manifests.length > 0, true);
    assert.equal(manifests.every((manifest) => typeof manifest.id === "string"), true);
    assert.equal(manifests.some((manifest) => manifest.id === "hardware-health"), true);
});

test("structure reporting demands exactly one manifest and no irregular entries", () => {
    const root = pluginDirectory("plain-plugin");
    assert.deepEqual(Plugin.structureProblems(root), []);

    fs.writeFileSync(path.join(root, "README.md"), "docs");
    assert.deepEqual(Plugin.structureProblems(root), [
        "the applet reads only manifest.json; remove README.md",
    ]);

    fs.symlinkSync(path.join(root, "manifest.json"), path.join(root, "link.json"));
    assert.match(Plugin.structureProblems(root)[0], /not a plain plug-in directory/u);

    const empty = temporaryDirectory();
    assert.deepEqual(Plugin.structureProblems(empty), [`manifest.json is missing from ${empty}`]);
    fs.rmSync(path.dirname(root), {recursive: true, force: true});
    fs.rmSync(empty, {recursive: true, force: true});
});

test("manifest reading enforces the discovery byte bound and JSON syntax", () => {
    const root = pluginDirectory("readable-plugin");
    const problems = [];
    assert.equal(Plugin.readManifest(root, problems).id, "readable-plugin");
    assert.deepEqual(problems, []);

    fs.writeFileSync(path.join(root, "manifest.json"), "{");
    assert.equal(Plugin.readManifest(root, problems), null);
    assert.match(problems[0], /invalid JSON/u);

    fs.writeFileSync(
        path.join(root, "manifest.json"),
        " ".repeat(Registry.MAX_MANIFEST_BYTES + 1),
    );
    assert.equal(Plugin.readManifest(root, problems), null);
    assert.match(problems[1], /exceeds the 65536 byte discovery bound/u);
    fs.rmSync(path.dirname(root), {recursive: true, force: true});
});

test("identity reporting covers the directory grammar and manifest parity", () => {
    assert.deepEqual(Plugin.identityProblems("good-id", {id: "good-id"}), []);
    assert.deepEqual(Plugin.identityProblems("Bad Id", {id: "Bad Id"}), [
        "the directory name Bad Id is not a valid workload identifier",
    ]);
    assert.deepEqual(Plugin.identityProblems("good-id", {id: "other-id"}), [
        "manifest id other-id does not match the directory name good-id",
    ]);
});

test("catalog reporting detects bundled shadowing and display-order collisions", () => {
    assert.deepEqual(Plugin.catalogProblems({id: "unique", ui: {order: 901}}, bundled()), []);
    assert.deepEqual(Plugin.catalogProblems({id: "hardware-health", ui: {order: 901}}, bundled()), [
        "hardware-health is a bundled workload id; bundled-wins merging would ignore this plug-in",
    ]);
    assert.deepEqual(Plugin.catalogProblems({id: "unique", ui: {order: 10}}, bundled()), [
        "ui.order 10 is already used by the bundled workload hardware-health",
    ]);
});

test("contract reporting states the schema and descriptor verdicts separately", () => {
    assert.deepEqual(Plugin.contractProblems({...template, id: "contract-plugin"}), []);
    assert.match(
        Plugin.contractProblems({...template, extra: true})[0],
        /fails the version 1 schema/u,
    );
    assert.match(
        Plugin.contractProblems({id: "only-an-id"})[0],
        /fails the version 1 schema/u,
    );
});

test("validation accumulates every reason a plug-in would not load", () => {
    const good = pluginDirectory("good-plugin");
    assert.deepEqual(Plugin.validatePlugin(good, bundled()), {
        ok: true,
        id: "good-plugin",
        version: "0.1.0",
        problems: [],
    });

    const mismatched = pluginDirectory("mismatched-plugin", {id: "other-plugin"});
    fs.writeFileSync(path.join(mismatched, "extra.txt"), "stray");
    const report = Plugin.validatePlugin(mismatched, bundled());
    assert.equal(report.ok, false);
    assert.deepEqual(report.problems, [
        "the applet reads only manifest.json; remove extra.txt",
        "manifest id other-plugin does not match the directory name mismatched-plugin",
    ]);

    const broken = pluginDirectory("broken-plugin");
    fs.writeFileSync(path.join(broken, "manifest.json"), JSON.stringify({...template, extra: true}));
    const brokenReport = Plugin.validatePlugin(broken, bundled());
    assert.equal(brokenReport.version, null);
    assert.match(brokenReport.problems[0], /fails the version 1 schema/u);

    const absent = temporaryDirectory();
    assert.deepEqual(Plugin.validatePlugin(absent, bundled()), {
        ok: false,
        id: path.basename(absent),
        version: null,
        problems: [`manifest.json is missing from ${absent}`],
    });

    const unparsable = pluginDirectory("unparsable-plugin");
    fs.writeFileSync(path.join(unparsable, "manifest.json"), "{");
    assert.equal(Plugin.validatePlugin(unparsable, bundled()).ok, false);

    for (const root of [good, mismatched, broken, unparsable]) {
        fs.rmSync(path.dirname(root), {recursive: true, force: true});
    }
    fs.rmSync(absent, {recursive: true, force: true});
});

test("commands report the install location, every problem, and the packed archive", () => {
    const lines = [];
    const log = (line) => lines.push(line);
    const root = pluginDirectory("command-plugin");
    const dist = temporaryDirectory();

    assert.equal(Plugin.commandValidate(root, log, bundled()), 0);
    assert.match(lines[0], /plug-in verified: command-plugin 0\.1\.0 installs as/u);

    assert.equal(Plugin.commandPack(root, log, dist, bundled()), 0);
    assert.match(lines[1], /packed command-plugin-0\.1\.0\.tar \(\d+ bytes, sha256 [0-9a-f]{64}\)/u);
    const archive = fs.readFileSync(path.join(dist, "command-plugin-0.1.0.tar"));
    assert.deepEqual(archive, fs.readFileSync(path.join(dist, "command-plugin-0.1.0.tar")));
    assert.match(
        fs.readFileSync(path.join(dist, "command-plugin-0.1.0.tar.sha256"), "utf8"),
        /^[0-9a-f]{64} {2}command-plugin-0\.1\.0\.tar\n$/u,
    );

    const shadowing = pluginDirectory("hardware-health");
    assert.equal(Plugin.commandValidate(shadowing, log, bundled()), 1);
    assert.equal(Plugin.commandPack(shadowing, log, dist, bundled()), 1);
    assert.equal(lines.filter((line) => line.startsWith("plug-in problem:")).length, 2);
    assert.equal(fs.existsSync(path.join(dist, "hardware-health-0.1.0.tar")), false);

    fs.rmSync(path.dirname(root), {recursive: true, force: true});
    fs.rmSync(path.dirname(shadowing), {recursive: true, force: true});
    fs.rmSync(dist, {recursive: true, force: true});
});

test("command runner reports usage for unknown or incomplete invocations", () => {
    const lines = [];
    const log = (line) => lines.push(line);
    assert.equal(Plugin.runCommand([], log), 2);
    assert.equal(Plugin.runCommand(["validate"], log), 2);
    assert.equal(Plugin.runCommand(["pack"], log), 2);
    assert.equal(Plugin.runCommand(["unknown", "root"], log), 2);
    assert.equal(lines.every((line) => line.startsWith("usage:")), true);

    const root = pluginDirectory("runner-plugin");
    const dist = temporaryDirectory();
    assert.equal(Plugin.runCommand(["validate", root], log), 0);
    assert.equal(Plugin.runCommand(["pack", root, dist], log, dist), 0);
    assert.equal(fs.existsSync(path.join(dist, "runner-plugin-0.1.0.tar")), true);
    fs.rmSync(path.dirname(root), {recursive: true, force: true});
    fs.rmSync(dist, {recursive: true, force: true});
});
