"use strict";

const assert = require("node:assert/strict");
const childProcess = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const UUID = "cinnamon-xpuwlm@geraldo-netto";
const repositoryRoot = path.resolve(__dirname, "..");
const filesRoot = path.join(repositoryRoot, "files");
const appletRoot = path.join(filesRoot, UUID);

// The helper ships no shared validation module any more — everything it used
// to validate moved to the Python client, which validates against the
// canonical schemas rather than a mirror of them. One comparator is all this
// script still needed from it.
function compareText(left, right) {
    if (left === right) {
        return 0;
    }
    return left < right ? -1 : 1;
}
const PAYLOAD_TOP_LEVEL = Object.freeze([
    "applet.js",
    // Cinnamon resolves a nested CommonJS import from the applet root, so the
    // one module lib/ imports from lib/ needs its bridge here.
    "i18n.js",
    "icon.png",
    "icons",
    "lib",
    "LICENSE",
    "metadata.json",
    "po",
    "settings-schema.json",
    "stylesheet.css",
]);
const FORBIDDEN_PAYLOAD_SEGMENTS = new Set([
    ".cache",
    ".stryker-tmp",
    "__pycache__",
    "build",
    "coverage",
    "design",
    "dist",
    "mutation-report",
    "node_modules",
    "prototype",
    "prototypes",
    "scripts",
    "tests",
]);
const FORBIDDEN_PAYLOAD_FILES = new Set([
    ".gitignore",
    "eslint.config.cjs",
    "package-lock.json",
    "package.json",
    "stryker.config.cjs",
]);

function readJson(root, relativePath) {
    return JSON.parse(fs.readFileSync(path.join(root, relativePath), "utf8"));
}

function defaultRoots() {
    return {appletRoot, filesRoot, repositoryRoot};
}

function payloadPaths(directory, prefix = "") {
    const paths = [];
    for (const entry of fs.readdirSync(directory, {withFileTypes: true})) {
        const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
        assert.equal(entry.isSymbolicLink(), false, `Payload symlink is forbidden: ${relativePath}`);
        assert.equal(
            entry.isDirectory() || entry.isFile(),
            true,
            `Payload entry must be a regular file or directory: ${relativePath}`,
        );
        paths.push(relativePath);
        if (entry.isDirectory()) {
            paths.push(...payloadPaths(path.join(directory, entry.name), relativePath));
        }
    }
    return paths;
}

function validatePayloadStructure({
    appletRoot: targetAppletRoot,
    expectedTopLevel = PAYLOAD_TOP_LEVEL,
    filesRoot: targetFilesRoot,
}) {
    const filesEntries = fs.readdirSync(targetFilesRoot, {withFileTypes: true});
    assert.deepEqual(filesEntries.map((entry) => entry.name).sort(compareText), [UUID]);
    assert.equal(filesEntries[0].isDirectory(), true);
    assert.deepEqual(
        fs.readdirSync(targetAppletRoot).sort(compareText),
        [...expectedTopLevel].sort(compareText),
    );

    for (const relativePath of payloadPaths(targetAppletRoot)) {
        const segments = relativePath.split("/");
        assert.equal(
            segments.some((segment) => FORBIDDEN_PAYLOAD_SEGMENTS.has(segment)),
            false,
            `Repository-only directory leaked into payload: ${relativePath}`,
        );
        assert.equal(
            FORBIDDEN_PAYLOAD_FILES.has(segments.at(-1)),
            false,
            `Repository-only file leaked into payload: ${relativePath}`,
        );
        assert.equal(/\.(?:log|pyc|temp|tmp)$/u.test(relativePath), false);
    }
}

function productionJavaScriptFiles(targetAppletRoot) {
    const rootModules = fs.readdirSync(targetAppletRoot)
        .filter((name) => name.endsWith(".js"))
        .map((name) => path.join(targetAppletRoot, name));
    const libraryDirectory = path.join(targetAppletRoot, "lib");
    const libraries = fs.readdirSync(libraryDirectory)
        .filter((name) => name.endsWith(".js"))
        .map((name) => path.join(libraryDirectory, name));
    return [...rootModules, ...libraries];
}

