"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const Qualification = require("../../files/cinnamon-xpuwlm@geraldo-netto/lib/artifact-qualification.js");
const {valid} = require("../helpers/artifact-qualification-fixture.js");

test("regression: signature bytes never sign themselves", () => {
    const first = valid();
    const second = valid({signature: {...valid().signature, value: `${"B".repeat(86)}==`}});
    assert.notEqual(first.signature.value, second.signature.value);
    assert.equal(
        Qualification.canonicalUnsignedQualification(first),
        Qualification.canonicalUnsignedQualification(second),
    );
});
