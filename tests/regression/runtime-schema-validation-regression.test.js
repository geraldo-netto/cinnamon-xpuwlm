"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const Runtime = require("../../files/cinnamon-tpuwm@geraldo-netto/lib/runtime-gateway.js");
const RuntimeSchema = require("../../files/cinnamon-tpuwm@geraldo-netto/lib/runtime-snapshot-schema-validator.js");
const Fixtures = require("../helpers/runtime-snapshot-fixtures.js");
const {readSnapshot} = require("../helpers/fakes.js");

function parse(candidate) {
    return Runtime.parseSnapshotDocument(
        JSON.stringify(candidate),
        Fixtures.NOW,
        new RuntimeSchema.RuntimeSnapshotSchemaValidator(),
    );
}

test("regression: schema-invalid values cannot be clamped into connected runtime state", () => {
    const candidates = [];
    for (const change of [
        (value) => { delete value.metrics.queueDepth; },
        (value) => { value.metrics.queueDepth = 1.5; },
        (value) => { value.devices[0].load = 101; },
        (value) => { value.alerts[0].confidence = 2; },
        (value) => { value.alerts[0].unexpected = true; },
        (value) => { value.alerts.push({id: "incomplete"}); },
        (value) => { value.extra = "ignored before validation"; },
    ]) {
        const candidate = Fixtures.validRuntimeSnapshot();
        change(candidate);
        candidates.push(candidate);
    }

    for (const candidate of candidates) {
        const snapshot = parse(candidate);
        assert.equal(snapshot.source, "invalid");
        assert.deepEqual(snapshot.devices, []);
        assert.match(snapshot.health.detail, /does not match/u);
    }
});

test("regression: one invalid alert invalidates the complete runtime document", () => {
    const candidate = Fixtures.validRuntimeSnapshot();
    candidate.alerts.push({
        id: "invalid-alert",
        profileId: "hardware-health",
        title: "Out of range evidence",
        summary: "",
        severity: "warning",
        timestamp: Fixtures.NOW,
        riskScore: 5,
    });

    const snapshot = parse(candidate);
    assert.equal(snapshot.source, "invalid");
    assert.deepEqual(snapshot.alerts, []);
    assert.deepEqual(snapshot.devices, []);
});

test("regression: a present non-string read result cannot masquerade as a missing snapshot", () => {
    let probes = 0;
    const gateway = new Runtime.RuntimeSnapshotGateway({
        path: "/run/tpuwm.json",
        clock: {now: () => Fixtures.NOW},
        readTextAsync: (filename, options, callback) => callback(null, ({present: true})),
        detectDevice() {
            probes += 1;
            return [{id: "tpu-usb", backend: "tpu", available: true, name: "Coral USB", kind: "usb"}];
        },
        snapshotValidator: new RuntimeSchema.RuntimeSnapshotSchemaValidator(),
        warningReporter: {report() {}, recover() {}},
    });

    const snapshot = readSnapshot(gateway);
    assert.equal(snapshot.source, "invalid");
    assert.deepEqual(snapshot.devices, []);
    assert.equal(probes, 0);
});

// The runtime attaches pluginTelemetry to every snapshot it publishes. The
// applet's root property set was closed over the older six-key document, so
// every real snapshot was discarded as schema-invalid before a single value
// was read, and the popup showed an unavailable runtime beside a running one.
test("regression: a snapshot carrying plug-in telemetry is accepted, not discarded", () => {
    const candidate = Fixtures.validRuntimeSnapshot();
    candidate.pluginTelemetry = Fixtures.pluginTelemetry();
    const snapshot = parse(candidate);
    assert.equal(snapshot.source, "runtime");
    assert.equal(snapshot.health.runtime, "connected");
    assert.equal(snapshot.devices.length, 2);
    assert.equal(snapshot.alerts.length, 0);

    // The extension is validated, never consumed: it must not reach the
    // normalized snapshot the view renders.
    assert.equal(Object.hasOwn(snapshot, "pluginTelemetry"), false);

    // An omitted extension stays valid, and a malformed one still fails loudly
    // rather than being waved through as an unknown key.
    const without = Fixtures.validRuntimeSnapshot();
    assert.equal(parse(without).source, "runtime");
    candidate.pluginTelemetry = Fixtures.pluginTelemetry({version: 2});
    assert.equal(parse(candidate).source, "invalid");
});
