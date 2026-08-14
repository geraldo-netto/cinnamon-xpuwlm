"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const Coverage = require("../../scripts/check-per-function-coverage.js");

const LOCATION = Object.freeze({
    start: Object.freeze({line: 1, column: 0}),
    end: Object.freeze({line: 1, column: 10}),
});

function report() {
    return {
        "/fixture.js": {
            fnMap: {0: {name: "covered", loc: LOCATION}},
            f: {0: 1},
            statementMap: {0: LOCATION},
            s: {0: 1},
            branchMap: {},
            b: {},
        },
    };
}

test("per-function report accepts a complete measured function", () => {
    assert.equal(Coverage.verifyReport(report()), 1);
    assert.equal(Coverage.percentage(4, 5), 80);
    assert.equal(Coverage.percentage(0, 0), 100);
});

test("per-function thresholds reject invalid values instead of passing through NaN", () => {
    for (const minimum of [Number.NaN, Infinity, -1, 101, "80", null]) {
        assert.throws(
            () => Coverage.verifyReport(report(), minimum),
            /threshold must be between 0 and 100/u,
        );
    }
    for (const counts of [[Number.NaN, 1], [1, Number.NaN], [-1, 1], [2, 1]]) {
        assert.throws(() => Coverage.percentage(...counts), /Coverage counts/u);
    }
});

test("malformed coverage maps and counters fail closed", () => {
    const malformed = [
        null,
        {},
        {...report(), "/fixture.js": {...report()["/fixture.js"], f: {}}},
        {...report(), "/fixture.js": {...report()["/fixture.js"], s: {0: null}}},
        {...report(), "/fixture.js": {
            ...report()["/fixture.js"],
            statementMap: {0: {start: {line: 0, column: 0}, end: {line: 1, column: 1}}},
        }},
        {...report(), "/fixture.js": {
            ...report()["/fixture.js"],
            branchMap: {0: {loc: LOCATION, locations: [LOCATION]}},
            b: {0: []},
        }},
    ];
    for (const candidate of malformed) {
        assert.throws(() => Coverage.verifyReport(candidate), /coverage report/u);
    }
});

test("coverage main reads an injected report and enforces the threshold", (context) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "xpuwlm-coverage-"));
    context.after(() => fs.rmSync(root, {recursive: true, force: true}));
    const coveragePath = path.join(root, "coverage-final.json");
    fs.writeFileSync(coveragePath, JSON.stringify(report()));
    const messages = [];
    assert.equal(Coverage.main({
        coveragePath,
        logger: {log: (message) => messages.push(message)},
        minimum: 80,
    }), 1);
    assert.deepEqual(messages, ["per-function coverage: 1 functions at or above 80%"]);

    const uncovered = report();
    uncovered["/fixture.js"].s[0] = 0;
    fs.writeFileSync(coveragePath, JSON.stringify(uncovered));
    assert.throws(() => Coverage.main({coveragePath}), /below 80%/u);
});
