"use strict";

const assert = require("node:assert/strict");
const Ajv2020 = require("ajv/dist/2020").default;
const childProcess = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const UUID = "cinnamon-tpuwm@geraldo-netto";
const repositoryRoot = path.resolve(__dirname, "..");
const filesRoot = path.join(repositoryRoot, "files");
const appletRoot = path.join(filesRoot, UUID);
const PAYLOAD_TOP_LEVEL = Object.freeze([
    "applet.js",
    "domain.js",
    "failure-log-backoff.js",
    "failure-reporter.js",
    "icon.png",
    "icons",
    "lib",
    "manager.js",
    "metadata.json",
    "runtime-gateway.js",
    "runtime-snapshot-schema-validator.js",
    "runtime-snapshot.schema.json",
    "settings-schema.json",
    "snapshot-validator.js",
    "stylesheet.css",
    "view-model.js",
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
    "stryker.config.json",
]);

function readJson(root, relativePath) {
    return JSON.parse(fs.readFileSync(path.join(root, relativePath), "utf8"));
}

function payloadPaths(directory = appletRoot, prefix = "") {
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

function validatePayloadStructure() {
    const filesEntries = fs.readdirSync(filesRoot, {withFileTypes: true});
    assert.deepEqual(filesEntries.map((entry) => entry.name).sort(), [UUID]);
    assert.equal(filesEntries[0].isDirectory(), true);
    assert.deepEqual(fs.readdirSync(appletRoot).sort(), [...PAYLOAD_TOP_LEVEL].sort());

    for (const relativePath of payloadPaths()) {
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

function productionJavaScriptFiles() {
    const rootModules = fs.readdirSync(appletRoot)
        .filter((name) => name.endsWith(".js"))
        .map((name) => path.join(appletRoot, name));
    const libraryDirectory = path.join(appletRoot, "lib");
    const libraries = fs.readdirSync(libraryDirectory)
        .filter((name) => name.endsWith(".js"))
        .map((name) => path.join(libraryDirectory, name));
    return [...rootModules, ...libraries];
}

function validateJsonArtifacts() {
    const metadata = readJson(appletRoot, "metadata.json");
    const settings = readJson(appletRoot, "settings-schema.json");
    const schema = readJson(appletRoot, "runtime-snapshot.schema.json");
    const packageJson = readJson(repositoryRoot, "package.json");
    const stryker = readJson(repositoryRoot, "stryker.config.json");
    const Domain = require(path.join(appletRoot, "lib/domain.js"));

    assert.equal(metadata.uuid, UUID);
    assert.equal(metadata.uuid, path.basename(appletRoot));
    assert.equal(packageJson.version, metadata.version);
    assert.equal(metadata["max-instances"], 1);
    assert.ok(metadata["cinnamon-version"].includes("6.6"));
    assert.equal(schema.properties.version.const, Domain.SNAPSHOT_VERSION);
    assert.doesNotThrow(() => new Ajv2020({strict: true}).compile(schema));
    assert.equal(settings["show-panel-label"].default, false);
    assert.deepEqual(
        Object.keys(settings["profile-state"].default.profiles),
        Domain.PROFILE_DEFINITIONS.map((profile) => profile.id),
    );
    assert.equal(packageJson.scripts.test.includes("test:mutation"), true);
    assert.equal(packageJson.scripts.test.includes("test:visual"), true);
    assert.equal(packageJson.devDependencies.ajv, "8.18.0");
    assert.equal(packageJson.scripts["test:visual"], "node --test tests/visual/*.test.js");
    assert.equal(packageJson.scripts["test:mutation-target"].includes("tests/visual"), false);
    assert.equal(stryker.thresholds.break >= 80, true);
}

function validateJavaScriptSyntax() {
    for (const filename of productionJavaScriptFiles()) {
        childProcess.execFileSync(process.execPath, ["--check", filename], {stdio: "pipe"});
        const source = fs.readFileSync(filename, "utf8");
        assert.equal(/require\(["'](?:node:)?(?:fs|child_process|path)["']\)/.test(source), false);
        assert.equal(/\bBuffer\b/.test(source), false);
    }
}

function validateStaticAssets() {
    const iconNames = [
        "tpuwm-symbolic.svg",
        "tpuwm-symbolic-v2.svg",
        "tpuwm-status-online-symbolic.svg",
        "tpuwm-status-detected-symbolic.svg",
        "tpuwm-status-attention-symbolic.svg",
        "tpuwm-status-paused-symbolic.svg",
        "tpuwm-status-unavailable-symbolic.svg",
    ];
    const css = fs.readFileSync(path.join(appletRoot, "stylesheet.css"), "utf8");
    const png = fs.readFileSync(path.join(appletRoot, "icon.png"));
    assert.deepEqual(png.subarray(0, 8), Buffer.from("89504e470d0a1a0a", "hex"));
    assert.equal(png.subarray(12, 16).toString("ascii"), "IHDR");
    assert.equal(png.readUInt32BE(16), png.readUInt32BE(20));
    for (const iconName of iconNames) {
        const svg = fs.readFileSync(path.join(appletRoot, "icons", iconName), "utf8");
        assert.match(svg, /^<svg[^>]*viewBox="0 0 16 16"[^>]*>[\s\S]*<\/svg>\s*$/);
        assert.doesNotMatch(svg, /<(?:script|style|text|image)\b/i);
    }
    assert.equal((css.match(/{/g) || []).length, (css.match(/}/g) || []).length);
    assert.equal(css.includes("outline: none"), false);
}

validatePayloadStructure();
validateJsonArtifacts();
validateJavaScriptSyntax();
validateStaticAssets();
console.log("artifact validation: pass");
