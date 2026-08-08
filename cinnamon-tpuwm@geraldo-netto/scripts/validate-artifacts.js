"use strict";

const assert = require("node:assert/strict");
const childProcess = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");

function readJson(relativePath) {
    return JSON.parse(fs.readFileSync(path.join(root, relativePath), "utf8"));
}

function productionJavaScriptFiles() {
    const rootModules = fs.readdirSync(root)
        .filter((name) => name.endsWith(".js"))
        .map((name) => path.join(root, name));
    const libraryDirectory = path.join(root, "lib");
    const libraries = fs.readdirSync(libraryDirectory)
        .filter((name) => name.endsWith(".js"))
        .map((name) => path.join(libraryDirectory, name));
    return [...rootModules, ...libraries];
}

function validateJsonArtifacts() {
    const metadata = readJson("metadata.json");
    const settings = readJson("settings-schema.json");
    const schema = readJson("runtime-snapshot.schema.json");
    const packageJson = readJson("package.json");
    const stryker = readJson("stryker.config.json");
    const Domain = require(path.join(root, "lib/domain.js"));

    assert.equal(metadata.uuid, path.basename(root));
    assert.equal(metadata["max-instances"], 1);
    assert.ok(metadata["cinnamon-version"].includes("6.6"));
    assert.equal(schema.properties.version.const, Domain.SNAPSHOT_VERSION);
    assert.equal(settings["show-panel-label"].default, false);
    assert.deepEqual(
        Object.keys(settings["profile-state"].default.profiles),
        Domain.PROFILE_DEFINITIONS.map((profile) => profile.id),
    );
    assert.equal(packageJson.scripts.test.includes("test:mutation"), true);
    assert.equal(packageJson.scripts.test.includes("test:visual"), true);
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
    const css = fs.readFileSync(path.join(root, "stylesheet.css"), "utf8");
    for (const iconName of iconNames) {
        const svg = fs.readFileSync(path.join(root, "icons", iconName), "utf8");
        assert.match(svg, /^<svg[^>]*viewBox="0 0 16 16"[^>]*>[\s\S]*<\/svg>\s*$/);
        assert.doesNotMatch(svg, /<(?:script|style|text|image)\b/i);
    }
    assert.equal((css.match(/{/g) || []).length, (css.match(/}/g) || []).length);
    assert.equal(css.includes("outline: none"), false);
}

validateJsonArtifacts();
validateJavaScriptSyntax();
validateStaticAssets();
console.log("artifact validation: pass");
