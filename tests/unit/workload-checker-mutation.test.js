"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const test = require("node:test");

const Checker = require("../../scripts/check-workload-manifests.js");
const Fixtures = require("../helpers/workload-manifest-fixtures.js");

test("manifest discovery requests directory entries and keeps only their names", (t) => {
    t.mock.method(fs, "readdirSync", (root, options) => {
        assert.equal(root, "/catalog");
        assert.deepEqual(options, {withFileTypes: true});
        return [
            {name: "zeta", isDirectory: () => true},
            {name: "README.md", isDirectory: () => false},
            {name: "alpha", isDirectory: () => true},
        ];
    });

    assert.deepEqual(Checker.manifestDirectories("/catalog"), ["alpha", "zeta"]);
});

test("schema checker rejects multiple independent violations in one verdict", () => {
    const valid = Fixtures.validWorkloadManifest();
    assert.equal(Checker.schemaErrors(valid), "");

    const invalid = {
        ...valid,
        id: "Bad ID",
        capabilities: [],
        defaults: {...valid.defaults, weight: 99},
    };
    const errors = Checker.schemaErrors(invalid);

    assert.match(errors, /\/id/u);
    assert.match(errors, /\/capabilities/u);
    assert.match(errors, /\/defaults\/weight/u);
    assert.equal(errors.split("; ").length >= 3, true);
});
