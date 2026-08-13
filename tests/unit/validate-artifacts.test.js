"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const Artifacts = require("../../scripts/validate-artifacts.js");

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
    writeTree(appletRoot, {"lib/debug.tmp": "temporary"});
    assert.throws(() => Artifacts.validatePayloadStructure({
        ...roots,
        expectedTopLevel: ["applet.js", "lib"],
    }));
});
