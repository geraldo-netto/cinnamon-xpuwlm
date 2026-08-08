"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const Domain = require("../../lib/domain.js");
const Runtime = require("../../lib/runtime-gateway.js");

const NOW = 1_700_000_000_000;

function validSnapshot() {
    return {
        version: Domain.SNAPSHOT_VERSION,
        generatedAt: NOW - 500,
        device: {available: true, name: "Coral USB", kind: "usb", reason: ""},
        metrics: {load: 37.5, queueDepth: 4, runningProfiles: 2},
        profiles: {},
        alerts: [],
    };
}

test("UTF-8 byte counting is runtime-neutral", () => {
    assert.equal(Runtime.byteLength("abc"), 3);
    assert.equal(Runtime.byteLength("é"), 2);
    assert.equal(Runtime.byteLength("€"), 3);
    assert.equal(Runtime.byteLength("😀"), 4);
});

test("snapshot document parser rejects non-text, oversized, and malformed data", () => {
    assert.match(Runtime.parseSnapshotDocument(null, NOW).device.reason, /not text/);
    assert.match(Runtime.parseSnapshotDocument("x".repeat(Runtime.MAX_SNAPSHOT_BYTES + 1), NOW).device.reason, /exceeds/);
    assert.match(Runtime.parseSnapshotDocument("{", NOW).device.reason, /invalid JSON/);
    const parsed = Runtime.parseSnapshotDocument(JSON.stringify(validSnapshot()), NOW);
    assert.equal(parsed.source, "runtime");
    assert.equal(parsed.metrics.queueDepth, 4);
});

test("gateway validates dependencies", () => {
    const base = {readText() {}, detectDevice() {}, path: "/tmp/state"};
    assert.throws(() => new Runtime.RuntimeSnapshotGateway({...base, readText: null}), /reader/);
    assert.throws(() => new Runtime.RuntimeSnapshotGateway({...base, detectDevice: null}), /detector/);
    assert.throws(() => new Runtime.RuntimeSnapshotGateway({...base, clock: {}}), /clock/);
});

test("gateway prefers a non-empty runtime document", () => {
    let probes = 0;
    const gateway = new Runtime.RuntimeSnapshotGateway({
        path: "/run/tpuwm.json",
        clock: {now: () => NOW},
        readText(path) {
            assert.equal(path, "/run/tpuwm.json");
            return JSON.stringify(validSnapshot());
        },
        detectDevice() {
            probes += 1;
            return {};
        },
    });
    assert.equal(gateway.read().source, "runtime");
    assert.equal(probes, 0);
});

test("gateway probes on absent documents and logs read failures", () => {
    const warnings = [];
    const gateway = new Runtime.RuntimeSnapshotGateway({
        path: "",
        clock: {now: () => NOW},
        readText() {
            throw new Error("missing");
        },
        detectDevice() {
            return {available: true, name: "Coral", kind: "usb"};
        },
        logger: {warn: (message) => warnings.push(message)},
    });
    const result = gateway.read();
    assert.equal(result.source, "probe");
    assert.equal(result.device.available, true);
    assert.match(warnings[0], /Could not read/);
});

test("gateway fails closed when device probing throws", () => {
    const warnings = [];
    const gateway = new Runtime.RuntimeSnapshotGateway({
        clock: {now: () => NOW},
        staleAfterMs: 0,
        readText: () => " ",
        detectDevice() {
            throw new Error("denied");
        },
        logger: {warn: (message) => warnings.push(message)},
    });
    const result = gateway.read();
    assert.equal(result.source, "probe");
    assert.equal(result.device.available, false);
    assert.match(result.device.reason, /discovery failed/);
    assert.equal(warnings.length, 1);
    assert.equal(Domain.DEFAULT_STALE_AFTER_MS > 1000, true);
});

test("gateway default logger safely absorbs fallback failures", () => {
    const gateway = new Runtime.RuntimeSnapshotGateway({
        readText() { throw new Error("missing"); },
        detectDevice() { throw new Error("denied"); },
        path: "/missing",
        clock: {now: () => NOW},
    });
    assert.equal(gateway.read().device.available, false);
});
