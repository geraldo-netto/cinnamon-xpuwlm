"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const ROOT = path.resolve(__dirname, "../..");

function readJson(relativePath) {
    return JSON.parse(fs.readFileSync(path.join(ROOT, relativePath), "utf8"));
}

const packageJson = readJson("package.json");
const mainConfig = readJson("stryker.config.json");
const TARGETS = Object.freeze([
    Object.freeze({
        config: "stryker.artifact-validation.config.json",
        file: "scripts/validate-artifacts.js",
        mutationScript: "test:mutation:artifact-validation",
        targetCommand: "node --test tests/unit/validate-artifacts.test.js",
        targetScript: "test:mutation:artifact-validation-target",
    }),
    Object.freeze({
        config: "stryker.snapshot-contract.config.json",
        file: "scripts/generate-snapshot-contract.js",
        mutationScript: "test:mutation:snapshot-contract",
        targetCommand: [
            "node --test",
            "tests/unit/generate-snapshot-contract.test.js",
            "tests/contract/snapshot-validator-schema-parity-contract.test.js",
        ].join(" "),
        targetScript: "test:mutation:snapshot-contract-target",
    }),
]);

test("main mutation config retains both directly tested script targets", () => {
    for (const target of TARGETS) {
        assert.ok(mainConfig.mutate.includes(target.file), target.file);
    }
});

test("script mutation targets stay isolated and retain the global threshold", () => {
    for (const target of TARGETS) {
        const config = readJson(target.config);
        assert.deepEqual(config.mutate, [target.file]);
        assert.equal(config.testRunner, "command");
        assert.equal(config.commandRunner.command, `npm run ${target.targetScript}`);
        assert.equal(packageJson.scripts[target.targetScript], target.targetCommand);
        assert.equal(packageJson.scripts[target.mutationScript], `stryker run ${target.config}`);
        assert.equal(config.incremental, false);
        assert.deepEqual(config.mutator, mainConfig.mutator);
        assert.deepEqual(config.thresholds, mainConfig.thresholds);
        assert.equal(config.thresholds.break >= 80, true);
    }
    assert.equal(
        packageJson.scripts["test:mutation:script-tools"],
        TARGETS.map((target) => `npm run ${target.mutationScript}`).join(" && "),
    );
});
