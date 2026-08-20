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
    assert.throws(() => Artifacts.validatePngIcon(png(16, 15)), /must be square/u);
    // One header parser, one message: the icon and the Spice screenshot are
    // read by the same rule rather than by two that can drift apart.
    assert.throws(
        () => Artifacts.validatePngIcon(png().subarray(0, 20)),
        /PNG with an IHDR header/u,
    );

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

test("every JSON validator rejects an absent stage", (context) => {
    const missingRoot = temporaryDirectory();
    context.after(() => fs.rmSync(missingRoot, {recursive: true, force: true}));
    const roots = {
        appletRoot: path.join(missingRoot, "missing"),
        repositoryRoot: missingRoot,
    };

    assert.throws(() => Artifacts.validatePayloadMetadata(roots));
    assert.throws(() => Artifacts.validateSettingsAgreement(roots));
    assert.throws(() => Artifacts.validateRepositoryScripts(roots));
});

// The contracts used to fail under one name, which said which file was read
// rather than which agreement was broken.
test("each JSON validator passes on the shipped repository", (context) => {
    const roots = copiedRepository(context);

    assert.equal(Artifacts.validatePayloadMetadata(roots), true);
    assert.equal(Artifacts.validateSettingsAgreement(roots), true);
    assert.equal(Artifacts.validateRepositoryScripts(roots), true);
});

test("payload metadata validation refuses a mirrored contract schema reappearing", (context) => {
    // The helper reads six fields to draw an icon; the client validates the
    // document. A schema copy here would be a second reader to keep in parity.
    const roots = copiedRepository(context);
    fs.writeFileSync(
        path.join(roots.appletRoot, "runtime-snapshot.schema.json"),
        JSON.stringify({type: "object"}),
    );

    assert.throws(
        () => Artifacts.validatePayloadMetadata(roots),
        /must not ship mirrored contract schemas/u,
    );
});

test("settings validation pins the settings default to the reader's own path", (context) => {
    const roots = copiedRepository(context);
    const settingsPath = path.join(roots.appletRoot, "settings-schema.json");
    const settings = JSON.parse(fs.readFileSync(settingsPath, "utf8"));
    settings["runtime-state-path"].default = "~/somewhere/else.json";
    fs.writeFileSync(settingsPath, JSON.stringify(settings));

    assert.throws(() => Artifacts.validateSettingsAgreement(roots));
});

test("settings validation pins the slider's bounds to the applet's clamp", (context) => {
    // A maximum above the clamp is a slider that stops having an effect
    // partway along, and reports nothing while it does.
    const roots = copiedRepository(context);
    const settingsPath = path.join(roots.appletRoot, "settings-schema.json");
    const settings = JSON.parse(fs.readFileSync(settingsPath, "utf8"));
    settings["refresh-interval"].max = 600;
    fs.writeFileSync(settingsPath, JSON.stringify(settings));

    assert.throws(() => Artifacts.validateSettingsAgreement(roots));
});

test("settings validation refuses a key the applet binds but the schema drops", (context) => {
    const roots = copiedRepository(context);
    const settingsPath = path.join(roots.appletRoot, "settings-schema.json");
    const settings = JSON.parse(fs.readFileSync(settingsPath, "utf8"));
    delete settings["runtime-state-path"];
    fs.writeFileSync(settingsPath, JSON.stringify(settings));

    assert.throws(() => Artifacts.validateSettingsAgreement(roots));
});

// The gate used to ask one direction only, and a control the applet never
// reads is worse than a missing one: it shows, it moves, and nothing happens.
test("settings validation refuses a value key the schema ships and nothing binds", (context) => {
    const roots = copiedRepository(context);
    const settingsPath = path.join(roots.appletRoot, "settings-schema.json");
    const shipped = JSON.parse(fs.readFileSync(settingsPath, "utf8"));

    fs.writeFileSync(settingsPath, JSON.stringify({
        ...shipped,
        "panel-tint": {type: "colorchooser", default: "#000000", description: "Tint"},
    }));
    assert.throws(
        () => Artifacts.validateSettingsAgreement(roots),
        /the applet never binds: panel-tint/u,
    );

    // A label stores nothing, so nothing binds it and nothing should demand it.
    fs.writeFileSync(settingsPath, JSON.stringify({
        ...shipped,
        "extra-help": {type: "label", description: "Help"},
    }));
    assert.equal(Artifacts.validateSettingsAgreement(roots), true);
});