function validateJsonArtifacts({
    appletRoot: targetAppletRoot,
    repositoryRoot: targetRepositoryRoot,
}) {
    const metadata = readJson(targetAppletRoot, "metadata.json");
    const settings = readJson(targetAppletRoot, "settings-schema.json");
    const packageJson = readJson(targetRepositoryRoot, "package.json");

    assert.equal(metadata.uuid, UUID);
    assert.equal(metadata.uuid, path.basename(targetAppletRoot));
    assert.equal(packageJson.version, metadata.version);
    assert.equal(metadata["max-instances"], 1);
    assert.ok(metadata["cinnamon-version"].includes("6.6"));
    // The helper ships no schema copies. It reads six fields out of the
    // published snapshot to draw an icon; the client validates the document
    // against the canonical schemas, and mirroring them here is exactly the
    // drift this split removed.
    assert.equal(
        fs.readdirSync(targetAppletRoot).some((name) => name.endsWith(".schema.json")),
        false,
        "The helper must not ship mirrored contract schemas",
    );
    assert.equal(settings["show-panel-label"].default, false);
    assert.equal(
        settings["runtime-state-path"].default,
        require(path.join(targetAppletRoot, "lib/snapshot-reader.js")).RUNTIME_STATE_PATH,
    );
    const potFile = fs.readFileSync(path.join(targetAppletRoot, "po", `${UUID}.pot`), "utf8");
    assert.match(potFile, /"Content-Type: text\/plain; charset=UTF-8\\n"/u);
    assert.equal(potFile.includes(`Project-Id-Version: ${UUID}`), true);
    assert.equal(packageJson.scripts["test:ci"], [
        "npm run lint",
        "npm run test:syntax",
        "npm run test:coverage",
        "npm run test:fuzz",
        "npm run test:visual",
    ].join(" && "));
    assert.equal(packageJson.scripts.test.includes("test:visual"), true);
    assert.equal(packageJson.scripts["test:contract"], "node --test tests/contract/*.test.js");
    assert.equal(packageJson.devDependencies.ajv, "8.18.0");
    assert.equal(packageJson.scripts["test:visual"], "node --test tests/visual/*.test.js");
    assert.equal(packageJson.scripts["test:local"], "XPUWLM_SKIP_HOST_GATES=1 npm test");
}

function readWorkflow(root, name) {
    return fs.readFileSync(path.join(root, ".github/workflows", name), "utf8");
}

function validateWorkflows({repositoryRoot: targetRepositoryRoot}) {
    const quality = readWorkflow(targetRepositoryRoot, "applet-quality.yml");
    const audit = readWorkflow(targetRepositoryRoot, "dependency-audit.yml");

    assert.match(quality, /npm audit --omit=dev --audit-level=low/);
    assert.doesNotMatch(
        quality,
        /npm audit(?! --omit=dev)/,
        "Development-only advisories must not gate the applet build",
    );
    assert.match(quality, /run: npm run test:ci/);
    assert.doesNotMatch(quality, /run: npm test(?:\s|$)/mu);
    assert.doesNotMatch(quality, /XPUWLM_SKIP_HOST_GATES/);
    assert.equal(
        [...quality.matchAll(/curl --fail --location --proto '=https' --proto-redir '=https'/gu)].length,
        2,
    );
    assert.match(quality, /run: npm ci --ignore-scripts$/mu);

    assert.match(audit, /^ {2}schedule:$/mu);
    assert.match(audit, /^ {2}workflow_dispatch:$/mu);
    assert.match(audit, /run: npm audit --audit-level=low$/mu);
    assert.match(audit, /run: npm ci --ignore-scripts$/mu);
    assert.doesNotMatch(audit, /run: npm test/);
}

// A control character inside a string literal is invisible in a diff, accepted
// by Node, and refused by the SpiderMonkey parser Cinnamon actually runs — so
// it ships a module the desktop cannot load while every Node test passes. One
// reached a shipped source this way; the cjs smoke caught it, but that gate is
// not part of `test:ci` and needs cjs installed, so the cheap check runs here.
// Tab, newline, and carriage return are the only control characters a source
// file may contain; everything else below 0x20 is invisible in a diff and
// refused by the parser Cinnamon runs.
const PERMITTED_CONTROL_CODES = new Set([9, 10, 13]);

