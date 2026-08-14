"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const Artifacts = require("../../scripts/validate-artifacts.js");
const REPOSITORY_ROOT = path.resolve(__dirname, "../..");
const UUID = "cinnamon-xpuwlm@geraldo-netto";

function temporaryDirectory() {
    return fs.mkdtempSync(path.join(os.tmpdir(), "xpuwlm-artifacts-"));
}

function writeTree(root, files) {
    for (const [relativePath, contents] of Object.entries(files)) {
        const target = path.join(root, relativePath);
        fs.mkdirSync(path.dirname(target), {recursive: true});
        fs.writeFileSync(target, contents);
    }
}

function copiedRepository(context) {
    const root = temporaryDirectory();
    context.after(() => fs.rmSync(root, {recursive: true, force: true}));
    fs.cpSync(path.join(REPOSITORY_ROOT, "files"), path.join(root, "files"), {recursive: true});
    for (const filename of [
        "LICENSE",
        "README.md",
        "info.json",
        "package.json",
        "screenshot.png",
        "stryker.config.json",
    ]) {
        fs.copyFileSync(path.join(REPOSITORY_ROOT, filename), path.join(root, filename));
    }
    return {
        appletRoot: path.join(root, "files", UUID),
        filesRoot: path.join(root, "files"),
        repositoryRoot: root,
    };
}

function png(width = 16, height = 16) {
    const contents = Buffer.alloc(24);
    Buffer.from("89504e470d0a1a0a", "hex").copy(contents);
    contents.write("IHDR", 12, "ascii");
    contents.writeUInt32BE(width, 16);
    contents.writeUInt32BE(height, 20);
    return contents;
}

test("artifact module validates the shipped tree without import side effects", () => {
    const messages = [];
    assert.equal(Artifacts.main(undefined, {log: (message) => messages.push(message)}), true);
    assert.deepEqual(messages, ["artifact validation: pass"]);
});

test("JSON reading rejects malformed artifacts and accepts valid input", (context) => {
    const root = temporaryDirectory();
    context.after(() => fs.rmSync(root, {recursive: true, force: true}));
    writeTree(root, {
        "bad.json": "{\"open\":",
        "valid.json": "{\"valid\":true}",
    });

    assert.throws(() => Artifacts.readJson(root, "bad.json"), SyntaxError);
    assert.deepEqual(Artifacts.readJson(root, "valid.json"), {valid: true});
});

test("control-character validation reports the exact source line", () => {
    assert.equal(Artifacts.controlCharacterLine("first\nsecond\u0001"), 2);
    assert.equal(Artifacts.controlCharacterLine("tab\tnewline\ncarriage\rreturn"), 0);
    assert.equal(Artifacts.validateSourceControls("plain\nsource", "valid.js"), true);
    assert.throws(
        () => Artifacts.validateSourceControls("first\nsecond\u0001", "bad.js"),
        /bad\.js:2 carries a control character/u,
    );
});

test("PNG and static-asset validators reject unsafe input", () => {
    assert.equal(Artifacts.validatePngIcon(png()), true);
    const invalidSignature = png();
    invalidSignature[0] = 0;
    assert.throws(() => Artifacts.validatePngIcon(invalidSignature));
    assert.throws(() => Artifacts.validatePngIcon(png(16, 15)));

    const validSvg = "<svg viewBox=\"0 0 16 16\"><path d=\"M0 0\"/></svg>";
    assert.equal(Artifacts.validateSvgIcon(validSvg), true);
    assert.throws(() => Artifacts.validateSvgIcon("<svg><path/></svg>"));
    assert.throws(() => Artifacts.validateSvgIcon(`prefix${validSvg}`));
    assert.throws(() => Artifacts.validateSvgIcon(`${validSvg}suffix`));
    assert.throws(
        () => Artifacts.validateSvgIcon("<svg viewBox=\"0 0 16 16\"><script/></svg>"),
    );

    assert.equal(Artifacts.validateStylesheet(""), true);
    assert.equal(Artifacts.validateStylesheet(".panel { color: white; }"), true);
    assert.throws(() => Artifacts.validateStylesheet(".panel { color: white;"));
    assert.throws(() => Artifacts.validateStylesheet(".panel { outline: none; }"));
});

