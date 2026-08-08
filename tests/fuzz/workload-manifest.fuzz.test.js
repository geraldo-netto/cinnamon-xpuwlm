"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const Ajv2020 = require("ajv/dist/2020").default;
const Contract = require("../../files/cinnamon-tpuwm@geraldo-netto/lib/workload-manifest.js");
const Fixtures = require("../helpers/workload-manifest-fixtures.js");

const schema = JSON.parse(fs.readFileSync(path.resolve(
    __dirname,
    "../../files/cinnamon-tpuwm@geraldo-netto/workload-manifest.schema.json",
), "utf8"));
const oracle = new Ajv2020({strict: true}).compile(schema);

function random(seed) {
    let state = seed >>> 0;
    return () => {
        state = ((state * 1664525) + 1013904223) >>> 0;
        return state / 0x100000000;
    };
}

test("fuzz: manifest predicate stays equivalent to authoritative schema", () => {
    const next = random(0x35c0ffee);
    const paths = [
        ["manifestVersion"], ["id"], ["version"], ["capabilities"],
        ["requirements", "runtimeApi"], ["requirements", "accelerator"],
        ["requirements", "minimumDevices"], ["requirements", "model"],
        ["ui", "title"], ["ui", "group"], ["ui", "description"], ["ui", "icon"],
        ["defaults", "enabled"], ["defaults", "weight"],
        ["pipeline", "hostResponsibilities"], ["acceptance"],
    ];
    const hostile = [null, undefined, true, false, -1, 0, 1.5, "", "Bad Value", [], {}, () => {}];

    for (let iteration = 0; iteration < 1000; iteration += 1) {
        const candidate = Fixtures.validWorkloadManifest();
        const pathParts = paths[Math.floor(next() * paths.length)];
        let owner = candidate;
        for (const part of pathParts.slice(0, -1)) {
            owner = owner[part];
        }
        owner[pathParts.at(-1)] = hostile[Math.floor(next() * hostile.length)];
        assert.equal(
            Contract.isWorkloadManifest(candidate),
            Boolean(oracle(candidate)),
            `iteration ${iteration}`,
        );
    }
});
