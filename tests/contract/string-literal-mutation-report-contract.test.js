"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const ROOT = path.resolve(__dirname, "../..");
const REPORT_PATH = path.join(ROOT, "mutation-report/string-contract.json");
const REQUIRED = process.env.XPUWLM_REQUIRE_STRING_MUTATION_REPORT === "1";
const EXPECTED_LITERALS = Object.freeze([
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
const EXCLUDED_MUTATORS = new Set([
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

function originalAt(source, location) {
    assert.equal(location.start.line, location.end.line, "contract literals stay on one line");
    const line = source.split("\n")[location.start.line - 1];
    assert.equal(typeof line, "string", "mutant line exists in the reported source");
    const quoted = line.slice(location.start.column - 1, location.end.column - 1);
    return JSON.parse(quoted);
}

test("string contract mutation report contains exactly fifteen killed field mutants", {
    skip: REQUIRED ? false : "run by test:mutation:string-contract after Stryker writes its report",
}, () => {
    const report = JSON.parse(fs.readFileSync(REPORT_PATH, "utf8"));
    assert.equal(report.schemaVersion, "1.0");
    const files = Object.entries(report.files);
    assert.equal(files.length, 1);
    assert.match(files[0][0], /files\/cinnamon-xpuwlm@geraldo-netto\/lib\/workload-provenance\.js$/u);
    const {source, mutants} = files[0][1];
    const active = mutants.filter((mutant) => mutant.status !== "Ignored");
    const ignored = mutants.filter((mutant) => mutant.status === "Ignored");
    assert.equal(active.length, EXPECTED_LITERALS.length);
    assert.equal(active.every((mutant) => mutant.mutatorName === "StringLiteral"), true);
    assert.equal(active.every((mutant) => mutant.status === "Killed"), true);
    assert.deepEqual(
        active.map((mutant) => originalAt(source, mutant.location)).sort(),
        [...EXPECTED_LITERALS].sort(),
    );
    assert.ok(ignored.length > 0, "excluded non-string candidates remain auditable");
    for (const mutant of ignored) {
        assert.equal(EXCLUDED_MUTATORS.has(mutant.mutatorName), true, mutant.mutatorName);
        assert.equal(
            mutant.statusReason,
            `Ignored because of excluded mutation "${mutant.mutatorName}"`,
        );
    }
});