test("payload validation accepts injected roots and rejects repository files", (context) => {
    const root = temporaryDirectory();
    context.after(() => fs.rmSync(root, {recursive: true, force: true}));
    const filesRoot = path.join(root, "files");
    const appletRoot = path.join(filesRoot, "cinnamon-xpuwlm@geraldo-netto");
    writeTree(appletRoot, {
        "applet.js": "module.exports = {};\n",
        "lib/module.js": "module.exports = {};\n",
    });
    const roots = {appletRoot, expectedTopLevel: ["applet.js", "lib"], filesRoot};

    assert.doesNotThrow(() => Artifacts.validatePayloadStructure(roots));
    assert.deepEqual(Artifacts.payloadPaths(appletRoot), [
        "applet.js",
        "lib",
        "lib/module.js",
    ]);
    assert.deepEqual(Artifacts.productionJavaScriptFiles(appletRoot), [
        path.join(appletRoot, "applet.js"),
        path.join(appletRoot, "lib/module.js"),
    ]);

    writeTree(appletRoot, {"lib/debug.tmp.safe": "allowed"});
    assert.doesNotThrow(() => Artifacts.validatePayloadStructure(roots));

    writeTree(appletRoot, {"lib/tests/debug.txt": "repository only"});
    assert.throws(() => Artifacts.validatePayloadStructure(roots));
    fs.rmSync(path.join(appletRoot, "lib/tests"), {recursive: true, force: true});

    writeTree(appletRoot, {"lib/nested/package.json": "{}"});
    assert.throws(() => Artifacts.validatePayloadStructure(roots));
    fs.rmSync(path.join(appletRoot, "lib/nested"), {recursive: true, force: true});

    writeTree(appletRoot, {"lib/debug.tmp": "temporary"});
    assert.throws(() => Artifacts.validatePayloadStructure({
        ...roots,
        expectedTopLevel: ["applet.js", "lib"],
    }));
});

test("JSON validation rejects an absent stage and every non-strict schema", (context) => {
    const missingRoot = temporaryDirectory();
    context.after(() => fs.rmSync(missingRoot, {recursive: true, force: true}));
    assert.throws(() => Artifacts.validateJsonArtifacts({
        appletRoot: path.join(missingRoot, "missing"),
        repositoryRoot: missingRoot,
    }));

    const roots = copiedRepository(context);
    const schemas = [
        "runtime-snapshot.schema.json",
        "artifact-qualification.schema.json",
        "workload-result.schema.json",
        "workload-manifest.schema.json",
        "runtime-command.schema.json",
        "runtime-acknowledgement.schema.json",
        "runtime-refusal.schema.json",
        "runtime-contract.schema.json",
    ];
    for (const filename of schemas) {
        const target = path.join(roots.appletRoot, filename);
        const schema = JSON.parse(fs.readFileSync(target, "utf8"));
        fs.writeFileSync(target, JSON.stringify({...schema, unknownStrictKeyword: true}));
        assert.throws(
            () => Artifacts.validateJsonArtifacts(roots),
            /strict mode: unknown keyword/u,
            filename,
        );
        fs.writeFileSync(target, JSON.stringify(schema));
    }
});

test("JSON validation refuses empty workloads, non-directories, and weak thresholds", (context) => {
    const emptyRoots = copiedRepository(context);
    fs.rmSync(path.join(emptyRoots.appletRoot, "workloads"), {recursive: true, force: true});
    fs.mkdirSync(path.join(emptyRoots.appletRoot, "workloads"));
    assert.throws(() => Artifacts.validateJsonArtifacts(emptyRoots));

    const fileRoots = copiedRepository(context);
    fs.writeFileSync(path.join(fileRoots.appletRoot, "workloads/not-a-directory"), "invalid");
    assert.throws(
        () => Artifacts.validateJsonArtifacts(fileRoots),
        /Workload must be a directory/u,
    );

    const thresholdRoots = copiedRepository(context);
    const strykerPath = path.join(thresholdRoots.repositoryRoot, "stryker.config.json");
    const stryker = JSON.parse(fs.readFileSync(strykerPath, "utf8"));
    stryker.thresholds.break = 79;
    fs.writeFileSync(strykerPath, JSON.stringify(stryker));
    assert.throws(() => Artifacts.validateJsonArtifacts(thresholdRoots));
});

test("workflow and JavaScript validation cannot become empty stages", (context) => {
    const root = temporaryDirectory();
    context.after(() => fs.rmSync(root, {recursive: true, force: true}));
    assert.throws(() => Artifacts.validateWorkflows({repositoryRoot: root}));

    const appletRoot = path.join(root, "applet");
    writeTree(appletRoot, {
        "applet.js": "function broken( {\n",
        "lib/module.js": "module.exports = {};\n",
    });
    assert.throws(() => Artifacts.validateJavaScriptSyntax({appletRoot}));

    fs.writeFileSync(path.join(appletRoot, "applet.js"), "require(\"fs\");\n");
    assert.throws(() => Artifacts.validateJavaScriptSyntax({appletRoot}));
});

test("static validation checks the stage and every shipped icon", (context) => {
    const missingRoot = temporaryDirectory();
    context.after(() => fs.rmSync(missingRoot, {recursive: true, force: true}));
    assert.throws(() => Artifacts.validateStaticAssets({
        appletRoot: path.join(missingRoot, "missing"),
        repositoryRoot: missingRoot,
    }));

    const roots = copiedRepository(context);
    fs.writeFileSync(
        path.join(roots.appletRoot, "icons/xpuwlm-symbolic.svg"),
        "<svg><script/></svg>",
    );
    assert.throws(() => Artifacts.validateStaticAssets(roots));
});
