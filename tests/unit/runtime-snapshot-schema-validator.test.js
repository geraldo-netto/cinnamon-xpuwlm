"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const Ajv2020 = require("ajv/dist/2020").default;
const SchemaValidator = require("../../files/cinnamon-xpuwlm@geraldo-netto/lib/runtime-snapshot-schema-validator.js");
const Fixtures = require("../helpers/runtime-snapshot-fixtures.js");

const schema = JSON.parse(fs.readFileSync(
    path.resolve(__dirname, "../../files/cinnamon-xpuwlm@geraldo-netto/runtime-snapshot.schema.json"),
    "utf8",
));
const oracle = new Ajv2020({allErrors: true, strict: true}).compile(schema);

test("runtime snapshot validator matches every explicit v1 contract boundary", () => {
    const validator = new SchemaValidator.RuntimeSnapshotSchemaValidator();
    for (const {name, expected, value} of Fixtures.runtimeSnapshotSchemaCases()) {
        const report = validator.validate(value);
        assert.equal(report.valid, expected, name);
        assert.equal(report.code, expected ? "accepted" : "schema-v1", name);
        assert.equal(Boolean(oracle(value)), expected, `${name}: authoritative schema`);
        assert.equal(SchemaValidator.isRuntimeSnapshot(value), expected, `${name}: pure predicate`);
    }
});

test("runtime snapshot validator accepts every declared enum value", () => {
    const validator = new SchemaValidator.RuntimeSnapshotSchemaValidator();
    for (const kind of ["usb", "pcie", "accel", "dri", "unknown"]) {
        const value = Fixtures.validRuntimeSnapshot();
        value.devices[0].kind = kind;
        assert.equal(validator.validate(value).valid, true, kind);
    }
    for (const backend of ["tpu", "npu", "gpu"]) {
        const value = Fixtures.validRuntimeSnapshot();
        value.devices[0].backend = backend;
        assert.equal(validator.validate(value).valid, true, backend);
    }
    for (const status of ["healthy", "running", "watching", "idle", "paused", "unavailable"]) {
        const value = Fixtures.validRuntimeSnapshot();
        value.profiles["hardware-health"].status = status;
        assert.equal(validator.validate(value).valid, true, status);
    }
    for (const severity of ["advisory", "warning", "critical"]) {
        const value = Fixtures.validRuntimeSnapshot();
        value.alerts[0].severity = severity;
        assert.equal(validator.validate(value).valid, true, severity);
    }
});

test("runtime snapshot validator rejects callable objects at the object boundary", () => {
    const candidate = () => {};
    Object.assign(candidate, Fixtures.validRuntimeSnapshot());
    const validator = new SchemaValidator.RuntimeSnapshotSchemaValidator();
    assert.equal(validator.validate(candidate).valid, false);
    assert.equal(Boolean(oracle(candidate)), false);
});

test("the published input roots are validated, not merely tolerated", () => {
    const Validator = require(
        "../../files/cinnamon-xpuwlm@geraldo-netto/lib/runtime-snapshot-schema-validator.js",
    );

    assert.equal(Validator.isSnapshotInputs({roots: [], maxBytes: 0}), true);
    assert.equal(Validator.isSnapshotInputs({roots: ["/a", "/b"], maxBytes: 67108864}), true);
    assert.equal(Validator.isSnapshotInputs({roots: ["/a", "/a"], maxBytes: 1}), false, "unique");
    assert.equal(Validator.isSnapshotInputs({roots: new Array(9).fill(0).map((u, i) => `/r${i}`), maxBytes: 1}), false);
    assert.equal(Validator.isSnapshotInputs({roots: [""], maxBytes: 1}), false);
    assert.equal(Validator.isSnapshotInputs({roots: ["/a"], maxBytes: -1}), false);
    assert.equal(Validator.isSnapshotInputs({roots: ["/a"], maxBytes: 1024 * 1024 * 1024 + 1}), false);
    assert.equal(Validator.isSnapshotInputs({roots: ["/a"]}), false, "maxBytes is required");
    assert.equal(Validator.isSnapshotInputs({roots: ["/a"], maxBytes: 1, extra: 1}), false);
    assert.equal(Validator.isSnapshotInputs({roots: "/a", maxBytes: 1}), false);
    assert.equal(Validator.isSnapshotInputs(null), false);
});
