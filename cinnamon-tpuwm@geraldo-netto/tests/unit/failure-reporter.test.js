"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const FailureReporter = require("../../lib/failure-reporter.js");

test("failure reporter contract accepts only report/recover ports", () => {
    const reporter = {report() {}, recover() {}};
    assert.equal(FailureReporter.requireFailureReporter(reporter), reporter);
    for (const candidate of [null, {}, {report() {}}, {recover() {}}]) {
        assert.throws(
            () => FailureReporter.requireFailureReporter(candidate, "test failure"),
            /test failure reporter with report\/recover/,
        );
    }
});
