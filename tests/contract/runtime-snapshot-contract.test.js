"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const {omnitensorRepository} = require("../helpers/sibling-repository.js");

// The applet mirrors the snapshot's *shape* by hand: six fields, read straight
// out of the published document without a schema engine. That is deliberate —
// the client validates, the panel draws — but it leaves the mirror ungated. A
// rename on the writer's side would not break anything loudly; it would leave
// the panel drawing "0 queued, 0 running, Nothing" on a busy runtime, which is
// indistinguishable from a healthy idle desk.
//
// So the fields the reader consumes are pinned against the canonical schema,
// the backend order against the runtime's own routing hierarchy, and the
// staleness window against the heartbeat the service actually publishes at.
// Same skip-when-absent rule as the path gate: the sibling checkout is not a
// dependency, and an unavailable half is reported as unavailable, never as
// passing.

const repositoryRoot = path.resolve(__dirname, "../..");
const appletRoot = path.join(repositoryRoot, "files/cinnamon-xpuwlm@geraldo-netto");
const SnapshotReader = require(path.join(appletRoot, "lib/snapshot-reader.js"));

const omnitensor = omnitensorRepository();
const SKIP_REASON = omnitensor.skipReason;

function readServiceJson(relativePath) {
    return omnitensor.readJson(relativePath);
}

function readServiceText(relativePath) {
    return omnitensor.readText(relativePath);
}

const SCHEMA_PATH = "schemas/runtime-snapshot.schema.json";

// Every field `lib/snapshot-reader.js` reads out of the document, named by the
// path the schema declares it at. The list is checked against the reader as
// well as against the schema, so an entry that stops being read here is
// noticed rather than left pinning a field nobody draws.
const CONSUMED_FIELDS = [
    ["properties", "version"],
    ["properties", "generatedAt"],
    ["properties", "devices", "items", "properties", "backend"],
    ["properties", "devices", "items", "properties", "available"],
    ["properties", "devices", "items", "properties", "reason"],
    ["properties", "metrics", "properties", "queueDepth"],
    ["properties", "metrics", "properties", "runningProfiles"],
    ["properties", "alerts", "items", "properties", "resolved"],
    ["properties", "policy", "properties", "paused"],
];

function declaredAt(schema, segments) {
    let node = schema;
    for (const segment of segments) {
        if (node === undefined || node === null || !Object.hasOwn(node, segment)) {
            return undefined;
        }
        node = node[segment];
    }
    return node;
}

test("every snapshot field the panel draws is declared by the canonical schema", (t) => {
    const schema = readServiceJson(SCHEMA_PATH);
    if (schema === null) {
        t.skip(SKIP_REASON);
        return;
    }
    for (const segments of CONSUMED_FIELDS) {
        assert.notEqual(
            declaredAt(schema, segments),
            undefined,
            `the runtime snapshot schema no longer declares ${segments.join(".")}, `
            + "which lib/snapshot-reader.js reads",
        );
    }
});

test("the pinned field list is the list the reader actually reads", () => {
    const reader = fs.readFileSync(path.join(appletRoot, "lib/snapshot-reader.js"), "utf8");
    for (const segments of CONSUMED_FIELDS) {
        const field = segments.at(-1);
        assert.equal(
            reader.includes(field),
            true,
            `lib/snapshot-reader.js no longer reads ${field}; drop it from this gate `
            + "or restore the read",
        );
    }
});

test("the panel's snapshot version is the version the schema pins", (t) => {
    const schema = readServiceJson(SCHEMA_PATH);
    if (schema === null) {
        t.skip(SKIP_REASON);
        return;
    }
    assert.equal(
        schema.properties.version.const,
        SnapshotReader.SNAPSHOT_VERSION,
        "the panel refuses every document the runtime publishes",
    );
});

// The panel names one device: the first available one in the runtime's own
// preference order. Ordering them differently here would label the desk with a
// device the scheduler would not have chosen.
test("the panel's backend order is the runtime's routing hierarchy", (t) => {
    const discovery = readServiceText("src/omnitensor/discovery.py");
    if (discovery === null) {
        t.skip(SKIP_REASON);
        return;
    }
    const match = /^BACKENDS = \((?<backends>[^)]*)\)$/mu.exec(discovery);
    assert.notEqual(match, null, "discovery.py no longer declares BACKENDS");
    const backends = [...match.groups.backends.matchAll(/"(?<name>[a-z]+)"/gu)]
        .map((entry) => entry.groups.name);
    assert.deepEqual(
        [...SnapshotReader.BACKEND_ORDER],
        backends,
        "the panel and the runtime disagree on which accelerator is preferred",
    );
});

// XTPU-0214: the staleness window is measured against the heartbeat, not
// against the busy publish cadence. An idle runtime publishes nothing but a
// proof of life, so any window shorter than one heartbeat reports every idle
// desk as stale, and one longer than two hides a runtime that has stopped for
// a full extra beat.
test("the staleness window is between one and two service heartbeats", (t) => {
    const serviceSource = readServiceText("src/omnitensor/service.py");
    if (serviceSource === null) {
        t.skip(SKIP_REASON);
        return;
    }
    const heartbeat = /^SNAPSHOT_HEARTBEAT_INTERVAL_S = (?<seconds>[\d.]+)$/mu.exec(serviceSource);
    assert.notEqual(
        heartbeat,
        null,
        "service.py no longer declares SNAPSHOT_HEARTBEAT_INTERVAL_S",
    );
    const heartbeatMs = Number(heartbeat.groups.seconds) * 1000;
    assert.ok(
        SnapshotReader.STALE_AFTER_MS > heartbeatMs,
        `${SnapshotReader.STALE_AFTER_MS} ms is shorter than the ${heartbeatMs} ms heartbeat: `
        + "an idle runtime would be reported stale",
    );
    assert.ok(
        SnapshotReader.STALE_AFTER_MS <= 2 * heartbeatMs,
        `${SnapshotReader.STALE_AFTER_MS} ms is more than two ${heartbeatMs} ms heartbeats: `
        + "a stopped runtime is named a beat later than it needs to be",
    );
});
