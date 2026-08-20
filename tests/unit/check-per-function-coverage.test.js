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

// Widening the coverage include (XTPU-0271) pointed the per-function gate at
// itself and it was the least-measured file in the repository: six of its
// validators sat below the 80% it enforces on everything else, all of them
// missing the refusal path that is the whole reason they exist. A gate held to
// a weaker bar than it imposes is a gate whose own failure modes are untested.

test("positions on the same line are ordered by column", () => {
    const same = {line: 4, column: 2};
    assert.equal(Coverage.comparePosition(same, {line: 4, column: 2}), 0);
    assert.ok(Coverage.comparePosition(same, {line: 4, column: 9}) < 0);
    assert.ok(Coverage.comparePosition(same, {line: 4, column: 0}) > 0);
    assert.ok(Coverage.comparePosition(same, {line: 9, column: 0}) < 0);
});

test("a location is inside another only when both ends are", () => {
    const outer = {start: {line: 1, column: 0}, end: {line: 9, column: 0}};
    assert.equal(Coverage.locationInside(outer, outer), true);
    assert.equal(
        Coverage.locationInside({start: {line: 2, column: 0}, end: {line: 3, column: 0}}, outer),
        true,
    );
    assert.equal(
        Coverage.locationInside({start: {line: 0, column: 0}, end: {line: 3, column: 0}}, outer),
        false,
    );
    assert.equal(
        Coverage.locationInside({start: {line: 2, column: 0}, end: {line: 10, column: 0}}, outer),
        false,
    );
});

test("a synthetic branch column is a position, a negative line is not", () => {
    assert.equal(
        Coverage.validLocation({start: {line: 1, column: -1}, end: {line: 1, column: -1}}),
        true,
    );
    for (const broken of [
        null,
        "location",
        {start: LOCATION.start},
        {start: {line: 1, column: -2}, end: LOCATION.end},
        {start: {line: 1.5, column: 0}, end: LOCATION.end},
        {start: LOCATION.end, end: LOCATION.start},
    ]) {
        assert.equal(Coverage.validLocation(broken), false);
    }
});

test("every missing coverage section is named by the section it is missing", () => {
    const complete = report()["/fixture.js"];
    for (const section of ["fnMap", "f", "statementMap", "s", "branchMap", "b"]) {
        assert.throws(
            () => Coverage.validateFileCoverage({...complete, [section]: null}, "/fixture.js"),
            new RegExp(`Malformed coverage report: /fixture\\.js\\.${section}`, "u"),
        );
    }
});

test("a file coverage entry checked without a name still says what it is", () => {
    assert.throws(() => Coverage.validateFileCoverage(null), /coverage file is not an object/u);
    assert.equal(Coverage.validateFileCoverage(report()["/fixture.js"]), true);
});

test("a function entry with no usable definition fails closed", () => {
    const complete = report()["/fixture.js"];
    for (const broken of [
        {fnMap: {0: null}, f: {0: 1}},
        {fnMap: {0: {name: "x", loc: null}}, f: {0: 1}},
        {fnMap: {0: {name: "x", loc: LOCATION}}, f: {0: -1}},
        {fnMap: {0: {name: "x", loc: LOCATION}}, f: {0: 1.5}},
    ]) {
        assert.throws(
            () => Coverage.validateFileCoverage({...complete, ...broken}, "/fixture.js"),
            /\/fixture\.js function 0/u,
        );
    }
});

test("a statement entry with no usable location fails closed", () => {
    const complete = report()["/fixture.js"];
    assert.throws(
        () => Coverage.validateFileCoverage(
            {...complete, statementMap: {0: null}, s: {0: 1}},
            "/fixture.js",
        ),
        /\/fixture\.js statement 0/u,
    );
});

test("every shape a branch entry can be wrong in is refused", () => {
    const complete = report()["/fixture.js"];
    for (const [branchMap, b] of [
        [{0: null}, {0: [1]}],
        [{0: {loc: null, locations: [LOCATION]}}, {0: [1]}],
        [{0: {loc: LOCATION, locations: LOCATION}}, {0: [1]}],
        [{0: {loc: LOCATION, locations: [LOCATION]}}, {0: 1}],
        [{0: {loc: LOCATION, locations: [LOCATION, LOCATION]}}, {0: [1]}],
        [{0: {loc: LOCATION, locations: [null]}}, {0: [1]}],
        [{0: {loc: LOCATION, locations: [LOCATION]}}, {0: [-1]}],
    ]) {
        assert.throws(
            () => Coverage.validateFileCoverage({...complete, b, branchMap}, "/fixture.js"),
            /\/fixture\.js branch 0/u,
        );
    }
    assert.equal(
        Coverage.validateFileCoverage({
            ...complete,
            b: {0: [1, 0]},
            branchMap: {0: {loc: LOCATION, locations: [LOCATION, LOCATION]}},
        }, "/fixture.js"),
        true,
    );
});

test("an anonymous, never-invoked function is measured and named by its line", () => {
    const fileCoverage = {
        fnMap: {0: {name: "", loc: LOCATION}},
        f: {0: 0},
        statementMap: {0: LOCATION},
        s: {0: 0},
        branchMap: {0: {loc: LOCATION, locations: [LOCATION, LOCATION]}},
        b: {0: [1, 0]},
    };
    assert.deepEqual(Coverage.functionCoverage(fileCoverage, "0"), {
        name: "(anonymous at 1)",
        line: 1,
        invoked: false,
        statements: 0,
        branches: 50,
    });
});

test("a report that measures nothing at all is a malformed report", () => {
    assert.throws(() => Coverage.verifyReport({}), /no functions were measured/u);
});
