"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const Domain = require("../../lib/domain.js");
const FailureBackoff = require("../../lib/failure-log-backoff.js");
const Runtime = require("../../lib/runtime-gateway.js");
const RuntimeSchema = require("../../lib/runtime-snapshot-schema-validator.js");

const NOW = 1_700_000_000_000;

function expiredDocument() {
    return {
        version: Domain.SNAPSHOT_VERSION,
        generatedAt: NOW - Domain.DEFAULT_STALE_AFTER_MS - 1,
        device: {available: true, name: "Coral USB", kind: "usb"},
        metrics: {load: null, queueDepth: 0, runningProfiles: 0},
        profiles: {},
        alerts: [],
    };
}

test("regression: non-finite freshness windows cannot keep runtime state connected", () => {
    const document = expiredDocument();
    for (const staleAfterMs of [
        Number.NaN,
        Number.POSITIVE_INFINITY,
        Number.NEGATIVE_INFINITY,
    ]) {
        const direct = Domain.normalizeSnapshot(document, NOW, staleAfterMs);
        assert.equal(direct.stale, true);
        assert.equal(direct.device.available, false);

        const gateway = new Runtime.RuntimeSnapshotGateway({
            path: "/run/tpuwm.json",
            clock: {now: () => NOW},
            staleAfterMs,
            readText: () => JSON.stringify(document),
            detectDevice: () => {
                throw new Error("runtime documents must not trigger probing");
            },
            snapshotValidator: new RuntimeSchema.RuntimeSnapshotSchemaValidator(),
            warningReporter: new FailureBackoff.FailureWarningBackoff({logger: {warn() {}}}),
        });
        const adapted = gateway.read();
        assert.equal(adapted.stale, true);
        assert.equal(adapted.device.available, false);
    }
});
