"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const Ajv2020 = require("ajv/dist/2020").default;
const Refusal = require("../../files/cinnamon-xpuwlm@geraldo-netto/lib/runtime-refusal-contract.js");

const schema = JSON.parse(fs.readFileSync(path.resolve(
    __dirname,
    "../../files/cinnamon-xpuwlm@geraldo-netto/runtime-refusal.schema.json",
), "utf8"));
const oracle = new Ajv2020({strict: true}).compile(schema);

function random(seed) {
    let state = seed >>> 0;
    return () => {
        state = ((state * 1664525) + 1013904223) >>> 0;
        return state / 0x100000000;
    };
}

test("fuzz: refusal predicate remains equivalent to version 1 schema", () => {
    const next = random(0x9ef05a1);
    const properties = ["version", "status", "code", "message", "method"];
    const hostile = [
        null, undefined, true, false, 0, 1, 2, 1.5, "", "rejected", "applied",
        "rate-limit-exceeded", "quota-invalid", "unknown-code", "apply-command",
        "1Method", "Apply Command", "x".repeat(500), "x".repeat(501),
        "A".repeat(64), "A".repeat(65), [], {}, () => {},
    ];
    for (let iteration = 0; iteration < 4000; iteration += 1) {
        const candidate = {
            version: 1,
            status: "rejected",
            code: "rate-limit-exceeded",
            message: "apply-command allows 30 calls per 10s",
            method: "apply-command",
        };
        const property = properties[Math.floor(next() * properties.length)];
        candidate[property] = hostile[Math.floor(next() * hostile.length)];
        assert.equal(
            Refusal.isRuntimeRefusal(candidate),
            Boolean(oracle(candidate)),
            `iteration ${iteration}: ${property}=${String(candidate[property])}`,
        );
    }
});
