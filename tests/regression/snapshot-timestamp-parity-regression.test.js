"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const Ajv2020 = require("ajv/dist/2020").default;
const Domain = require("../../files/cinnamon-tpuwm@geraldo-netto/lib/domain.js");
const SchemaValidator = require("../../files/cinnamon-tpuwm@geraldo-netto/lib/runtime-snapshot-schema-validator.js");
const Fixtures = require("../helpers/runtime-snapshot-fixtures.js");

const schema = JSON.parse(fs.readFileSync(
    path.resolve(__dirname, "../../files/cinnamon-tpuwm@geraldo-netto/runtime-snapshot.schema.json"),
    "utf8",
));
const oracle = new Ajv2020({allErrors: true, strict: true}).compile(schema);

function snapshotWithTimestamp(value) {
    const candidate = Fixtures.validRuntimeSnapshot();
    candidate.generatedAt = value;
    return candidate;
}

test("regression: schema, handwritten validator, and domain agree on generatedAt", () => {
    const validator = new SchemaValidator.RuntimeSnapshotSchemaValidator();
    for (const {name, value, accepted} of Fixtures.generatedAtParityCases()) {
        const candidate = snapshotWithTimestamp(value);
        assert.equal(Boolean(oracle(candidate)), accepted, `${name}: JSON schema`);
        assert.equal(validator.validate(candidate).valid, accepted, `${name}: handwritten validator`);
        assert.equal(
            Domain.isValidGeneratedAt(value, Fixtures.NOW),
            accepted,
            `${name}: domain rule`,
        );
        const snapshot = Domain.normalizeSnapshot(candidate, Fixtures.NOW);
        assert.equal(snapshot.source, accepted ? "runtime" : "invalid", `${name}: normalization`);
    }
});

test("regression: epoch zero is rejected by every snapshot timestamp gate", () => {
    const candidate = snapshotWithTimestamp(0);
    assert.equal(Boolean(oracle(candidate)), false);
    assert.equal(new SchemaValidator.RuntimeSnapshotSchemaValidator().validate(candidate).valid, false);
    const snapshot = Domain.normalizeSnapshot(candidate, Fixtures.NOW);
    assert.equal(snapshot.source, "invalid");
    assert.match(snapshot.health.detail, /timestamp is invalid/u);
});

test("regression: the clock-skew bound stays a domain-only rule", () => {
    const withinSkew = snapshotWithTimestamp(Fixtures.NOW + Domain.MAX_CLOCK_SKEW_MS);
    const beyondSkew = snapshotWithTimestamp(Fixtures.NOW + Domain.MAX_CLOCK_SKEW_MS + 1);

    assert.equal(Boolean(oracle(withinSkew)), true);
    assert.equal(Boolean(oracle(beyondSkew)), true);
    assert.equal(Domain.isValidGeneratedAt(withinSkew.generatedAt, Fixtures.NOW), true);
    assert.equal(Domain.isValidGeneratedAt(beyondSkew.generatedAt, Fixtures.NOW), false);
    assert.equal(Domain.normalizeSnapshot(beyondSkew, Fixtures.NOW).source, "invalid");
});

test("regression: the schema minimum stays bound to the domain constant", () => {
    assert.equal(schema.properties.generatedAt.minimum, Domain.MIN_GENERATED_AT);
    assert.equal(Domain.MIN_GENERATED_AT, 1);
});