test("the bound keys are read from the applet rather than written out again", (context) => {
    const roots = copiedRepository(context);
    const source = fs.readFileSync(path.join(roots.appletRoot, "applet.js"), "utf8");

    assert.deepEqual(
        Artifacts.boundSettingsKeys(source),
        ["refresh-interval", "runtime-state-path"],
    );
});

// The applet cannot import the packaging module — Cinnamon loads it — so its
// UUID is a literal, and a literal nothing checks is a settings instance and a
// log prefix naming an applet that is not this one.
test("the applet's own UUID is held to the one the payload carries", (context) => {
    const roots = copiedRepository(context);
    const appletPath = path.join(roots.appletRoot, "applet.js");
    const source = fs.readFileSync(appletPath, "utf8");

    assert.equal(Artifacts.appletUuid(source), "cinnamon-xpuwlm@geraldo-netto");
    assert.throws(() => Artifacts.appletUuid("const UUID = elsewhere;"), assert.AssertionError);

    fs.writeFileSync(
        appletPath,
        source.replace(
            'const UUID = "cinnamon-xpuwlm@geraldo-netto";',
            'const UUID = "cinnamon-xpuwlm@someone-else";',
        ),
    );
    assert.throws(
        () => Artifacts.validatePayloadMetadata(roots),
        /applet\.js names a UUID the payload does not carry/,
    );
});

// A brace or a class name in the sheet's own prose is not a rule. The shipped
// sheet opens with an eight-line comment, so both gates read past it.
test("the stylesheet gates read the rules and not the prose around them", () => {
    assert.equal(
        Artifacts.stylesheetDeclarations("/* { .xpuwlm-panel-ghost */\n.a { color: red; }\n"),
        "\n.a { color: red; }\n",
    );
    assert.equal(Artifacts.validateStylesheet("/* } */\n.a { color: red; }\n"), true);
    assert.deepEqual(Artifacts.styledStatuses("/* .xpuwlm-panel-ghost */\n.xpuwlm-panel-online {}"), [
        "online",
    ]);
    assert.throws(() => Artifacts.validateStylesheet(".a { color: red;\n"), assert.AssertionError);
});

test("layout validation refuses a page, section or key that does not resolve", (context) => {
    const roots = copiedRepository(context);
    const settingsPath = path.join(roots.appletRoot, "settings-schema.json");
    assert.equal(Artifacts.validateSettingsLayout(roots), true);

    const settings = JSON.parse(fs.readFileSync(settingsPath, "utf8"));
    settings.layout["polling-section"].keys = ["refresh-rate"];
    fs.writeFileSync(settingsPath, JSON.stringify(settings));
    assert.throws(
        () => Artifacts.validateSettingsLayout(roots),
        /names a key the schema does not declare/u,
    );

    settings.layout.pages.push("absent-page");
    fs.writeFileSync(settingsPath, JSON.stringify(settings));
    assert.throws(
        () => Artifacts.validateSettingsLayout(roots),
        /names a key the schema does not declare|names a page it does not declare/u,
    );
});

