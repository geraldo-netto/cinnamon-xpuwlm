"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

test("regression: Cinnamon root resolution exports failure-reporting dependencies", () => {
    for (const moduleName of ["failure-log-backoff", "failure-reporter"]) {
        assert.equal(
            require(`../../${moduleName}.js`),
            require(`../../lib/${moduleName}.js`),
        );
    }
});
