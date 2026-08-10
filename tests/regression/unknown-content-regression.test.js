"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const Domain = require("../../files/cinnamon-tpuwm@geraldo-netto/lib/domain.js");
const ViewModel = require("../../files/cinnamon-tpuwm@geraldo-netto/lib/view-model.js");
const BuiltIns = require("../helpers/built-in-workloads.js");

const NOW = 1_700_000_000_000;
const CATALOG = BuiltIns.coreCatalog();

function document(overrides = {}) {
    return {
        version: Domain.SNAPSHOT_VERSION,
        generatedAt: NOW,
        devices: [{id: "tpu-usb", backend: "tpu", available: true, name: "Coral USB", kind: "usb"}],
        metrics: {queueDepth: 0, runningProfiles: 0},
        profiles: {},
        alerts: [],
        ...overrides,
    };
}

function alert(profileId, id) {
    return {
        id,
        profileId,
        title: "Something happened",
        summary: "",
        severity: "warning",
        timestamp: NOW,
    };
}

// The runtime validates `profileId` only as a well-formed plug-in id, so it
// publishes alerts and profile telemetry for plug-ins the applet does not
// ship. Those were dropped with no trace at all: an alert the user was told to
// expect simply never appeared.
test("regression: content for workloads the applet lacks is counted, not silently dropped", () => {
    const snapshot = Domain.normalizeSnapshot(document({
        profiles: {
            "hardware-health": {status: "running", queued: 1},
            "third-party-vision": {status: "running", queued: 9},
        },
        alerts: [
            alert("hardware-health", "known"),
            alert("third-party-vision", "hidden-1"),
            alert("another-missing-plugin", "hidden-2"),
        ],
    }), NOW, Domain.DEFAULT_STALE_AFTER_MS, CATALOG);

    assert.deepEqual(snapshot.unknownContent, {profiles: 1, alerts: 2});
    assert.deepEqual(Object.keys(snapshot.profiles), ["hardware-health"]);
    assert.deepEqual(snapshot.alerts.map((entry) => entry.id), ["known"]);
});

test("regression: a snapshot the applet fully understands reports nothing discarded", () => {
    const snapshot = Domain.normalizeSnapshot(document({
        profiles: {"hardware-health": {status: "running", queued: 1}},
        alerts: [alert("hardware-health", "known")],
    }), NOW, Domain.DEFAULT_STALE_AFTER_MS, CATALOG);
    assert.deepEqual(snapshot.unknownContent, {profiles: 0, alerts: 0});
    assert.equal(ViewModel.unknownContentNotice({unknownContent: snapshot.unknownContent}), null);
});

// A snapshot the applet rejects outright says nothing about which workloads
// the runtime knows, so it must not claim anything was discarded either.
test("regression: rejected, stale, and probe snapshots claim no discarded content", () => {
    const rejected = Domain.normalizeSnapshot({version: 2}, NOW, Domain.DEFAULT_STALE_AFTER_MS, CATALOG);
    assert.deepEqual(rejected.unknownContent, Domain.NO_UNKNOWN_CONTENT);
    assert.deepEqual(Domain.staleSnapshot(NOW).unknownContent, Domain.NO_UNKNOWN_CONTENT);
    assert.deepEqual(Domain.probeSnapshot([], NOW).unknownContent, Domain.NO_UNKNOWN_CONTENT);

    const expired = Domain.expireSnapshot(
        Domain.normalizeSnapshot(document({
            alerts: [alert("missing-plugin", "hidden")],
        }), NOW, Domain.DEFAULT_STALE_AFTER_MS, CATALOG),
        NOW + Domain.DEFAULT_STALE_AFTER_MS + 1,
    );
    assert.equal(expired.stale, true);
    assert.deepEqual(expired.unknownContent, Domain.NO_UNKNOWN_CONTENT);
});
