"use strict";

const fs = require("node:fs");
const path = require("node:path");

const threshold = 80;
const reportPath = path.resolve(__dirname, "../coverage/coverage-final.json");

function comparePosition(left, right) {
    if (left.line !== right.line) {
        return left.line - right.line;
    }
    return left.column - right.column;
}

function locationInside(inner, outer) {
    return comparePosition(inner.start, outer.start) >= 0
        && comparePosition(inner.end, outer.end) <= 0;
}

function percentage(covered, total) {
    return total === 0 ? 100 : (covered / total) * 100;
}

function functionCoverage(fileCoverage, functionId) {
    const definition = fileCoverage.fnMap[functionId];
    const invocationCount = fileCoverage.f[functionId] || 0;
    const statementIds = Object.keys(fileCoverage.statementMap)
        .filter((id) => locationInside(fileCoverage.statementMap[id], definition.loc));
    const coveredStatements = statementIds.filter((id) => fileCoverage.s[id] > 0).length;
    const branchIds = Object.keys(fileCoverage.branchMap)
        .filter((id) => locationInside(fileCoverage.branchMap[id].loc, definition.loc));
    const branchCounts = branchIds.flatMap((id) => fileCoverage.b[id]);
    const coveredBranches = branchCounts.filter((count) => count > 0).length;
    return {
        name: definition.name || `(anonymous at ${definition.loc.start.line})`,
        line: definition.loc.start.line,
        invoked: invocationCount > 0,
        statements: percentage(coveredStatements, statementIds.length),
        branches: percentage(coveredBranches, branchCounts.length),
    };
}

function verifyReport(report) {
    const failures = [];
    let checked = 0;
    for (const [filename, fileCoverage] of Object.entries(report)) {
        for (const functionId of Object.keys(fileCoverage.fnMap)) {
            const result = functionCoverage(fileCoverage, functionId);
            checked += 1;
            if (!result.invoked || result.statements < threshold || result.branches < threshold) {
                failures.push(`${path.relative(process.cwd(), filename)}:${result.line} ${result.name} `
                    + `invoked=${result.invoked} statements=${result.statements.toFixed(1)}% `
                    + `branches=${result.branches.toFixed(1)}%`);
            }
        }
    }
    if (failures.length > 0) {
        throw new Error(`Per-function coverage below ${threshold}%:\n${failures.join("\n")}`);
    }
    return checked;
}

const report = JSON.parse(fs.readFileSync(reportPath, "utf8"));
const checked = verifyReport(report);
console.log(`per-function coverage: ${checked} functions at or above ${threshold}%`);

module.exports = {comparePosition, functionCoverage, locationInside, percentage, verifyReport};
