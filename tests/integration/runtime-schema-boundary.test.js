"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const Runtime = require("../../files/cinnamon-tpuwm@geraldo-netto/lib/runtime-gateway.js");
const RuntimeSchema = require("../../files/cinnamon-tpuwm@geraldo-netto/lib/runtime-snapshot-schema-validator.js");
const Fixtures = require("../helpers/runtime-snapshot-fixtures.js");
const {readSnapshot} = require("../helpers/fakes.js");

function silentReporter() {
    return {report() {}, recover() {}};
}

test("schema validator and gateway reject present invalid snapshots without probing", () => {
    const invalidDocuments = Fixtures.runtimeSnapshotSchemaCases()
        .filter((candidate) => !candidate.expected)
        .filter((candidate) => {
            const load = candidate.value?.devices?.[0]?.load ?? 0;
            return load === null || Number.isFinite(load);
        });
    let probes = 0;
    let index = 0;
    const gateway = new Runtime.RuntimeSnapshotGateway({
        path: "/run/tpuwm.json",
        clock: {now: () => Fixtures.NOW},
        readTextAsync: (filename, options, callback) => callback(null, JSON.stringify(invalidDocuments[index].value)),
        detectDevice() {
            probes += 1;
            return [{id: "tpu-usb", backend: "tpu", available: true, name: "TPU", kind: "usb"}];
        },
        snapshotValidator: new RuntimeSchema.RuntimeSnapshotSchemaValidator(),
        warningReporter: silentReporter(),
    });

    for (index = 0; index < invalidDocuments.length; index += 1) {
        const snapshot = readSnapshot(gateway);
        assert.equal(snapshot.source, "invalid", invalidDocuments[index].name);
        assert.deepEqual(snapshot.devices, [], invalidDocuments[index].name);
    }
    assert.equal(probes, 0);
});

test("gateway reserves trusted device probing for absent or empty documents", () => {
    const documents = [null, "", " \n\t"];
    let index = 0;
    let probes = 0;
    const gateway = new Runtime.RuntimeSnapshotGateway({
        path: "/run/tpuwm.json",
        clock: {now: () => Fixtures.NOW},
        readTextAsync: (filename, options, callback) => callback(null, documents[index]),
        detectDevice() {
            probes += 1;
            return [{id: "tpu-usb", backend: "tpu", available: true, name: "Coral USB", kind: "usb"}];
        },
        snapshotValidator: new RuntimeSchema.RuntimeSnapshotSchemaValidator(),
        warningReporter: silentReporter(),
    });

    for (index = 0; index < documents.length; index += 1) {
        const snapshot = readSnapshot(gateway);
        assert.equal(snapshot.source, "probe");
        assert.equal(snapshot.devices[0].available, true);
    }
    assert.equal(probes, documents.length);
});

test("reader and parser integration rejects non-text present values before probing", () => {
    const documents = [undefined, false, 7, {}, []];
    let index = 0;
    let probes = 0;
    const gateway = new Runtime.RuntimeSnapshotGateway({
        path: "/run/tpuwm.json",
        clock: {now: () => Fixtures.NOW},
        readTextAsync: (filename, options, callback) => callback(null, documents[index]),
        detectDevice() {
            probes += 1;
            return [{id: "tpu-usb", backend: "tpu", available: true, name: "Coral USB", kind: "usb"}];
        },
        snapshotValidator: new RuntimeSchema.RuntimeSnapshotSchemaValidator(),
        warningReporter: silentReporter(),
    });

    for (index = 0; index < documents.length; index += 1) {
        assert.equal(readSnapshot(gateway).source, "invalid");
    }
    assert.equal(probes, 0);
});
