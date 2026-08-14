"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const ROOT = path.resolve(__dirname, "../..");
const SOURCE_PATH = path.join(
    ROOT,
    "files/cinnamon-xpuwlm@geraldo-netto/lib/workload-provenance.js",
);
const packageJson = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
const mainConfig = JSON.parse(fs.readFileSync(path.join(ROOT, "stryker.config.json"), "utf8"));
const config = JSON.parse(fs.readFileSync(
    path.join(ROOT, "stryker.string-contract.config.json"),
    "utf8",
));
const CONTRACT_LITERALS = Object.freeze([
    "version",
    "profileId",
    "recipe",
    "reportSha256",
    "taskSemanticsSha256",
    "portableSha256",
    "nativeSha256",
    "reportSha256",
    "samples",
    "maximumAbsoluteError",
    "tolerance",
    "compilerReportSha256",
    "namedDeviceAccepted",
    "trainingContract",
    "nativeEvidence",
]);
const OTHER_MUTATORS = Object.freeze([
    "ArithmeticOperator",
    "ArrayDeclaration",
    "ArrowFunction",
    "AssignmentOperator",
    "BlockStatement",
    "BooleanLiteral",
    "ConditionalExpression",
    "EqualityOperator",
    "LogicalOperator",
    "MethodExpression",
    "ObjectLiteral",
    "OptionalChaining",
    "Regex",
    "UnaryOperator",
    "UpdateOperator",
]);

function strykerCandidateLiterals(source) {
    const lines = source.split("\n");
    const enabled = [];
    for (const line of lines) {
        for (const match of line.matchAll(/"([^"\\]*(?:\\.[^"\\]*)*)"/gu)) {
            const expressionStatement = line.trim() === `${match[0]};`;
            const requireArgument = line.includes(`require(${match[0]})`);
            if (expressionStatement || requireArgument) {
                continue;
            }
            enabled.push(match[1]);
        }
    }
    return enabled;
}

test("string contract pilot is isolated, reproducible, and thresholded", () => {
    assert.deepEqual(config.mutate, [
        "files/cinnamon-xpuwlm@geraldo-netto/lib/workload-provenance.js",
    ]);
    assert.equal(config.testRunner, "command");
    assert.equal(config.commandRunner.command, "npm run test:mutation:string-contract-target");
    assert.equal(config.coverageAnalysis, "off");
    assert.equal(config.incremental, false);
    assert.equal(config.concurrency, 1);
    assert.deepEqual(config.mutator.excludedMutations, OTHER_MUTATORS);
    assert.equal(config.mutator.excludedMutations.includes("StringLiteral"), false);
    assert.deepEqual(mainConfig.mutator.excludedMutations, ["StringLiteral"]);
    assert.deepEqual(config.thresholds, {high: 100, low: 100, break: 100});
    assert.deepEqual(config.reporters, ["clear-text", "progress", "json"]);
    assert.deepEqual(config.jsonReporter, {fileName: "mutation-report/string-contract.json"});
    assert.equal(config.cleanTempDir, "always");
});

test("string contract pilot runs only deterministic provenance tests", () => {
    assert.equal(packageJson.scripts["test:mutation:string-contract-target"], [
        "node --test",
        "tests/unit/workload-manifest.test.js",
        "tests/unit/workload-manifest-boundaries.test.js",
        "tests/fuzz/workload-manifest.fuzz.test.js",
    ].join(" "));
    assert.equal(
        packageJson.scripts["test:mutation:string-contract"],
        [
            "stryker run stryker.string-contract.config.json",
            [
                "XPUWLM_REQUIRE_STRING_MUTATION_REPORT=1 node --test",
                "tests/contract/string-literal-mutation-report-contract.test.js",
            ].join(" "),
        ].join(" && "),
    );
    assert.equal(
        packageJson.scripts["test:mutation"],
        "stryker run && npm run test:mutation:string-contract",
    );
});

test("only Stryker-intrinsic wiring literals are skipped and every contract field is measurable", () => {
    const source = fs.readFileSync(SOURCE_PATH, "utf8");
    assert.doesNotMatch(source, /['`]/u, "single-quoted or template literals require inventory support");
    assert.doesNotMatch(source, /Stryker (?:disable|restore)[^\n]*StringLiteral/gu);
    assert.deepEqual(strykerCandidateLiterals(source), CONTRACT_LITERALS);
});
