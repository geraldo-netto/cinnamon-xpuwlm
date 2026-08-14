"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const ROOT = path.resolve(__dirname, "../..");
const REPORT_PATH = path.join(ROOT, "mutation-report/full-rebaseline.json");
const REQUIRED = process.env.XPUWLM_REQUIRE_FULL_MUTATION_REPORT === "1";
const baseConfig = JSON.parse(fs.readFileSync(path.join(ROOT, "stryker.config.json"), "utf8"));
const packageJson = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
const fullConfig = require("../../stryker.full.config.cjs");
const TERMINAL_STATUSES = new Set([
    "CompileError",
    "Ignored",
    "Killed",
    "NoCoverage",
    "RuntimeError",
    "Survived",
    "Timeout",
]);

function relativePath(file) {
    return path.relative(ROOT, file).split(path.sep).join("/");
}

function expectedMutationFiles() {
    return [
        path.join(ROOT, "files/cinnamon-xpuwlm@geraldo-netto/applet.js"),
        ...fs.globSync(path.join(
            ROOT,
            "files/cinnamon-xpuwlm@geraldo-netto/lib/**/*.js",
        )),
        ...baseConfig.mutate
            .filter((target) => target.startsWith("scripts/"))
            .map((target) => path.join(ROOT, target)),
    ].map(relativePath).sort();
}

test("full mutation report covers the exact configured source tree above threshold", {
    skip: REQUIRED ? false : "run by test:mutation:full after Stryker writes its report",
}, async () => {
    const report = JSON.parse(fs.readFileSync(REPORT_PATH, "utf8"));
    assert.equal(report.schemaVersion, "1.0");
    assert.equal(report.framework.name, "StrykerJS");
    assert.equal(
        report.framework.version,
        packageJson.devDependencies["@stryker-mutator/core"],
    );
    assert.deepEqual(report.thresholds, baseConfig.thresholds);
    assert.deepEqual(report.config.mutate, fullConfig.mutate);
    assert.deepEqual(report.config.mutator.excludedMutations, ["StringLiteral"]);
    assert.equal(report.config.incremental, false);
    assert.equal(report.config.concurrency, 2);
    assert.equal(report.config.commandRunner.command, "npm run test:mutation-target");

    const files = Object.entries(report.files).sort(([left], [right]) => left.localeCompare(right));
    assert.deepEqual(files.map(([file]) => file), expectedMutationFiles());
    const mutants = [];
    for (const [file, result] of files) {
        assert.equal(
            result.source,
            fs.readFileSync(path.join(ROOT, file), "utf8"),
            `${file} report source must match the checked-in production source`,
        );
        mutants.push(...result.mutants);
    }
    assert.ok(mutants.length > 0);
    assert.equal(mutants.every((mutant) => TERMINAL_STATUSES.has(mutant.status)), true);

    const {calculateMutationTestMetrics} = await import("mutation-testing-metrics");
    const metrics = calculateMutationTestMetrics(report).systemUnderTestMetrics.metrics;
    assert.equal(metrics.pending, 0);
    assert.equal(metrics.totalMutants, mutants.length);
    assert.ok(metrics.totalValid > 0);
    assert.ok(metrics.ignored > 0, "the deliberate StringLiteral exclusion stays visible");
    assert.ok(metrics.mutationScore >= baseConfig.thresholds.break, {
        actual: metrics.mutationScore,
        minimum: baseConfig.thresholds.break,
    });
});
