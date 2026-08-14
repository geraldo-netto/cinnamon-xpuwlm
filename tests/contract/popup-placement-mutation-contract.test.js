"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const ROOT = path.resolve(__dirname, "../..");
const packageJson = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
const mainConfig = JSON.parse(fs.readFileSync(path.join(ROOT, "stryker.config.json"), "utf8"));
const config = JSON.parse(fs.readFileSync(
    path.join(ROOT, "stryker.popup-placement.config.json"),
    "utf8",
));
const TARGETS = Object.freeze([
    "files/cinnamon-xpuwlm@geraldo-netto/lib/popup-placement.js:6-8",
    "files/cinnamon-xpuwlm@geraldo-netto/lib/popup-placement.js:10-12",
    "files/cinnamon-xpuwlm@geraldo-netto/lib/popup-placement.js:14-18",
    "files/cinnamon-xpuwlm@geraldo-netto/lib/popup-placement.js:20-31",
    "files/cinnamon-xpuwlm@geraldo-netto/lib/cinnamon-popup-adapter.js:5-17",
    "files/cinnamon-xpuwlm@geraldo-netto/lib/cinnamon-popup-adapter.js:19-26",
    "files/cinnamon-xpuwlm@geraldo-netto/lib/cinnamon-popup-adapter.js:28-49",
    "files/cinnamon-xpuwlm@geraldo-netto/lib/cinnamon-popup-adapter.js:51-61",
    "files/cinnamon-xpuwlm@geraldo-netto/applet.js:334-361",
]);
const SCRIPTS = Object.freeze([
    "test:mutation:popup-finite-number",
    "test:mutation:popup-positive-finite",
    "test:mutation:popup-valid-work-area",
    "test:mutation:popup-centered-position",
    "test:mutation:popup-workspace-area",
    "test:mutation:popup-monitor-area",
    "test:mutation:popup-menu-class",
    "test:mutation:popup-menu-factory",
    "test:mutation:popup-presentation",
]);
const SIGNATURES = Object.freeze([
    /^function finiteNumber\(value\)/u,
    /^function positiveFinite\(value\)/u,
    /^function validWorkArea\(workArea\)/u,
    /^function centeredPopupPosition\(workArea, popupWidth, popupHeight\)/u,
    /^function workspaceWorkArea\(cinnamonGlobal, monitor\)/u,
    /^function monitorWorkArea\(Main, cinnamonGlobal, sourceActor\)/u,
    /^function createCenteredPopupMenuClass\(\{BaseMenu, Main, cinnamonGlobal = global\}\)/u,
    /^function createCenteredPopupMenuFactory\(\{Applet, Main, cinnamonGlobal = global\}\)/u,
    /^\s+_createPresentation\(overrides\)/u,
]);

function targetSource(target) {
    const match = target.match(/^(.*):(\d+)-(\d+)$/u);
    assert.ok(match, `invalid mutation target ${target}`);
    const lines = fs.readFileSync(path.join(ROOT, match[1]), "utf8").split("\n");
    return lines.slice(Number(match[2]) - 1, Number(match[3])).join("\n");
}

test("popup placement mutation target is deterministic and non-incremental", () => {
    assert.equal(packageJson.scripts["test:mutation:popup-placement-target"], [
        "node --test",
        "tests/unit/popup-placement.test.js",
        "tests/unit/cinnamon-popup-adapter.test.js",
        "tests/integration/applet.test.js",
        "tests/fuzz/popup-placement.fuzz.test.js",
    ].join(" "));
    assert.equal(config.testRunner, "command");
    assert.equal(config.commandRunner.command, "npm run test:mutation:popup-placement-target");
    assert.equal(config.coverageAnalysis, "off");
    assert.equal(config.incremental, false);
    assert.equal(config.concurrency, 1);
    assert.deepEqual(config.mutate, TARGETS);
    assert.deepEqual(config.mutator, mainConfig.mutator);
    assert.deepEqual(config.thresholds, {high: 80, low: 80, break: 80});
    assert.equal(config.cleanTempDir, "always");
});

test("popup placement mutation command applies the threshold per callable", () => {
    for (const [index, script] of SCRIPTS.entries()) {
        assert.equal(
            packageJson.scripts[script],
            `stryker run stryker.popup-placement.config.json --mutate='${TARGETS[index]}'`,
        );
    }
    assert.equal(
        packageJson.scripts["test:mutation:popup-placement"],
        SCRIPTS.map((script) => `npm run ${script}`).join(" && "),
    );
});

test("popup placement mutation ranges still start at their intended callables", {
    skip: process.env.XPUWLM_MUTATION_RUN === "1"
        ? "Stryker instruments the popup target source ranges"
        : false,
}, () => {
    for (const [index, target] of TARGETS.entries()) {
        assert.match(targetSource(target), SIGNATURES[index]);
    }
});
