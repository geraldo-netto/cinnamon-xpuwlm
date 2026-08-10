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

// `requirements.model.sha256` is optional, so the exact key-count rule no
// longer applies to the model record. Both the schema and the predicate must
// agree on absent, well-formed, and malformed digests alike.
test("property: optional model digests stay equivalent to the authoritative schema", () => {
    const next = random(0x0d19e57);
    const digest = "a".repeat(64);
    const candidates = [
        undefined,
        digest,
        "0123456789abcdef".repeat(4),
        digest.toUpperCase(),
        digest.slice(0, 63),
        `${digest}a`,
        "",
        null,
        7,
        [digest],
        {value: digest},
        `${digest.slice(0, 63)}g`,
        `${digest.slice(0, 63)} `,
    ];

    for (const value of candidates) {
        const candidate = Fixtures.validWorkloadManifest();
        if (value === undefined) {
            delete candidate.requirements.model.sha256;
        } else {
            candidate.requirements.model.sha256 = value;
        }
        assert.equal(
            Contract.isWorkloadManifest(candidate),
            Boolean(oracle(candidate)),
            `digest ${JSON.stringify(value)}`,
        );
    }

    // Random hexadecimal noise of every length around the 64-character bound.
    for (let length = 60; length <= 68; length += 1) {
        const candidate = Fixtures.validWorkloadManifest();
        candidate.requirements.model.sha256 = Array.from(
            {length},
            () => "0123456789abcdef"[Math.floor(next() * 16)],
        ).join("");
        assert.equal(
            Contract.isWorkloadManifest(candidate),
            Boolean(oracle(candidate)),
            `length ${length}`,
        );
    }
});
