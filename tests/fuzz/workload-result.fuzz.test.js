"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const Ajv2020 = require("ajv/dist/2020").default;

const Result = require("../../files/cinnamon-xpuwlm@geraldo-netto/lib/workload-result.js");
const {valid, clone} = require("../helpers/workload-result-fixture.js");

const schemaPath = path.resolve(
    __dirname, "../../files/cinnamon-xpuwlm@geraldo-netto/workload-result.schema.json",
);
const validateSchema = new Ajv2020({strict: true}).compile(
    JSON.parse(fs.readFileSync(schemaPath, "utf8")),
);

test("property: structural result rules stay equivalent to JSON schema", () => {
    const mutations = [
        (item) => { item.version = 2; },
        (item) => { item.workloadId = "Bad id"; },
        (item) => { item.operationId = ""; },
        (item) => { item.createdAt = -1; },
        (item) => { item.extra = true; },
        (item) => { item.payload.extra = true; },
    ];
    for (let iteration = 0; iteration < 1000; iteration += 1) {
        const kind = Result.RESULT_KINDS[iteration % Result.RESULT_KINDS.length];
        const candidate = clone(valid(kind));
        if (iteration % 4 !== 0) {
            mutations[iteration % mutations.length](candidate);
        }
        assert.equal(
            Result.isWorkloadResult(candidate), validateSchema(candidate),
            JSON.stringify(validateSchema.errors),
        );
    }
});

test("fuzz: arbitrary shallow values never escape result validation", () => {
    const scalars = [null, true, false, -1, 0, 1.5, "", "x", [], {}];
    for (let iteration = 0; iteration < 1000; iteration += 1) {
        const base = valid(Result.RESULT_KINDS[iteration % Result.RESULT_KINDS.length]);
        const keys = Object.keys(base);
        base[keys[iteration % keys.length]] = scalars[iteration % scalars.length];
        assert.doesNotThrow(() => Result.isWorkloadResult(base));
    }
});
