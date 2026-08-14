"use strict";

const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const APPLET_ROOT = path.join(ROOT, "files/cinnamon-xpuwlm@geraldo-netto");
const LIBRARY_ROOT = path.join(APPLET_ROOT, "lib");
const TEST_ROOT = path.join(ROOT, "tests");
const TEST_FAMILIES = Object.freeze([
    "contract",
    "fuzz",
    "integration",
    "regression",
    "unit",
]);
const TOOL_SOURCES = Object.freeze([
    "check-workload-manifests.js",
    "generate-pot.js",
    "generate-snapshot-contract.js",
    "package-applet.js",
    "package-workload-plugin.js",
    "validate-artifacts.js",
]);

function compareText(left, right) {
    return left < right ? -1 : left > right ? 1 : 0;
}

function relativePath(file) {
    return path.relative(ROOT, file).split(path.sep).join("/");
}

function mutationSources() {
    return [
        path.join(APPLET_ROOT, "applet.js"),
        ...fs.globSync(path.join(LIBRARY_ROOT, "*.js")).sort(compareText),
        ...TOOL_SOURCES.map((basename) => path.join(ROOT, "scripts", basename)),
    ].map(relativePath);
}

function focusedTestFiles() {
    return TEST_FAMILIES.flatMap((family) => (
        fs.globSync(path.join(TEST_ROOT, family, "*.test.js"))
    )).sort(compareText);
}

function focusedTests(source, testFiles = focusedTestFiles()) {
    const basename = path.basename(source, ".js");
    return testFiles.filter((testFile) => {
        const testBasename = path.basename(testFile, ".test.js");
        return testBasename.startsWith(basename)
            || fs.readFileSync(testFile, "utf8").includes(basename);
    }).map(relativePath);
}

function mutationTargets() {
    const testFiles = focusedTestFiles();
    return mutationSources().map((source) => ({
        source,
        tests: focusedTests(source, testFiles),
    }));
}

module.exports = {
    TEST_FAMILIES,
    TOOL_SOURCES,
    focusedTests,
    mutationSources,
    mutationTargets,
};
