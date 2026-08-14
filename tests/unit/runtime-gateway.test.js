"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const Domain = require("../../files/cinnamon-xpuwlm@geraldo-netto/lib/domain.js");
const FailureBackoff = require("../../files/cinnamon-xpuwlm@geraldo-netto/lib/failure-log-backoff.js");
const Runtime = require("../../files/cinnamon-xpuwlm@geraldo-netto/lib/runtime-gateway.js");
const RuntimeSchema = require("../../files/cinnamon-xpuwlm@geraldo-netto/lib/runtime-snapshot-schema-validator.js");
const {readSnapshot} = require("../helpers/fakes.js");

const NOW = 1_700_000_000_000;

function warningReporter(logger = {warn() {}}) {
    return new FailureBackoff.FailureWarningBackoff({logger});
}

function snapshotValidator() {
    return new RuntimeSchema.RuntimeSnapshotSchemaValidator();
}

function validSnapshot() {
    return {
        version: Domain.SNAPSHOT_VERSION,
        generatedAt: NOW - 500,
        devices: [{
            id: "tpu-usb",
            backend: "tpu",
            available: true,
            name: "Coral USB",
            kind: "usb",
            load: 37.5,
            reason: "",
        }],
        metrics: {queueDepth: 4, runningProfiles: 2},
        profiles: {},
        alerts: [],
    };
}

test("UTF-8 byte counting is runtime-neutral", () => {
    assert.equal(Runtime.byteLength("abc"), 3);
    assert.equal(Runtime.byteLength("é"), 2);
    assert.equal(Runtime.byteLength("€"), 3);
    assert.equal(Runtime.byteLength("😀"), 4);
    assert.equal(Runtime.byteLength("\u007f"), 1);
    assert.equal(Runtime.byteLength("\u07ff"), 2);
    assert.equal(Runtime.byteLength("\uffff"), 3);
});

test("snapshot document parser rejects non-text, oversized, and malformed data", () => {
    const validator = snapshotValidator();
    assert.match(Runtime.parseSnapshotDocument(null, NOW, validator).health.detail, /not text/);
    assert.match(Runtime.parseSnapshotDocument(
        "x".repeat(Runtime.MAX_SNAPSHOT_BYTES + 1),
        NOW,
        validator,
    ).health.detail, /exceeds/);
    assert.match(Runtime.parseSnapshotDocument(
        "x".repeat(Runtime.MAX_SNAPSHOT_BYTES),
        NOW,
        validator,
    ).health.detail, /invalid JSON/u);
    assert.match(Runtime.parseSnapshotDocument("{", NOW, validator).health.detail, /invalid JSON/);
    const parsed = Runtime.parseSnapshotDocument(JSON.stringify(validSnapshot()), NOW, validator);
    assert.equal(parsed.source, "runtime");
    assert.equal(parsed.metrics.queueDepth, 4);

    assert.match(Runtime.parseSnapshotDocument(
        JSON.stringify({...validSnapshot(), extra: true}),
        NOW,
        validator,
    ).health.detail, /does not match/u);
    assert.match(Runtime.parseSnapshotDocument(
        JSON.stringify(validSnapshot()),
        NOW,
        {validate() { throw new Error("validator unavailable"); }},
    ).health.detail, /validation failed/u);
    assert.match(Runtime.parseSnapshotDocument(
        JSON.stringify(validSnapshot()),
        NOW,
        {validate: () => true},
    ).health.detail, /validation failed/u);
});

test("snapshot parser applies injected workload catalog", () => {
    const catalog = new Domain.WorkloadCatalog([{
        id: "custom-workload",
        title: "Custom",
        group: "Custom",
        description: "Injected workload",
        icon: "applications-science-symbolic",
        order: 10,
        defaultEnabled: true,
        defaultWeight: 2,
        executable: true,
        gpuCapable: true,
    }]);
    const candidate = validSnapshot();
    candidate.metrics.runningProfiles = 8;
    candidate.profiles["custom-workload"] = {status: "running", queued: 1, detail: "active"};
    const parsed = Runtime.parseSnapshotDocument(
        JSON.stringify(candidate),
        NOW,
        snapshotValidator(),
        Domain.DEFAULT_STALE_AFTER_MS,
        catalog,
    );
    assert.equal(parsed.metrics.runningProfiles, 1);
    assert.deepEqual(Object.keys(parsed.profiles), ["custom-workload"]);
    assert.throws(
        () => new Runtime.RuntimeSnapshotGateway({
            readTextAsync() {},
            detectDevice() {},
            path: "/tmp/state",
            snapshotValidator: snapshotValidator(),
            warningReporter: warningReporter(),
            workloadCatalog: {},
        }),
        /catalog/u,
    );
});

