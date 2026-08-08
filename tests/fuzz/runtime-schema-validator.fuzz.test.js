"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const Ajv2020 = require("ajv/dist/2020").default;
const Runtime = require("../../files/cinnamon-tpuwm@geraldo-netto/lib/runtime-gateway.js");
const RuntimeSchema = require("../../files/cinnamon-tpuwm@geraldo-netto/lib/runtime-snapshot-schema-validator.js");
const Fixtures = require("../helpers/runtime-snapshot-fixtures.js");

function generator(seed) {
    let state = seed >>> 0;
    return () => {
        state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
        return state;
    };
}

function arbitraryJson(random, depth = 0) {
    const choice = random() % (depth >= 3 ? 5 : 7);
    if (choice === 0) {
        return null;
    }
    if (choice === 1) {
        return (random() & 1) === 1;
    }
    if (choice === 2) {
        return (random() % 2_000_001) - 1_000_000;
    }
    if (choice === 3) {
        return String.fromCodePoint(random() % 0x110000).repeat(random() % 20);
    }
    if (choice === 4) {
        return (random() % 1000) / 7;
    }
    if (choice === 5) {
        return Array.from({length: random() % 5}, () => arbitraryJson(random, depth + 1));
    }
    const value = {};
    for (let index = 0; index < random() % 6; index += 1) {
        value[`key-${index}`] = arbitraryJson(random, depth + 1);
    }
    return value;
}

test("fuzz: concrete v1 validator remains equivalent to the authoritative schema", () => {
    const schema = JSON.parse(fs.readFileSync(
        path.resolve(__dirname, "../../files/cinnamon-tpuwm@geraldo-netto/runtime-snapshot.schema.json"),
        "utf8",
    ));
    const oracle = new Ajv2020({allErrors: true, strict: true}).compile(schema);
    const validator = new RuntimeSchema.RuntimeSnapshotSchemaValidator();
    const random = generator(0x53434845);
    const explicitCases = Fixtures.runtimeSnapshotSchemaCases();

    for (let iteration = 0; iteration < 10_000; iteration += 1) {
        const value = iteration % 3 === 0
            ? structuredClone(explicitCases[random() % explicitCases.length].value)
            : arbitraryJson(random);
        assert.equal(
            validator.validate(value).valid,
            Boolean(oracle(value)),
            `iteration ${iteration}`,
        );
    }
});

test("fuzz: every present non-text reader value fails without probing", () => {
    const random = generator(0x52454144);
    const validator = new RuntimeSchema.RuntimeSnapshotSchemaValidator();
    let probes = 0;
    for (let iteration = 0; iteration < 5_000; iteration += 1) {
        let value = arbitraryJson(random);
        if (value === null || typeof value === "string") {
            value = iteration % 2 === 0 ? undefined : {value};
        }
        const gateway = new Runtime.RuntimeSnapshotGateway({
            path: "/run/tpuwm.json",
            clock: {now: () => Fixtures.NOW},
            readText: () => value,
            detectDevice() {
                probes += 1;
                return {available: true, name: "Coral USB", kind: "usb"};
            },
            snapshotValidator: validator,
            warningReporter: {report() {}, recover() {}},
        });
        const snapshot = gateway.read();
        assert.equal(snapshot.source, "invalid", `iteration ${iteration}`);
        assert.equal(snapshot.device.available, false, `iteration ${iteration}`);
    }
    assert.equal(probes, 0);
});
