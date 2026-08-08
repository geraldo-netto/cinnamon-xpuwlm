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

test("failure warning backoff is independent, exponential, bounded, and recoverable", () => {
    const warnings = [];
    const backoff = new Runtime.FailureWarningBackoff({
        logger: {warn: (message) => warnings.push(message)},
        initialDelayMs: 10,
        maximumDelayMs: 25,
    });

    assert.equal(backoff.warn("read", "read-1", 0), true);
    assert.equal(backoff.warn("read", "read-suppressed", 9), false);
    assert.equal(backoff.warn("probe", "probe-1", 9), true);
    assert.equal(backoff.warn("read", "read-2", 10), true);
    assert.equal(backoff.warn("read", "read-suppressed", 29), false);
    assert.equal(backoff.warn("read", "read-3", 30), true);
    assert.equal(backoff.warn("read", "read-suppressed", 54), false);
    assert.equal(backoff.warn("read", "read-4", 55), true);
    assert.deepEqual(warnings, ["read-1", "probe-1", "read-2", "read-3", "read-4"]);

    assert.equal(backoff.recover("missing"), false);
    assert.equal(backoff.recover("read"), true);
    assert.equal(backoff.warn("read", "read-after-recovery", 55), true);
    assert.equal(warnings.at(-1), "read-after-recovery");
});

test("failure warning backoff validates and normalizes configuration", () => {
    assert.throws(() => new Runtime.FailureWarningBackoff({logger: null}), /logger/);
    assert.throws(() => new Runtime.FailureWarningBackoff({logger: {}}), /logger/);
    assert.equal(Runtime.WARNING_INITIAL_DELAY_MS, 30_000);
    assert.equal(Runtime.WARNING_MAX_DELAY_MS, 900_000);
    assert.equal(Runtime.normalizeDelay("5.9", 20), 5);
    assert.equal(Runtime.normalizeDelay(-4, 20), 1);
    for (const value of [0, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
        assert.equal(Runtime.normalizeDelay(value, 20), 20);
    }
    const warnings = [];
    const backoff = new Runtime.FailureWarningBackoff({
        logger: {warn: (message) => warnings.push(message)},
        initialDelayMs: -10,
        maximumDelayMs: 0,
    });
    assert.equal(backoff.warn(7, "first", 0), true);
    assert.equal(backoff.warn("7", "suppressed", 0), false);
    assert.equal(backoff.warn(7, "default-delay", Runtime.WARNING_INITIAL_DELAY_MS), true);
    assert.deepEqual(warnings, ["first", "default-delay"]);

    const capped = new Runtime.FailureWarningBackoff({
        logger: {warn: (message) => warnings.push(message)},
        initialDelayMs: 600_000,
        maximumDelayMs: Number.POSITIVE_INFINITY,
    });
    assert.equal(capped.warn("read", "cap-1", 0), true);
    assert.equal(capped.warn("read", "cap-2", 600_000), true);
    assert.equal(capped.warn("read", "cap-suppressed", 1_499_999), false);
    assert.equal(capped.warn("read", "cap-3", 1_500_000), true);
});

test("failure warning backoff resets a channel after backward clock movement", () => {
    const warnings = [];
    const backoff = new Runtime.FailureWarningBackoff({
        logger: {warn: (message) => warnings.push(message)},
        initialDelayMs: 10,
        maximumDelayMs: 20,
    });

    assert.equal(backoff.warn("read", "first", 100), true);
    assert.equal(backoff.warn("read", "suppressed", 105), false);
    assert.equal(backoff.warn("read", "after-rollback", 90), true);
    assert.equal(backoff.warn("read", "suppressed-after-rollback", 99), false);
    assert.equal(backoff.warn("read", "due-after-rollback", 100), true);
    assert.deepEqual(warnings, ["first", "after-rollback", "due-after-rollback"]);

    assert.equal(backoff.warn("invalid-time", "invalid-first", Number.POSITIVE_INFINITY), true);
    assert.equal(backoff.warn("invalid-time", "invalid-suppressed", Number.NaN), false);
    assert.equal(backoff.warn("invalid-time", "invalid-due", 10), true);
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

test("gateway probes only when documents are absent", () => {
    const probes = [];
    const gateway = new Runtime.RuntimeSnapshotGateway({
        path: "/missing",
        clock: {now: () => NOW},
        readText: () => null,
        detectDevice(forceDeviceDetection) {
            probes.push(forceDeviceDetection);
            return {available: true, name: "Coral", kind: "usb"};
        },
    });
    assert.equal(gateway.read().source, "probe");
    assert.equal(gateway.read(null).source, "probe");
    assert.equal(gateway.read({forceDeviceDetection: true}).source, "probe");
    assert.deepEqual(probes, [false, false, true]);
});

test("gateway fails closed and logs runtime read failures", () => {
    const warnings = [];
    let probes = 0;
    const gateway = new Runtime.RuntimeSnapshotGateway({
        path: "",
        clock: {now: () => NOW},
        readText() {
            throw new Error("missing");
        },
        detectDevice() {
            probes += 1;
            return {available: true, name: "Coral", kind: "usb"};
        },
        logger: {warn: (message) => warnings.push(message)},
    });
    const result = gateway.read();
    assert.equal(result.source, "invalid");
    assert.equal(result.device.available, false);
    assert.equal(probes, 0);
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

test("gateway backs off read and probe warnings independently", () => {
    let nowMs = NOW;
    let readFails = true;
    let probeFails = true;
    const warnings = [];
    const gateway = new Runtime.RuntimeSnapshotGateway({
        path: "/run/tpuwm.json",
        clock: {now: () => nowMs},
        readText() {
            if (readFails) {
                throw new Error("read denied");
            }
            return null;
        },
        detectDevice() {
            if (probeFails) {
                throw new Error("probe denied");
            }
            return {available: false};
        },
        logger: {warn: (message) => warnings.push(message)},
    });

    assert.equal(gateway.read().source, "invalid");
    nowMs += 1;
    assert.equal(gateway.read().source, "invalid");
    assert.equal(warnings.length, 1);

    readFails = false;
    assert.equal(gateway.read().source, "probe");
    assert.equal(warnings.length, 2);
    nowMs += 1;
    assert.equal(gateway.read().source, "probe");
    assert.equal(warnings.length, 2);

    readFails = true;
    assert.equal(gateway.read().source, "invalid");
    assert.equal(warnings.length, 3);
    readFails = false;
    probeFails = false;
    assert.equal(gateway.read().source, "probe");
    probeFails = true;
    assert.equal(gateway.read().source, "probe");
    assert.equal(warnings.length, 4);
});

test("gateway default logger safely absorbs fallback failures", () => {
    const gateway = new Runtime.RuntimeSnapshotGateway({
        readText() { throw new Error("missing"); },
        detectDevice() { throw new Error("denied"); },
        path: "/missing",
        clock: {now: () => NOW},
    });
    const result = gateway.read();
    assert.equal(result.device.available, false);
    assert.equal(result.source, "invalid");
});
