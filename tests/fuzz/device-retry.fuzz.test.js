"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const Cinnamon = require("../../files/cinnamon-tpuwm@geraldo-netto/lib/cinnamon-runtime.js");
const FailureBackoff = require("../../files/cinnamon-tpuwm@geraldo-netto/lib/failure-log-backoff.js");
const Manager = require("../../files/cinnamon-tpuwm@geraldo-netto/lib/manager.js");
const Runtime = require("../../files/cinnamon-tpuwm@geraldo-netto/lib/runtime-gateway.js");
const RuntimeSchema = require("../../files/cinnamon-tpuwm@geraldo-netto/lib/runtime-snapshot-schema-validator.js");

const CACHE_MS = 100;

function nextRandom(generator) {
    let value = generator.value;
    value ^= value << 13;
    value ^= value >>> 17;
    value ^= value << 5;
    generator.value = value >>> 0;
    return generator.value;
}

function mutableDeviceEnvironment() {
    let connected = false;
    return {
        environment: {
            Gio: {
                File: {
                    new_for_path(path) {
                        return {
                            query_exists: () => connected && path === "/dev/apex_0",
                        };
                    },
                },
            },
        },
        isConnected: () => connected,
        setConnected(value) {
            connected = value;
        },
    };
}

test("fuzz: explicit retries observe current hardware across cached state transitions", () => {
    let nowMs = 0;
    const clock = {now: () => nowMs};
    const device = mutableDeviceEnvironment();
    const detector = new Cinnamon.CachedDeviceDetector(device.environment, clock, CACHE_MS);
    const logger = {warn() {}, error() {}};
    const gateway = new Runtime.RuntimeSnapshotGateway({
        clock,
        path: "/missing/runtime.json",
        readTextAsync: (filename, options, callback) => callback(null, null),
        detectDevice: (forceRefresh) => detector.detect(forceRefresh),
        snapshotValidator: new RuntimeSchema.RuntimeSnapshotSchemaValidator(),
        warningReporter: new FailureBackoff.FailureWarningBackoff({logger}),
    });
    const manager = new Manager.WorkloadManager({
        clock,
        repository: {load: () => ({}), save() {}},
        runtimeGateway: gateway,
        errorReporter: new FailureBackoff.FailureErrorBackoff({logger}),
    });
    const generator = {value: 0x1a2b3c4d};
    let expectedCached = false;
    let cachedAt = nowMs;
    manager.start();

    for (let index = 0; index < 1_000; index += 1) {
        device.setConnected((nextRandom(generator) & 1) === 1);
        nowMs += nextRandom(generator) % 151;
        if (nowMs - cachedAt >= CACHE_MS) {
            expectedCached = device.isConnected();
        }

        manager.refresh();
        assert.equal(manager.state().device.available, expectedCached);

        manager.retryDeviceDetection();
        assert.equal(manager.state().device.available, device.isConnected());
        expectedCached = device.isConnected();
        cachedAt = nowMs;
    }
});
