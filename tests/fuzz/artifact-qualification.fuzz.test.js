"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const Ajv2020 = require("ajv/dist/2020").default;

const Qualification = require("../../files/cinnamon-xpuwlm@geraldo-netto/lib/artifact-qualification.js");
const {valid} = require("../helpers/artifact-qualification-fixture.js");

const schemaPath = path.resolve(
    __dirname, "../../files/cinnamon-xpuwlm@geraldo-netto/artifact-qualification.schema.json",
);
const validateSchema = new Ajv2020({strict: true}).compile(JSON.parse(fs.readFileSync(schemaPath, "utf8")));

function clone(value) {
    return JSON.parse(JSON.stringify(value));
}

test("property: qualification predicate stays equivalent to its JSON schema", () => {
    const mutations = [
        (item, index) => { item.version = index % 3; },
        (item) => { item.artifactId = "bad id"; },
        (item) => { item.recipe.extra = true; },
        (item) => { item.portableExport.sha256 = "0".repeat(63); },
        (item) => { item.nativeBinding.vulkanRequired = false; },
        (item) => { item.license.sourceUrl = "file:///tmp/model"; },
        (item) => { item.signature.value = "!".repeat(88); },
        (item) => { item.hardwareEvidence.decision = "unknown"; },
        (item) => { item.hardwareEvidence.benchmarkVersion = 99; },
        (item) => { item.unexpected = null; },
    ];
    for (let iteration = 0; iteration < 1000; iteration += 1) {
        const candidate = clone(valid());
        if (iteration % 4 !== 0) {
            mutations[iteration % mutations.length](candidate, iteration);
        }
        assert.equal(
            Qualification.isQualification(candidate),
            validateSchema(candidate),
            JSON.stringify(validateSchema.errors),
        );
    }
});
