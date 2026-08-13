"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const Telemetry = require("../../files/cinnamon-xpuwlm@geraldo-netto/lib/telemetry-window.js");

function clock(values) {
    let index = 0;
    return () => values[index++];
}

function windowOptions(overrides = {}) {
    return {
        clock: clock([10, 11, 12, 13, 14]),
        redact: (raw) => ({load: raw.load, busy: raw.busy}),
        featureSchema: {version: 2, names: ["load", "busy"]},
        maxSamples: 8,
        retentionMs: 100,
        ...overrides,
    };
}

test("telemetry stays inert until consent and replays redacted loss recovery", () => {
    const redactions = [];
    const telemetry = new Telemetry.TelemetryWindow(windowOptions({
        redact: (raw, context) => {
            redactions.push({raw, context});
            return {load: raw.load, busy: raw.busy};
        },
    }));
    const raw = {load: 0.5, busy: true, secret: "/private/source/path"};

    assert.equal(telemetry.consented(), false);
    assert.equal(telemetry.capture("desktop.cpu", raw), false);
    assert.equal(telemetry.markMissing("desktop.cpu", "source-offline"), false);
    assert.equal(telemetry.recover("desktop.cpu"), false);
    assert.equal(redactions.length, 0);
    assert.equal(telemetry.setConsent(true), true);
    assert.equal(telemetry.setConsent(true), false);
    telemetry.capture("desktop.cpu", raw);
    telemetry.markMissing("desktop.cpu", "source-offline");
    assert.throws(() => telemetry.capture("desktop.cpu", raw), /has not recovered/u);
    telemetry.recover("desktop.cpu");
    telemetry.capture("desktop.cpu", {load: 0.25, busy: false, secret: "still-private"});

    const replay = telemetry.replay();
    assert.equal(replay.version, 1);
    assert.equal(replay.consented, true);
    assert.deepEqual(replay.featureSchema, {version: 2, names: ["load", "busy"]});
    assert.deepEqual(replay.entries.map((entry) => [
        entry.sequence, entry.monotonicMs, entry.kind, entry.reasonCode, entry.features,
    ]), [
        [1, 10, "sample", null, {load: 0.5, busy: true}],
        [2, 11, "missing", "source-offline", {load: null, busy: null}],
        [3, 12, "recovered", "source-offline", {load: null, busy: null}],
        [4, 13, "sample", null, {load: 0.25, busy: false}],
    ]);
    assert.deepEqual(redactions.map((item) => item.context), [
        {sourceId: "desktop.cpu", featureVersion: 2},
        {sourceId: "desktop.cpu", featureVersion: 2},
    ]);
    assert.equal(JSON.stringify(replay).includes("private"), false);
    assert.equal(Object.isFrozen(replay), true);
    assert.equal(Object.isFrozen(replay.entries[0].features), true);
    assert.equal(telemetry.setConsent(false), true);
    assert.deepEqual(telemetry.replay(), {
        version: 1,
        consented: false,
        featureSchema: {version: 2, names: ["load", "busy"]},
        oldestSequence: 1,
        latestSequence: 0,
        historyGap: false,
        hasMore: false,
        nextSequence: 0,
        entries: [],
    });
});

test("telemetry enforces count, time retention, replay cursors, and gaps", () => {
    const telemetry = new Telemetry.TelemetryWindow(windowOptions({
        clock: clock([0, 1, 2, 3, 4, 20]),
        maxSamples: 3,
        retentionMs: 10,
    }));
    telemetry.setConsent(true);
    for (let index = 0; index < 4; index += 1) {
        telemetry.capture("desktop.gpu", {load: index, busy: false});
    }

    const page = telemetry.replay({afterSequence: 1, limit: 2});
    assert.deepEqual(page.entries.map((entry) => entry.sequence), [2, 3]);
    assert.equal(page.oldestSequence, 2);
    assert.equal(page.latestSequence, 4);
    assert.equal(page.historyGap, false);
    assert.equal(page.hasMore, true);
    assert.equal(page.nextSequence, 3);

    const expired = telemetry.replay({afterSequence: 3, limit: 2});
    assert.deepEqual(expired.entries, []);
    assert.equal(expired.oldestSequence, 5);
    assert.equal(expired.latestSequence, 4);
    assert.equal(expired.historyGap, true);
    assert.equal(expired.hasMore, false);
    assert.equal(expired.nextSequence, 3);
});

test("telemetry validates schemas, ports, values, identifiers, and clocks", () => {
    const invalidOptions = [
        {...windowOptions(), clock: null},
        {...windowOptions(), redact: null},
        {...windowOptions(), featureSchema: {version: 0, names: ["load"]}},
        {...windowOptions(), featureSchema: {version: 1, names: ["load", "load"]}},
        {...windowOptions(), featureSchema: {version: 1, names: []}},
        {...windowOptions(), maxSamples: 0},
        {...windowOptions(), retentionMs: Telemetry.MAX_RETENTION_MS + 1},
    ];
    for (const options of invalidOptions) {
        assert.throws(() => new Telemetry.TelemetryWindow(options), Telemetry.TelemetryError);
    }
    assert.equal(Telemetry.validFeatureSchema({version: 1, names: ["a", "b"]}), true);
    assert.equal(Telemetry.validFeatureSchema({version: 1, names: ["Bad name"]}), false);
    assert.equal(Telemetry.validFeatures({a: null, b: true, c: 1.5}, ["a", "b", "c"]), true);
    assert.equal(Telemetry.validFeatures({a: Number.NaN}, ["a"]), false);

    const telemetry = new Telemetry.TelemetryWindow(windowOptions({clock: clock([4, 3])}));
    assert.throws(() => telemetry.setConsent("yes"), /must be boolean/u);
    telemetry.setConsent(true);
    assert.throws(() => telemetry.capture("Bad source", {}), /source id/u);
    assert.throws(() => telemetry.recover("Bad source"), /source id/u);
    assert.throws(() => telemetry.markMissing("Bad source", "read-failed"), /marker/u);
    assert.throws(() => telemetry.markMissing("desktop.cpu", "Bad reason"), /marker/u);
    assert.throws(() => telemetry.replay({afterSequence: -1}), /replay request/u);
    assert.throws(() => telemetry.replay({limit: Telemetry.MAX_REPLAY_SAMPLES + 1}), /replay request/u);
    telemetry.capture("desktop.cpu", {load: 1, busy: true});
    assert.throws(() => telemetry.replay(), /moved backwards/u);

    const badFeatures = new Telemetry.TelemetryWindow(windowOptions({
        clock: () => 1,
        redact: () => ({load: 1}),
    }));
    badFeatures.setConsent(true);
    assert.throws(() => badFeatures.capture("desktop.cpu", {}), /invalid telemetry features/u);
});

test("recovery is explicit and absent recovery is a no-op", () => {
    const telemetry = new Telemetry.TelemetryWindow(windowOptions({clock: clock([1, 2, 3])}));
    telemetry.setConsent(true);
    assert.equal(telemetry.recover("desktop.cpu"), false);
    telemetry.markMissing("desktop.cpu", "read-failed");
    telemetry.markMissing("desktop.cpu", "device-gone");
    const recovered = telemetry.recover("desktop.cpu");
    assert.equal(recovered.kind, "recovered");
    assert.equal(recovered.reasonCode, "device-gone");
});