function controlCharacterLine(source) {
    let line = 1;
    for (const character of source) {
        const code = character.codePointAt(0);
        if (code === 10) {
            line += 1;
        } else if (code < 0x20 && !PERMITTED_CONTROL_CODES.has(code)) {
            return line;
        }
    }
    return 0;
}

function validateSourceControls(source, filename) {
    const line = controlCharacterLine(source);
    assert.equal(
        line,
        0,
        `${filename}:${line} carries a control character Cinnamon's parser refuses`,
    );
    return true;
}

function validateJavaScriptSyntax({appletRoot: targetAppletRoot}) {
    for (const filename of productionJavaScriptFiles(targetAppletRoot)) {
        childProcess.execFileSync(process.execPath, ["--check", filename], {stdio: "pipe"});
        const source = fs.readFileSync(filename, "utf8");
        assert.equal(/require\(["'](?:node:)?(?:fs|child_process|path)["']\)/.test(source), false);
        assert.equal(/\bBuffer\b/.test(source), false);
        validateSourceControls(source, filename);
    }
}

function validatePngIcon(png) {
    assert.deepEqual(png.subarray(0, 8), Buffer.from("89504e470d0a1a0a", "hex"));
    assert.equal(png.subarray(12, 16).toString("ascii"), "IHDR");
    assert.equal(png.readUInt32BE(16), png.readUInt32BE(20));
    return true;
}

function validateSvgIcon(svg) {
    assert.match(svg, /^<svg[^>]*viewBox="0 0 16 16"[^>]*>[\s\S]*<\/svg>\s*$/);
    assert.doesNotMatch(svg, /<(?:script|style|text|image)\b/i);
    return true;
}

function validateStylesheet(css) {
    assert.equal((css.match(/{/g) || []).length, (css.match(/}/g) || []).length);
    assert.equal(css.includes("outline: none"), false);
    return true;
}

function validateStaticAssets({
    appletRoot: targetAppletRoot,
    repositoryRoot: targetRepositoryRoot,
}) {
    const iconNames = [
        "xpuwlm-symbolic.svg",
        "xpuwlm-v2-symbolic.svg",
        "xpuwlm-device-symbolic.svg",
        "xpuwlm-sliders-symbolic.svg",
        "xpuwlm-status-online-symbolic.svg",
        "xpuwlm-status-detected-symbolic.svg",
        "xpuwlm-status-attention-symbolic.svg",
        "xpuwlm-status-paused-symbolic.svg",
        "xpuwlm-status-unavailable-symbolic.svg",
    ];
    const css = fs.readFileSync(path.join(targetAppletRoot, "stylesheet.css"), "utf8");
    const png = fs.readFileSync(path.join(targetAppletRoot, "icon.png"));
    validatePngIcon(png);
    for (const iconName of iconNames) {
        const svg = fs.readFileSync(path.join(targetAppletRoot, "icons", iconName), "utf8");
        validateSvgIcon(svg);
    }
    validateStylesheet(css);
    const spice = require("./package-applet.js").inspectSpiceSources(
        targetRepositoryRoot,
        targetAppletRoot,
    );
    assert.equal(spice.info.author, "geraldo-netto");
    assert.equal(spice.info.license, "MIT");
}

function validateArtifacts(roots) {
    validatePayloadStructure(roots);
    validateJsonArtifacts(roots);
    validateWorkflows(roots);
    validateJavaScriptSyntax(roots);
    validateStaticAssets(roots);
    return true;
}

function main(roots = defaultRoots(), logger = console) {
    validateArtifacts(roots);
    logger.log("artifact validation: pass");
    return true;
}

if (require.main === module) {
    main();
}

module.exports = {
    compareText,
    controlCharacterLine,
    defaultRoots,
    main,
    payloadPaths,
    productionJavaScriptFiles,
    readJson,
    readWorkflow,
    validateArtifacts,
    validateJavaScriptSyntax,
    validateJsonArtifacts,
    validatePayloadStructure,
    validatePngIcon,
    validateSourceControls,
    validateStaticAssets,
    validateStylesheet,
    validateSvgIcon,
    validateWorkflows,
};
