"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const Ajv2020 = require("ajv/dist/2020").default;
const Contract = require("../../files/cinnamon-xpuwlm@geraldo-netto/lib/runtime-control-contract.js");

const schema = JSON.parse(fs.readFileSync(path.resolve(
    __dirname,
    "../../files/cinnamon-xpuwlm@geraldo-netto/runtime-command.schema.json",
), "utf8"));
const oracle = new Ajv2020({strict: true}).compile(schema);

function random(seed) {
    let state = seed >>> 0;
    return () => {
        state = ((state * 1664525) + 1013904223) >>> 0;
        return state / 0x100000000;
    };
}

test("fuzz: command predicate remains equivalent to version 1 schema", () => {
    const next = random(0x1c0ffee);
    const properties = [
        "version", "id", "issuedAt", "expectedRevision", "operation", "profileId", "value",
    ];
    const hostile = [null, undefined, true, false, -1, 0, 1.5, "", "bad value", [], {}, () => {}];
    for (let iteration = 0; iteration < 2000; iteration += 1) {
        const candidate = {
            version: 1,
            id: "command-1",
            issuedAt: 1_700_000_000_000,
            expectedRevision: 0,
            operation: "set-profile-enabled",
            profileId: "hardware-health",
            value: true,
        };
        const property = properties[Math.floor(next() * properties.length)];
        candidate[property] = hostile[Math.floor(next() * hostile.length)];
        assert.equal(
            Contract.isRuntimeCommand(candidate),
            Boolean(oracle(candidate)),
            `iteration ${iteration}`,
        );
    }
});