test("layout validation refuses a shipped key no page shows", (context) => {
    const roots = copiedRepository(context);
    const settingsPath = path.join(roots.appletRoot, "settings-schema.json");
    const settings = JSON.parse(fs.readFileSync(settingsPath, "utf8"));
    settings["stray-key"] = {type: "entry", default: "", description: "Stray"};
    fs.writeFileSync(settingsPath, JSON.stringify(settings));

    assert.throws(
        () => Artifacts.validateSettingsLayout(roots),
        /declares a key no page shows/u,
    );
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

test("workflow validation preserves secure downloads and inert installs", (context) => {
    const root = temporaryDirectory();
    context.after(() => fs.rmSync(root, {recursive: true, force: true}));
    const workflowRoot = path.join(root, ".github", "workflows");
    fs.mkdirSync(workflowRoot, {recursive: true});
    const originals = new Map();
    for (const filename of ["applet-quality.yml", "dependency-audit.yml"]) {
        const source = path.join(REPOSITORY_ROOT, ".github", "workflows", filename);
        const target = path.join(workflowRoot, filename);
        const contents = fs.readFileSync(source, "utf8");
        originals.set(filename, contents);
        fs.writeFileSync(target, contents);
    }
    assert.doesNotThrow(() => Artifacts.validateWorkflows({repositoryRoot: root}));

    for (const [filename, secure, weakened] of [
        [
            "applet-quality.yml",
            "--proto '=https' --proto-redir '=https'",
            "--proto '=https'",
        ],
        ["applet-quality.yml", "npm ci --ignore-scripts", "npm ci"],
        ["dependency-audit.yml", "npm ci --ignore-scripts", "npm ci"],
        // Not a weakened flag but a dropped stage, which is the other way a
        // workflow stops checking: `test:cjs` runs nowhere else.
        ["applet-quality.yml", "run: npm run test:cjs", "run: echo skipped"],
    ]) {
        const target = path.join(workflowRoot, filename);
        fs.writeFileSync(target, originals.get(filename).replace(secure, weakened));
        assert.throws(() => Artifacts.validateWorkflows({repositoryRoot: root}));
        fs.writeFileSync(target, originals.get(filename));
    }
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

// A list of icon names beside the icons only holds what someone remembered to
// add to it. Read the directory instead, and a new icon is validated the
// moment it ships rather than the moment the list is updated.
test("every icon the payload carries is validated, listed or not", (context) => {
    const roots = copiedRepository(context);
    const added = path.join(roots.appletRoot, "icons/xpuwlm-invented-symbolic.svg");

    fs.writeFileSync(added, "<svg viewBox=\"0 0 16 16\"><script/></svg>");
    assert.throws(() => Artifacts.validateStaticAssets(roots));

    fs.writeFileSync(added, "<svg viewBox=\"0 0 16 16\"><path d=\"M0 0h16v16H0z\"/></svg>");
    assert.equal(Artifacts.validateStaticAssets(roots), undefined);
    assert.equal(Artifacts.payloadIconNames(roots.appletRoot).includes(path.basename(added)), true);

    fs.writeFileSync(path.join(roots.appletRoot, "icons/notes.txt"), "not an icon");
    assert.throws(() => Artifacts.validateStaticAssets(roots), /not an icon/u);
});

// The status icons are the correspondence the panel cannot draw without, so
// they are demanded of the payload by name — asked of panel-status.js itself.
test("a status the panel can ask for must name a shipped icon", (context) => {
    const roots = copiedRepository(context);
    const required = Artifacts.requiredIconNames(roots.appletRoot);

    assert.deepEqual(required, [
        "xpuwlm-status-attention-symbolic.svg",
        "xpuwlm-status-detected-symbolic.svg",
        "xpuwlm-status-online-symbolic.svg",
        "xpuwlm-status-paused-symbolic.svg",
        "xpuwlm-status-unavailable-symbolic.svg",
    ]);

    fs.rmSync(path.join(roots.appletRoot, "icons", required[0]));
    assert.throws(() => Artifacts.validateStaticAssets(roots), /does not ship/u);
});

test("the payload comparator orders names deterministically", () => {
    // The staged inventory is compared name by name, so equal, before, and
    // after all have to answer — a comparator that only ever returns -1 sorts
    // nothing and would let an inventory drift through unnoticed.
    assert.equal(Artifacts.compareText("same", "same"), 0);
    assert.equal(Artifacts.compareText("a", "b") < 0, true);
    assert.equal(Artifacts.compareText("b", "a") > 0, true);
});

// The icon is only half of what a status needs. The applet puts
// `xpuwlm-panel-<status>` on its actor, and the stylesheet is the only thing
// that colours it: a status with no rule draws in the fallback grey that is
// nearly the panel background on a dark theme.
test("a status the panel can ask for must name a colour rule, and a rule a status", () => {
    const shipped = ".xpuwlm-panel-online .system-status-icon { color: symbolic-success; }";

    assert.deepEqual(Artifacts.styledStatuses(shipped), ["online"]);
    assert.equal(Artifacts.validateStatusColours(shipped, ["online"]), true);
    assert.throws(
        () => Artifacts.validateStatusColours(shipped, ["online", "attention"]),
        /Every panel status needs its own colour rule/u,
    );
    assert.throws(
        () => Artifacts.validateStatusColours(`${shipped}\n.xpuwlm-panel-retired {}`, ["online"]),
        /Every panel status needs its own colour rule/u,
    );
});

test("a shipped stylesheet missing a status colour fails the artifact gate", (context) => {
    const roots = copiedRepository(context);
    const stylesheet = path.join(roots.appletRoot, "stylesheet.css");
    const shipped = fs.readFileSync(stylesheet, "utf8");

    fs.writeFileSync(stylesheet, shipped.replace(".xpuwlm-panel-paused", ".xpuwlm-panel-held"));
    assert.throws(() => Artifacts.validateStaticAssets(roots), /colour rule/u);

    fs.writeFileSync(stylesheet, shipped);
    assert.equal(Artifacts.validateStaticAssets(roots), undefined);
});

// The hole this pair closes: `lib/` was listed one level deep while the
// packager ships via a recursive walk, so a module one directory down was
// syntax-checked by nothing and shipped regardless.
test("a payload module one directory down is checked like every other", (context) => {
    const roots = copiedRepository(context);
    writeTree(roots.appletRoot, {
        "lib/nested/leak.js": `module.exports = {bel: "${String.fromCharCode(7)}"};\n`,
    });

    assert.equal(
        Artifacts.productionJavaScriptFiles(roots.appletRoot)
            .map((filename) => path.relative(roots.appletRoot, filename).split(path.sep).join("/"))
            .includes("lib/nested/leak.js"),
        true,
    );
    assert.throws(
        () => Artifacts.validateJavaScriptSyntax(roots),
        /lib\/nested\/leak\.js:1 carries a control character/u,
    );
});

// And the host-module ban, asked of the resolved require edges: the regular
// expression it replaces refused `require("node:fs")` and accepted the same
// call with a space inside the parentheses.
test("a payload module reaching outside the applet fails however it is spelled", (context) => {
    const roots = copiedRepository(context);
    writeTree(roots.appletRoot, {
        "lib/nested/host.js": "const fs = require( \"node:fs\" );\nmodule.exports = {fs};\n",
    });

    assert.throws(
        () => Artifacts.validateJavaScriptSyntax(roots),
        /lib\/nested\/host\.js reaches outside the applet: node:fs/u,
    );
});

test("the CJS smoke command must name the payload root, never a directory level", (context) => {
    const roots = copiedRepository(context);
    const packageJsonPath = path.join(roots.repositoryRoot, "package.json");
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));
    assert.equal(Artifacts.validateRepositoryScripts(roots), true);

    packageJson.scripts["test:cjs"]
        = `"\${XPUWLM_CJS:-cjs}" tests/cjs/production-smoke.js files/${UUID}/applet.js `
        + `files/${UUID}/lib/*.js`;
    fs.writeFileSync(packageJsonPath, JSON.stringify(packageJson));
    assert.throws(
        () => Artifacts.validateRepositoryScripts(roots),
        /globs a directory level/u,
    );
});
