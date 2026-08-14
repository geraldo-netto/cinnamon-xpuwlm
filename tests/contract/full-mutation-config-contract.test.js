"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const ROOT = path.resolve(__dirname, "../..");
const base = JSON.parse(fs.readFileSync(path.join(ROOT, "stryker.config.json"), "utf8"));
const full = require("../../stryker.full.config.cjs");
const packageJson = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));

test("full mutation rebaseline inherits every configured target and threshold", () => {
    assert.deepEqual(full.mutate, base.mutate);
    assert.deepEqual(full.mutator, base.mutator);
    assert.deepEqual(full.thresholds, base.thresholds);
    assert.equal(full.thresholds.break, 80);
    assert.deepEqual(full.commandRunner, base.commandRunner);
    assert.match(
        packageJson.scripts["test:mutation-target"],
        /^XPUWLM_MUTATION_RUN=1 /u,
    );
});

test("full mutation rebaseline is non-incremental, resource-safe, and reproducible", () => {
    assert.equal(full.incremental, false);
    assert.equal(full.incrementalFile, undefined);
    assert.equal(full.concurrency, 2);
    assert.deepEqual(full.reporters, [...base.reporters, "json"]);
    assert.deepEqual(full.jsonReporter, {
        fileName: "mutation-report/full-rebaseline.json",
    });
    assert.equal(
        packageJson.scripts["test:mutation:full"],
        "stryker run stryker.full.config.cjs && XPUWLM_REQUIRE_FULL_MUTATION_REPORT=1 node --test tests/contract/full-mutation-report-contract.test.js",
    );
});

test("full mutation mode skips only the exact instrumented-source assertions", () => {
    const skipDeclaration = [
        "skip: process.env.",
        'XPUWLM_MUTATION_RUN === "1"',
    ].join("");
    const skipFiles = fs.globSync("tests/**/*.test.js", {cwd: ROOT})
        .filter((relativePath) => fs.readFileSync(
            path.join(ROOT, relativePath),
            "utf8",
        ).includes(skipDeclaration))
        .sort();
    assert.deepEqual(skipFiles, [
        "tests/contract/root-shim-contract.test.js",
        "tests/contract/string-literal-mutation-contract.test.js",
        "tests/contract/workflow-wiring-boundary-contract.test.js",
        "tests/contract/workload-runtime-boundary-contract.test.js",
        "tests/unit/generate-snapshot-contract.test.js",
    ]);
});
