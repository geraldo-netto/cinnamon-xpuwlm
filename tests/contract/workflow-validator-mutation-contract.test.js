"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const ROOT = path.resolve(__dirname, "../..");
const packageJson = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
const config = JSON.parse(fs.readFileSync(
    path.join(ROOT, "stryker.workflow-validation.config.json"),
    "utf8",
));
const TARGETS = Object.freeze([
    "files/cinnamon-xpuwlm@geraldo-netto/lib/media-transcription.js:108-115",
    "files/cinnamon-xpuwlm@geraldo-netto/lib/caption-export.js:56-68",
    "files/cinnamon-xpuwlm@geraldo-netto/lib/screenshot-assistant.js:44-48",
    "files/cinnamon-xpuwlm@geraldo-netto/lib/screenshot-assistant.js:56-60",
]);

test("workflow validator mutation target stays deterministic and bounded", () => {
    assert.equal(packageJson.scripts["test:mutation:workflow-validation-target"], [
        "node --test",
        "tests/regression/workflow-validation-boundaries-regression.test.js",
        "tests/fuzz/caption-export.fuzz.test.js",
    ].join(" "));
    assert.equal(config.testRunner, "command");
    assert.equal(
        config.commandRunner.command,
        "npm run test:mutation:workflow-validation-target",
    );
    assert.equal(config.coverageAnalysis, "off");
    assert.equal(config.incremental, false);
    assert.equal(config.concurrency, 1);
    assert.deepEqual(config.mutate, TARGETS);
    assert.deepEqual(config.thresholds, {high: 80, low: 80, break: 80});
});

test("workflow validator mutation command applies the break threshold per callable", () => {
    const scripts = [
        "test:mutation:workflow-duration",
        "test:mutation:workflow-cues",
        "test:mutation:workflow-image-file",
        "test:mutation:workflow-capture-time",
    ];
    for (const [index, script] of scripts.entries()) {
        assert.match(packageJson.scripts[script], /stryker run stryker\.workflow-validation\.config\.json/u);
        assert.match(packageJson.scripts[script], new RegExp(TARGETS[index].replaceAll(".", "\\."), "u"));
    }
    assert.equal(
        packageJson.scripts["test:mutation:workflow-validation"],
        scripts.map((script) => `npm run ${script}`).join(" && "),
    );
});
