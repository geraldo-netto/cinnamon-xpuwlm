"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const Validator = require(
    "../../files/cinnamon-tpuwm@geraldo-netto/lib/runtime-snapshot-schema-validator.js",
);

// The validator restates the snapshot schema in code the applet can run
// without a JSON-schema engine. Two statements of one contract drift, and this
// one drifts silently in the worst direction: a field the runtime added and
// the validator does not allow makes the applet reject *every* snapshot, which
// it reports as "no runtime service is publishing state" — indistinguishable
// from a service that is not running.
//
// The equivalence fuzz test cannot catch it. It compares the two against
// generated documents, and a document carrying a field neither side has ever
// seen is not one a fuzzer stumbles onto; a new optional property is invisible
// to it until a fixture happens to include one. This gate is structural
// instead: every allowlist is compared against the schema's own property
// names, so the drift fails at the moment it is introduced.

const appletRoot = path.resolve(__dirname, "../../files/cinnamon-tpuwm@geraldo-netto");
const schema = JSON.parse(
    fs.readFileSync(path.join(appletRoot, "runtime-snapshot.schema.json"), "utf8"),
);

const profileEntry = schema.properties.profiles.additionalProperties;
const telemetryPlugin = schema.properties.pluginTelemetry.properties.plugins.items;

const OBJECTS = Object.freeze({
    root: schema,
    inputs: schema.properties.inputs,
    device: schema.properties.devices.items,
    metric: schema.properties.metrics,
    profile: profileEntry,
    alert: schema.properties.alerts.items,
    telemetry: schema.properties.pluginTelemetry,
    telemetryPlugin,
});

const ENUMS = Object.freeze({
    profileStatus: profileEntry.properties.status.enum,
    profileReason: profileEntry.properties.reason.enum,
    alertSeverity: schema.properties.alerts.items.properties.severity.enum,
    deviceKind: schema.properties.devices.items.properties.kind.enum,
    deviceBackend: schema.properties.devices.items.properties.backend.enum,
});

test("every validator allowlist names exactly the schema's properties", () => {
    for (const [name, allowed] of Object.entries(Validator.CONTRACT_ALLOWLISTS)) {
        const declared = Object.keys(OBJECTS[name].properties);
        assert.deepEqual(
            [...allowed].sort(),
            [...declared].sort(),
            `${name}: the validator and the schema disagree on which properties exist`,
        );
    }
});

test("every validator enumeration names exactly the schema's values", () => {
    for (const [name, allowed] of Object.entries(Validator.CONTRACT_ENUMS)) {
        assert.deepEqual(
            [...allowed].sort(),
            [...ENUMS[name]].sort(),
            `${name}: the validator and the schema disagree on the allowed values`,
        );
    }
});

test("the gate covers every object the schema closes", () => {
    // An allowlist that stops being compared is an allowlist that can drift
    // again, so the table above must not fall behind the schema either.
    const closed = [];
    const walk = (node, pointer) => {
        if (node === null || typeof node !== "object") {
            return;
        }
        if (node.additionalProperties === false && node.properties) {
            closed.push(pointer);
        }
        for (const [key, child] of Object.entries(node)) {
            walk(child, `${pointer}/${key}`);
        }
    };
    walk(schema, "");

    assert.equal(
        closed.length,
        Object.keys(OBJECTS).length,
        `the schema closes ${closed.length} objects and this gate compares `
        + `${Object.keys(OBJECTS).length}: ${closed.join(", ")}`,
    );
});

test("a snapshot carrying an unknown profile field is still refused", () => {
    // The allowlist is a boundary, not decoration: widening it to whatever
    // arrives would make the parity gate above meaningless.
    const validator = new Validator.RuntimeSnapshotSchemaValidator();
    const snapshot = {
        version: 1,
        generatedAt: 1_700_000_000_000,
        devices: [{id: "tpu-usb", backend: "tpu", available: true, name: "Coral", kind: "usb"}],
        metrics: {queueDepth: 0, runningProfiles: 0},
        profiles: {sample: {status: "idle", queued: 0, detail: "", reason: "no-model"}},
        alerts: [],
    };

    assert.equal(validator.validate(snapshot).valid, true);

    snapshot.profiles.sample.invented = true;
    assert.equal(validator.validate(snapshot).valid, false);

    delete snapshot.profiles.sample.invented;
    snapshot.profiles.sample.reason = "a-state-this-build-predates";
    assert.equal(validator.validate(snapshot).valid, false);
});
