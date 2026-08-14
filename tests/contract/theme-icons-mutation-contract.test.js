"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const ROOT = path.resolve(__dirname, "../..");
const packageJson = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
const mainConfig = JSON.parse(fs.readFileSync(path.join(ROOT, "stryker.config.json"), "utf8"));
const config = JSON.parse(fs.readFileSync(
    path.join(ROOT, "stryker.theme-icons.config.json"),
    "utf8",
));
const TARGETS = Object.freeze([
    "files/cinnamon-xpuwlm@geraldo-netto/applet.js:72-74",
    "files/cinnamon-xpuwlm@geraldo-netto/applet.js:627-636",
    "files/cinnamon-xpuwlm@geraldo-netto/applet.js:206-225",
]);
const SCRIPTS = Object.freeze([
    "test:mutation:theme-icon-name",
    "test:mutation:theme-icon-state",
    "test:mutation:theme-icon-initial",
]);
const SIGNATURES = Object.freeze([
    /^function panelIconName\(status\)/u,
    /^\s+_setPanelIcon\(status\)/u,
    /^\s+_createSettings\(metadata, instanceId, overrides\)/u,
]);

function targetSource(target) {
    const match = target.match(/^(.*):(\d+)-(\d+)$/u);
    assert.ok(match, `invalid mutation target ${target}`);
    const lines = fs.readFileSync(path.join(ROOT, match[1]), "utf8").split("\n");
    return lines.slice(Number(match[2]) - 1, Number(match[3])).join("\n");
}

test("theme icon mutation target is deterministic and non-incremental", () => {
    assert.equal(packageJson.scripts["test:mutation:theme-icons-target"], [
        "node --test",
        "tests/integration/applet.test.js",
        "tests/integration/applet-lifecycle.test.js",
        "tests/regression/theme-colors-regression.test.js",
        "tests/regression/icon-png-theme-regression.test.js",
        "tests/fuzz/icon-artifact.fuzz.test.js",
    ].join(" "));
    assert.equal(config.testRunner, "command");
    assert.equal(config.commandRunner.command, "npm run test:mutation:theme-icons-target");
    assert.equal(config.coverageAnalysis, "off");
    assert.equal(config.incremental, false);
    assert.equal(config.concurrency, 1);
    assert.deepEqual(config.mutate, TARGETS);
    assert.deepEqual(config.mutator, mainConfig.mutator);
    assert.deepEqual(config.thresholds, {high: 80, low: 80, break: 80});
    assert.equal(config.cleanTempDir, "always");
});

test("theme icon mutation command applies the threshold per callable", () => {
    for (const [index, script] of SCRIPTS.entries()) {
        assert.equal(
            packageJson.scripts[script],
            `stryker run stryker.theme-icons.config.json --mutate='${TARGETS[index]}'`,
        );
    }
    assert.equal(
        packageJson.scripts["test:mutation:theme-icons"],
        SCRIPTS.map((script) => `npm run ${script}`).join(" && "),
    );
});

test("theme icon mutation ranges still start at their intended callables", {
    skip: process.env.XPUWLM_MUTATION_RUN === "1"
        ? "Stryker instruments the icon target source ranges"
        : false,
}, () => {
    for (const [index, target] of TARGETS.entries()) {
        assert.match(targetSource(target), SIGNATURES[index]);
    }
});
