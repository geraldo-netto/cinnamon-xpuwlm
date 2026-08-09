"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const Runtime = require("../../files/cinnamon-tpuwm@geraldo-netto/lib/runtime-gateway.js");
const RuntimeSchema = require("../../files/cinnamon-tpuwm@geraldo-netto/lib/runtime-snapshot-schema-validator.js");
const Fixtures = require("../helpers/runtime-snapshot-fixtures.js");
const {readSnapshot} = require("../helpers/fakes.js");

function transientRaceError() {
    const error = new Error("Runtime snapshot path changed while opening: /run/tpuwm.json");
    error.transientRace = true;
    return error;
}

function gateway(readTextAsync, warnings = []) {
    return new Runtime.RuntimeSnapshotGateway({
        path: "/run/tpuwm.json",
        clock: {now: () => Fixtures.NOW},
        readTextAsync,
        detectDevice() {
            throw new Error("a raced read must not fall back to probing");
        },
        snapshotValidator: new RuntimeSchema.RuntimeSnapshotSchemaValidator(),
        warningReporter: {
            report: (key, message) => warnings.push(message),
            recover() {},
        },
    });
}

test("regression: an atomic snapshot replacement mid-open retries instead of failing the poll", () => {
    let attempts = 0;
    const warnings = [];
    const subject = gateway((filename, options, callback) => {
        attempts += 1;
        if (attempts === 1) {
            callback(transientRaceError(), null);
            return;
        }
        callback(null, JSON.stringify(Fixtures.validRuntimeSnapshot()));
    }, warnings);

    const snapshot = readSnapshot(subject);
    assert.equal(snapshot.source, "runtime");
    assert.equal(snapshot.health.runtime, "connected");
    assert.equal(attempts, 2);
    assert.deepEqual(warnings, []);
});

test("regression: the race retry is bounded to one extra attempt", () => {
    let attempts = 0;
    const warnings = [];
    const subject = gateway((filename, options, callback) => {
        attempts += 1;
        callback(transientRaceError(), null);
    }, warnings);

    const snapshot = readSnapshot(subject);
    assert.equal(snapshot.source, "error");
    assert.equal(attempts, 2);
    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /path changed while opening/u);
});

test("regression: non-transient read errors never retry", () => {
    let attempts = 0;
    const subject = gateway((filename, options, callback) => {
        attempts += 1;
        callback(new Error("permission denied"), null);
    });

    const snapshot = readSnapshot(subject);
    assert.equal(snapshot.source, "error");
    assert.equal(attempts, 1);
});

test("regression: the identity-race error from the GIO reader is marked transient", () => {
    const Cinnamon = require("../../files/cinnamon-tpuwm@geraldo-netto/lib/cinnamon-runtime.js");
    const {createGioEnvironment} = require("../helpers/fakes.js");
    const environment = createGioEnvironment({
        "/swapped": {contents: "{}", inode: 10, device: 1, openedInode: 11},
    });
    let seen = null;
    Cinnamon.readFileTextAsync("/swapped", environment, {maximumBytes: 100}, (error) => { seen = error; });
    assert.notEqual(seen, null);
    assert.equal(seen.transientRace, true);
    assert.match(String(seen), /path changed while opening/u);
});