test("gateway validates dependencies", () => {
    const base = {
        readTextAsync() {},
        detectDevice() {},
        path: "/tmp/state",
        snapshotValidator: snapshotValidator(),
        warningReporter: warningReporter(),
    };
    assert.throws(() => new Runtime.RuntimeSnapshotGateway({...base, readTextAsync: null}), /reader/);
    assert.throws(
        () => new Runtime.RuntimeSnapshotGateway({...base, cancellableFactory: null}),
        /cancellable/,
    );
    assert.throws(() => new Runtime.RuntimeSnapshotGateway({...base, detectDevice: null}), /detector/);
    assert.throws(() => new Runtime.RuntimeSnapshotGateway({...base, clock: {}}), /clock/);
    assert.throws(() => new Runtime.RuntimeSnapshotGateway({...base, snapshotValidator: {}}), /validator/);
    assert.throws(() => new Runtime.RuntimeSnapshotGateway({...base, warningReporter: {}}), /reporter/);
});

test("failure warning backoff is independent, exponential, bounded, and recoverable", () => {
    const warnings = [];
    const backoff = new FailureBackoff.FailureWarningBackoff({
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
    assert.throws(() => new FailureBackoff.FailureWarningBackoff({logger: null}), /logger/);
    assert.throws(() => new FailureBackoff.FailureWarningBackoff({logger: {}}), /logger/);
    assert.equal(FailureBackoff.FAILURE_INITIAL_DELAY_MS, 30_000);
    assert.equal(FailureBackoff.FAILURE_MAX_DELAY_MS, 900_000);
    assert.equal(FailureBackoff.normalizeDelay("5.9", 20), 5);
    assert.equal(FailureBackoff.normalizeDelay(-4, 20), 1);
    for (const value of [0, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
        assert.equal(FailureBackoff.normalizeDelay(value, 20), 20);
    }
    const warnings = [];
    const backoff = new FailureBackoff.FailureWarningBackoff({
        logger: {warn: (message) => warnings.push(message)},
        initialDelayMs: -10,
        maximumDelayMs: 0,
    });
    assert.equal(backoff.warn(7, "first", 0), true);
    assert.equal(backoff.warn("7", "suppressed", 0), false);
    assert.equal(backoff.warn(7, "default-delay", FailureBackoff.FAILURE_INITIAL_DELAY_MS), true);
    assert.deepEqual(warnings, ["first", "default-delay"]);

    const capped = new FailureBackoff.FailureWarningBackoff({
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
    const backoff = new FailureBackoff.FailureWarningBackoff({
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
        path: "/run/xpuwlm.json",
        clock: {now: () => NOW},
        readTextAsync(filename, options, callback) {
            assert.equal(filename, "/run/xpuwlm.json");
            callback(null, JSON.stringify(validSnapshot()));
        },
        detectDevice() {
            probes += 1;
            return {};
        },
        snapshotValidator: snapshotValidator(),
        warningReporter: warningReporter(),
    });
    assert.equal(readSnapshot(gateway).source, "runtime");
    assert.equal(probes, 0);
});

test("gateway probes only when documents are absent", () => {
    const probes = [];
    const gateway = new Runtime.RuntimeSnapshotGateway({
        path: "/missing",
        clock: {now: () => NOW},
        readTextAsync: (filename, options, callback) => callback(null, null),
        detectDevice(forceDeviceDetection) {
            probes.push(forceDeviceDetection);
            return [{id: "tpu-usb", backend: "tpu", available: true, name: "Coral", kind: "usb"}];
        },
        snapshotValidator: snapshotValidator(),
        warningReporter: warningReporter(),
    });
    assert.equal(readSnapshot(gateway).source, "probe");
    assert.equal(readSnapshot(gateway, null).source, "probe");
    assert.equal(readSnapshot(gateway, {forceDeviceDetection: true}).source, "probe");
    assert.throws(() => gateway.read({}), /callback/);
    assert.deepEqual(probes, [false, false, true]);
});

test("gateway rejects present non-text documents without probing", () => {
    const documents = [undefined, false, 0, 42, {}, []];
    let index = 0;
    let probes = 0;
    const gateway = new Runtime.RuntimeSnapshotGateway({
        path: "/run/xpuwlm.json",
        clock: {now: () => NOW},
        readTextAsync: (filename, options, callback) => callback(null, documents[index]),
        detectDevice() {
            probes += 1;
            return [{id: "tpu-usb", backend: "tpu", available: true, name: "Coral", kind: "usb"}];
        },
        snapshotValidator: snapshotValidator(),
        warningReporter: warningReporter(),
    });

    for (index = 0; index < documents.length; index += 1) {
        const snapshot = readSnapshot(gateway);
        assert.equal(snapshot.source, "invalid");
        assert.deepEqual(snapshot.devices, []);
        assert.match(snapshot.health.detail, /not text/u);
    }
    assert.equal(probes, 0);
});

test("gateway fails closed and logs runtime read failures", () => {
    const warnings = [];
    let probes = 0;
    const gateway = new Runtime.RuntimeSnapshotGateway({
        path: "",
        clock: {now: () => NOW},
        readTextAsync(filename, options, callback) { callback(new Error("missing"), null); },
        detectDevice() {
            probes += 1;
            return [{id: "tpu-usb", backend: "tpu", available: true, name: "Coral", kind: "usb"}];
        },
        snapshotValidator: snapshotValidator(),
        warningReporter: warningReporter({warn: (message) => warnings.push(message)}),
    });
    const result = readSnapshot(gateway);
    assert.equal(result.source, "error");
    assert.deepEqual(result.devices, []);
    assert.equal(probes, 0);
    assert.match(warnings[0], /Could not read/);
});

test("gateway fails closed when device probing throws", () => {
    const warnings = [];
    const gateway = new Runtime.RuntimeSnapshotGateway({
        clock: {now: () => NOW},
        staleAfterMs: 0,
        readTextAsync: (filename, options, callback) => callback(null, " "),
        detectDevice() {
            throw new Error("denied");
        },
        snapshotValidator: snapshotValidator(),
        warningReporter: warningReporter({warn: (message) => warnings.push(message)}),
    });
    const result = readSnapshot(gateway);
    assert.equal(result.source, "probe");
    assert.deepEqual(result.devices, []);
    assert.match(result.health.detail, /discovery failed/);
    assert.equal(warnings.length, 1);
    assert.equal(Domain.DEFAULT_STALE_AFTER_MS > 1000, true);
});

test("gateway fails closed when asynchronous device probing reports an error", () => {
    const reports = [];
    const subject = new Runtime.RuntimeSnapshotGateway({
        path: "/missing",
        clock: {now: () => NOW},
        readTextAsync: (path, options, callback) => callback(null, null),
        detectDevice: (forceRefresh, options, callback) => callback(new Error("async denied"), null),
        snapshotValidator: snapshotValidator(),
        warningReporter: {
            report: (key, message) => reports.push([key, message]),
            recover() {},
        },
    });
    const snapshot = readSnapshot(subject);
    assert.equal(snapshot.source, "probe");
    assert.match(snapshot.health.detail, /failed/u);
    assert.match(reports[0][1], /async denied/u);
});

test("gateway backs off read and probe warnings independently", () => {
    let nowMs = NOW;
    let readFails = true;
    let probeFails = true;
    const warnings = [];
    const gateway = new Runtime.RuntimeSnapshotGateway({
        path: "/run/xpuwlm.json",
        clock: {now: () => nowMs},
        readTextAsync(filename, options, callback) {
            if (readFails) {
                callback(new Error("read denied"), null);
                return;
            }
            callback(null, null);
        },
        detectDevice() {
            if (probeFails) {
                throw new Error("probe denied");
            }
            return {available: false};
        },
        snapshotValidator: snapshotValidator(),
        warningReporter: warningReporter({warn: (message) => warnings.push(message)}),
    });

    assert.equal(readSnapshot(gateway).source, "error");
    nowMs += 1;
    assert.equal(readSnapshot(gateway).source, "error");
    assert.equal(warnings.length, 1);

    readFails = false;
    assert.equal(readSnapshot(gateway).source, "probe");
    assert.equal(warnings.length, 2);
    nowMs += 1;
    assert.equal(readSnapshot(gateway).source, "probe");
    assert.equal(warnings.length, 2);

    readFails = true;
    assert.equal(readSnapshot(gateway).source, "error");
    assert.equal(warnings.length, 3);
    readFails = false;
    probeFails = false;
    assert.equal(readSnapshot(gateway).source, "probe");
    probeFails = true;
    assert.equal(readSnapshot(gateway).source, "probe");
    assert.equal(warnings.length, 4);
});

test("gateway silent reporter safely absorbs fallback failures", () => {
    const gateway = new Runtime.RuntimeSnapshotGateway({
        readTextAsync(filename, options, callback) { callback(new Error("missing"), null); },
        detectDevice() { throw new Error("denied"); },
        path: "/missing",
        clock: {now: () => NOW},
        snapshotValidator: snapshotValidator(),
        warningReporter: warningReporter(),
    });
    const result = readSnapshot(gateway);
    assert.deepEqual(result.devices, []);
    assert.equal(result.source, "error");
});
