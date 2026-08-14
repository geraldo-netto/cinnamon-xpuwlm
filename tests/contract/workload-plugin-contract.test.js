"use strict";

const assert = require("node:assert/strict");
const childProcess = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const Checker = require("../../scripts/check-workload-manifests.js");
const Manifest = require("../../files/cinnamon-xpuwlm@geraldo-netto/lib/workload-manifest.js");
const Registry = require("../../files/cinnamon-xpuwlm@geraldo-netto/lib/workload-registry.js");

const templatePath = path.resolve(__dirname, "../../templates/workload-plugin/manifest.json");
const checkerPath = path.resolve(__dirname, "../../scripts/check-workload-manifests.js");

test("author template satisfies descriptor and checker contracts", () => {
    const template = JSON.parse(fs.readFileSync(templatePath, "utf8"));
    const descriptor = new Manifest.WorkloadDescriptor(template);
    assert.equal(descriptor.id, "replace-me");
    assert.deepEqual(Checker.checkManifestFile(templatePath, "replace-me"), template);
    assert.deepEqual(
        Registry.profileDefinitions(new Registry.StaticWorkloadRegistry([descriptor]))[0],
        descriptor.profileDefinition(),
    );
});

test("checker reports schema, identity, ordering, and malformed JSON failures", () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "xpuwlm-plugin-contract-"));
    const template = JSON.parse(fs.readFileSync(templatePath, "utf8"));
    try {
        for (const [id, order] of [["beta", 20], ["alpha", 10]]) {
            fs.mkdirSync(path.join(directory, id));
            fs.writeFileSync(path.join(directory, id, "manifest.json"), JSON.stringify({
                ...template,
                id,
                ui: {...template.ui, order},
            }));
        }
        fs.writeFileSync(path.join(directory, "README.txt"), "not a workload\n");
        assert.deepEqual(Checker.manifestDirectories(directory), ["alpha", "beta"]);
        assert.equal(Checker.checkWorkloadDirectory(directory).length, 2);

        const beta = path.join(directory, "beta", "manifest.json");
        fs.writeFileSync(beta, JSON.stringify({...template, id: "wrong"}));
        assert.throws(() => Checker.checkWorkloadDirectory(directory), /id must match/u);
        fs.writeFileSync(beta, JSON.stringify({...template, id: "beta", ui: {...template.ui, order: 10}}));
        assert.throws(() => Checker.checkWorkloadDirectory(directory), /1 !== 2/u);
        fs.writeFileSync(beta, JSON.stringify({...template, id: "beta", extra: true}));
        assert.throws(() => Checker.checkWorkloadDirectory(directory), /additional properties/u);
        fs.writeFileSync(beta, "{");
        assert.throws(() => Checker.checkWorkloadDirectory(directory), SyntaxError);
    } finally {
        fs.rmSync(directory, {recursive: true, force: true});
    }
});

test("checker formats empty and populated schema reports", () => {
    assert.equal(Checker.formatErrors(null), "");
    assert.equal(Checker.formatErrors([{instancePath: "/id", message: "is invalid"}]), "/id is invalid");
    assert.equal(Checker.formatErrors([{instancePath: "", message: "is invalid"}]), "/ is invalid");

    const missingFields = Checker.schemaErrors({});
    assert.match(missingFields, /required property 'manifestVersion'/u);
    assert.match(missingFields, /required property 'acceptance'/u);
    assert.equal(missingFields.split("; ").length, 9);
});

test("manifest directory discovery is sorted and ignores non-directories", (t) => {
    t.mock.method(fs, "readdirSync", () => [
        {name: "zeta", isDirectory: () => true},
        {name: "README.txt", isDirectory: () => false},
        {name: "alpha", isDirectory: () => true},
    ]);

    assert.deepEqual(Checker.manifestDirectories("/unused"), ["alpha", "zeta"]);
});

test("checker command distinguishes imports, defaults, and explicit catalogs", () => {
    const imported = childProcess.spawnSync(
        process.execPath,
        ["-e", `require(${JSON.stringify(checkerPath)})`],
        {encoding: "utf8"},
    );
    assert.equal(imported.status, 0, imported.stderr);
    assert.equal(imported.stdout, "");

    const defaultOutput = childProcess.execFileSync(process.execPath, [checkerPath], {encoding: "utf8"});
    assert.equal(defaultOutput.trim(), "workload manifests: 9 valid");

    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "xpuwlm-checker-cli-"));
    try {
        const workload = path.join(directory, "sample");
        fs.mkdirSync(workload);
        const template = JSON.parse(fs.readFileSync(templatePath, "utf8"));
        fs.writeFileSync(
            path.join(workload, "manifest.json"),
            JSON.stringify({...template, id: "sample"}),
        );

        const explicitOutput = childProcess.execFileSync(
            process.execPath,
            [checkerPath, "."],
            {cwd: directory, encoding: "utf8"},
        );
        assert.equal(explicitOutput.trim(), "workload manifests: 1 valid");

        const absolute = childProcess.spawnSync(
            process.execPath,
            [checkerPath, directory],
            {cwd: directory, encoding: "utf8"},
        );
        assert.notEqual(absolute.status, 0);
        assert.match(absolute.stderr, /must be relative/u);
    } finally {
        fs.rmSync(directory, {recursive: true, force: true});
    }
});

test("checker CLI catalog stays inside its canonical workspace", () => {
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "xpuwlm-checker-root-"));
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), "xpuwlm-checker-outside-"));
    try {
        fs.mkdirSync(path.join(workspace, "catalog"));
        fs.symlinkSync(outside, path.join(workspace, "escape"));
        assert.equal(Checker.cliCatalogRoot("catalog", workspace), path.join(workspace, "catalog"));
        assert.throws(() => Checker.cliCatalogRoot("../outside", workspace), /escapes/u);
        assert.throws(() => Checker.cliCatalogRoot("escape", workspace), /escapes/u);
        assert.throws(() => Checker.cliCatalogRoot(outside, workspace), /must be relative/u);
    } finally {
        fs.rmSync(workspace, {recursive: true, force: true});
        fs.rmSync(outside, {recursive: true, force: true});
    }
});
