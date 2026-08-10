"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const Ajv2020 = require("ajv/dist/2020").default;
const Contract = require("../../files/cinnamon-tpuwm@geraldo-netto/lib/runtime-contract.js");

const schema = JSON.parse(fs.readFileSync(path.resolve(
    __dirname,
    "../../files/cinnamon-tpuwm@geraldo-netto/runtime-contract.schema.json",
), "utf8"));
const oracle = new Ajv2020({strict: true}).compile(schema);

function random(seed) {
    let state = seed >>> 0;
    return () => {
        state = ((state * 1664525) + 1013904223) >>> 0;
        return state / 0x100000000;
    };
}

function pick(next, values) {
    return values[Math.floor(next() * values.length) % values.length];
}

// The predicate and the schema are two statements of the same contract, kept
// in different languages for different reasons: the schema is what the service
// is checked against, the predicate is what a GJS applet can run with no
// validator loaded. Two statements of one rule is two chances to disagree, and
// the disagreement is silent — a document one side accepts and the other
// refuses looks like a broken service, not like a broken contract.
test("fuzz: the contract predicate stays equivalent to the mirrored schema", () => {
    const next = random(0x5eed1c);
    const methodValues = [
        ["ApplyCommand"], ["ApplyCommand", "DescribeContract"], [], ["a"], ["A".repeat(64)],
        ["A".repeat(65)], ["ApplyCommand", "ApplyCommand"], ["has space"], ["1Leading"],
        "ApplyCommand", null, 42, [null], [""],
        Array.from({length: 33}, (_value, index) => `Method${index}`),
    ];
    const schemaValues = [
        {}, {"runtime-command": 1}, {"runtime-command": 65535}, {"runtime-command": 65536},
        {"runtime-command": 0}, {"runtime-command": 1.5}, {"runtime-command": true},
        {"Runtime-Command": 1}, {"runtime--command": 1}, {"-runtime": 1}, {"runtime-": 1},
        null, [], "schemas", {"runtime-command": null},
        Object.fromEntries(Array.from({length: 33}, (_value, index) => [`c${index}`, 1])),
    ];
    const versions = [1, 0, 2, "1", null, true, 1.0];

    for (let iteration = 0; iteration < 4000; iteration += 1) {
        const candidate = {
            version: pick(next, versions),
            methods: pick(next, methodValues),
            schemas: pick(next, schemaValues),
        };
        if (next() < 0.1) {
            candidate.extra = pick(next, versions);
        }
        if (next() < 0.1) {
            delete candidate[pick(next, ["version", "methods", "schemas"])];
        }
        assert.equal(
            Contract.isRuntimeContractDocument(candidate),
            oracle(candidate) === true,
            JSON.stringify(candidate),
        );
    }
});

test("fuzz: a rejected document never becomes a contract that claims to know", () => {
    const next = random(0xc0ffee);
    const shapes = [null, undefined, 0, "", [], {}, {version: 1}, {version: 1, methods: []}];

    for (let iteration = 0; iteration < 2000; iteration += 1) {
        const candidate = pick(next, shapes);
        const contract = new Contract.RuntimeContract(candidate);
        if (!Contract.isRuntimeContractDocument(candidate)) {
            assert.equal(contract.known, false);
            assert.deepEqual(contract.incompatibilities(), []);
            assert.equal(contract.compatible, true);
        }
    }
});

test("fuzz: a contract never reports a mismatch it cannot name", () => {
    const next = random(0xbadf00d);
    const names = Object.keys(Contract.REQUIRED_CONTRACTS);

    for (let iteration = 0; iteration < 2000; iteration += 1) {
        const schemas = {};
        for (const name of names) {
            const offered = Math.floor(next() * 4);
            if (offered > 0) {
                schemas[name] = offered;
            }
        }
        const methods = next() < 0.5 ? ["ApplyCommand"] : ["DescribeContract"];
        const contract = new Contract.RuntimeContract({version: 1, methods, schemas});
        const found = contract.incompatibilities();

        assert.equal(contract.compatible, found.length === 0);
        for (const mismatch of found) {
            assert.equal(Contract.INCOMPATIBILITY_KINDS.includes(mismatch.kind), true);
            assert.equal(
                mismatch.kind === "method-missing"
                    ? Contract.REQUIRED_METHODS.includes(mismatch.name)
                    : names.includes(mismatch.name),
                true,
                JSON.stringify(mismatch),
            );
        }
    }
});
