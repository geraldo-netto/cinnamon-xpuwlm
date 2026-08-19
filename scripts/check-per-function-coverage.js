"use strict";

const fs = require("node:fs");
const path = require("node:path");

const {compareText} = require("./lib/compare-text.js");

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
    if (!Number.isInteger(covered) || covered < 0
        || !Number.isInteger(total) || total < 0 || covered > total) {
        throw new TypeError("Coverage counts must be nonnegative integers within their total");
    }
    return total === 0 ? 100 : (covered / total) * 100;
}

function isRecord(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value);
}

function validPosition(value) {
    return isRecord(value)
        && Number.isInteger(value.line) && value.line >= 1
        // V8 uses -1 for synthetic branch columns while preserving the line.
        && Number.isInteger(value.column) && value.column >= -1;
}

function validLocation(value) {
    return isRecord(value) && validPosition(value.start) && validPosition(value.end)
        && comparePosition(value.start, value.end) <= 0;
}


function sameKeys(left, right) {
    const leftKeys = Object.keys(left).sort(compareText);
    const rightKeys = Object.keys(right).sort(compareText);
    return leftKeys.length === rightKeys.length
        && leftKeys.every((key, index) => key === rightKeys[index]);
}

function validCounter(value) {
    return Number.isInteger(value) && value >= 0;
}

function validateSections(fileCoverage, filename) {
    for (const name of ["fnMap", "f", "statementMap", "s", "branchMap", "b"]) {
        if (!isRecord(fileCoverage[name])) {
            throw new TypeError(`Malformed coverage report: ${filename}.${name}`);
        }
    }
}

function validateMapKeys(fileCoverage, filename) {
    if (!sameKeys(fileCoverage.fnMap, fileCoverage.f)
        || !sameKeys(fileCoverage.statementMap, fileCoverage.s)
        || !sameKeys(fileCoverage.branchMap, fileCoverage.b)) {
        throw new TypeError(`Malformed coverage report: ${filename} map/counter keys differ`);
    }
}

function validateFunctions(fileCoverage, filename) {
    for (const [functionId, definition] of Object.entries(fileCoverage.fnMap)) {
        if (!isRecord(definition) || !validLocation(definition.loc)
            || !validCounter(fileCoverage.f[functionId])) {
            throw new TypeError(`Malformed coverage report: ${filename} function ${functionId}`);
        }
    }
}

function validateStatements(fileCoverage, filename) {
    for (const [statementId, location] of Object.entries(fileCoverage.statementMap)) {
        if (!validLocation(location) || !validCounter(fileCoverage.s[statementId])) {
            throw new TypeError(`Malformed coverage report: ${filename} statement ${statementId}`);
        }
    }
}

function validBranch(definition, counters) {
    return isRecord(definition) && validLocation(definition.loc)
        && Array.isArray(definition.locations) && Array.isArray(counters)
        && definition.locations.length === counters.length
        && definition.locations.every(validLocation) && counters.every(validCounter);
}

function validateBranches(fileCoverage, filename) {
    for (const [branchId, definition] of Object.entries(fileCoverage.branchMap)) {
        const counters = fileCoverage.b[branchId];
        if (!validBranch(definition, counters)) {
            throw new TypeError(`Malformed coverage report: ${filename} branch ${branchId}`);
        }
    }
}

function validateFileCoverage(fileCoverage, filename = "coverage file") {
    if (!isRecord(fileCoverage)) {
        throw new TypeError(`Malformed coverage report: ${filename} is not an object`);
    }
    validateSections(fileCoverage, filename);
    validateMapKeys(fileCoverage, filename);
    validateFunctions(fileCoverage, filename);
    validateStatements(fileCoverage, filename);
    validateBranches(fileCoverage, filename);
    return true;
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

function validateThreshold(minimum) {
    if (!Number.isFinite(minimum) || minimum < 0 || minimum > 100) {
        throw new TypeError("Per-function coverage threshold must be between 0 and 100");
    }
    return true;
}

function validateReportRoot(report) {
    if (!isRecord(report)) {
        throw new TypeError("Malformed coverage report: root is not an object");
    }
    return true;
}

function belowThreshold(result, minimum) {
    return !result.invoked || result.statements < minimum || result.branches < minimum;
}

function failureText(filename, result) {
    return `${path.relative(process.cwd(), filename)}:${result.line} ${result.name} `
        + `invoked=${result.invoked} statements=${result.statements.toFixed(1)}% `
        + `branches=${result.branches.toFixed(1)}%`;
}

function measureReport(report, minimum) {
    const failures = [];
    let checked = 0;
    for (const [filename, fileCoverage] of Object.entries(report)) {
        validateFileCoverage(fileCoverage, filename);
        for (const functionId of Object.keys(fileCoverage.fnMap)) {
            const result = functionCoverage(fileCoverage, functionId);
            checked += 1;
            if (belowThreshold(result, minimum)) {
                failures.push(failureText(filename, result));
            }
        }
    }
    return {checked, failures};
}

function requireMeasured({checked, failures}, minimum) {
    if (failures.length > 0) {
        throw new Error(`Per-function coverage below ${minimum}%:\n${failures.join("\n")}`);
    }
    if (checked === 0) {
        throw new Error("Malformed coverage report: no functions were measured");
    }
    return checked;
}

function verifyReport(report, minimum = threshold) {
    validateThreshold(minimum);
    validateReportRoot(report);
    return requireMeasured(measureReport(report, minimum), minimum);
}

function main({coveragePath = reportPath, logger = console, minimum = threshold} = {}) {
    const report = JSON.parse(fs.readFileSync(coveragePath, "utf8"));
    const checked = verifyReport(report, minimum);
    logger.log(`per-function coverage: ${checked} functions at or above ${minimum}%`);
    return checked;
}

if (require.main === module) {
    main();
}

module.exports = {
    comparePosition,
    functionCoverage,
    locationInside,
    main,
    percentage,
    validateFileCoverage,
    validLocation,
    verifyReport,
};
