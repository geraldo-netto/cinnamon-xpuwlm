"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const Validator = require(
    "../../files/cinnamon-tpuwm@geraldo-netto/lib/runtime-snapshot-schema-validator.js",
);

// The validator has to check a snapshot without a JSON-schema engine, so its
// vocabulary is now derived from the shipped schema by
// scripts/generate-snapshot-contract.js rather than written a second time. The
// hand-written copy drifted once, in the worst direction: a field the runtime
// added and the validator did not allow made the applet reject *every*
// snapshot, which it reported as "no runtime service is publishing state" —
// indistinguishable from a service that is not running.
//
// With one statement and a derived file, this gate stops being a comparison of
// two lists and becomes two narrower questions: does the validator actually use
// what was derived, and does the derivation still cover every object the schema
// closes? A new closed object nobody derived would otherwise be checked by
// nothing at all.

const appletRoot = path.resolve(__dirname, "../../files/cinnamon-tpuwm@geraldo-netto");
const schema = JSON.parse(
    fs.readFileSync(path.join(appletRoot, "runtime-snapshot.schema.json"), "utf8"),
);

const profileEntry = schema.properties.profiles.additionalProperties;
const telemetryPlugin = schema.properties.pluginTelemetry.properties.plugins.items;
const kernelTelemetry = schema.properties.kernelTelemetry;

const OBJECTS = Object.freeze({
    root: schema,
    inputs: schema.properties.inputs,
    device: schema.properties.devices.items,
    metric: schema.properties.metrics,
    profile: profileEntry,
    alert: schema.properties.alerts.items,
    kernelTelemetry,
    kernelHistogram: kernelTelemetry.properties.histograms.items,
    kernelCounter: kernelTelemetry.properties.counters.items,
    telemetry: schema.properties.pluginTelemetry,
    telemetryPlugin,
});

const ENUMS = Object.freeze({
    profileStatus: profileEntry.properties.status.enum,
    profileReason: profileEntry.properties.reason.enum,
    alertSeverity: schema.properties.alerts.items.properties.severity.enum,
    deviceKind: schema.properties.devices.items.properties.kind.enum,
    deviceBackend: schema.properties.devices.items.properties.backend.enum,
    kernelTelemetryState: kernelTelemetry.properties.state.enum,
});

test("the validator checks against what was derived, not a copy of its own", () => {
    const Derived = require(
        "../../files/cinnamon-tpuwm@geraldo-netto/lib/runtime-snapshot-contract.js",
    );

    for (const [name, allowed] of Object.entries(Validator.CONTRACT_ALLOWLISTS)) {
        assert.equal(
            allowed,
            Derived.ALLOWLISTS[name],
            `${name}: the validator holds its own set rather than the derived one`,
        );
    }
    for (const [name, allowed] of Object.entries(Validator.CONTRACT_ENUMS)) {
        if (name === "profileReason") {
            continue; // read from the blocker classifier, pinned by its own gate
        }
        assert.equal(
            allowed,
            Derived.ENUMS[name],
            `${name}: the validator holds its own enumeration rather than the derived one`,
        );
    }
});

test("the derived file still says what the schema says", () => {
    // The generator is the single statement's only reader; if it stops seeing
    // an object, that object is checked by nothing.
    const {derive} = require("../../scripts/generate-snapshot-contract.js");
    const derived = derive(schema);

    for (const [name, object] of Object.entries(OBJECTS)) {
        assert.deepEqual(
            derived.allowlists[name],
            Object.keys(object.properties).sort(),
            `${name}: the generator and the schema disagree on which properties exist`,
        );
    }
});

test("every enumeration the validator uses is the schema's own", () => {
    const {derive} = require("../../scripts/generate-snapshot-contract.js");
    const derived = derive(schema);

    for (const [name, values] of Object.entries(ENUMS)) {
        assert.deepEqual(
            [...derived.enums[name]].sort(),
            [...values].sort(),
            `${name}: the generator and the schema disagree on the allowed values`,
        );
    }
});

test("every required field the validator enforces is the schema's own", () => {
    const Derived = require(
        "../../files/cinnamon-tpuwm@geraldo-netto/lib/runtime-snapshot-contract.js",
    );

    for (const [name, object] of Object.entries(OBJECTS)) {
        assert.deepEqual(
            Derived.REQUIRED[name],
            [...(object.required || [])].sort(),
            `${name}: the derived required fields drifted from the schema`,
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
