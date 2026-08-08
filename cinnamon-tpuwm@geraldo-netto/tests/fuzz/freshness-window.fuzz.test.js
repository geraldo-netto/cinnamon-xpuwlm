"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const Domain = require("../../lib/domain.js");
const FailureBackoff = require("../../lib/failure-log-backoff.js");
const Runtime = require("../../lib/runtime-gateway.js");

const NOW = 1_700_000_000_000;

function generator(seed) {
    let state = seed >>> 0;
    return () => {
        state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
        return state / 0x1_0000_0000;
    };
}

function runtimeDocument(ageMs) {
    return {
        version: Domain.SNAPSHOT_VERSION,
        generatedAt: NOW - ageMs,
        device: {available: true, name: "Coral USB", kind: "usb"},
        metrics: {},
        profiles: {},
        alerts: [],
    };
}

test("fuzz: freshness normalization always produces a finite bounded window", () => {
    const random = generator(0x46524553);
    const nonFinite = [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY];

    for (let iteration = 0; iteration < 2000; iteration += 1) {
        const useNonFinite = random() < 0.5;
        const candidate = useNonFinite
            ? nonFinite[Math.floor(random() * nonFinite.length)]
            : (random() - 0.25) * 1_000_000;
        const normalized = Domain.normalizeStaleAfterMs(candidate);
        assert.equal(Number.isFinite(normalized), true);
        assert.equal(normalized >= 1000, true);
        if (useNonFinite) {
            assert.equal(normalized, Domain.DEFAULT_STALE_AFTER_MS);
        } else if (candidate !== 0) {
            assert.equal(normalized, Math.max(1000, candidate));
        }
    }
});

test("fuzz: non-finite windows expire old snapshots through every adapter path", () => {
    const random = generator(0x45585049);
    const nonFinite = [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY];

    for (let iteration = 0; iteration < 500; iteration += 1) {
        const staleAfterMs = nonFinite[Math.floor(random() * nonFinite.length)];
        const ageMs = Domain.DEFAULT_STALE_AFTER_MS + 1 + Math.floor(random() * 1_000_000);
        const document = runtimeDocument(ageMs);
        assert.equal(Domain.normalizeSnapshot(document, NOW, staleAfterMs).stale, true);

        const gateway = new Runtime.RuntimeSnapshotGateway({
            clock: {now: () => NOW},
            staleAfterMs,
            path: "/run/tpuwm.json",
            readText: () => JSON.stringify(document),
            detectDevice: () => null,
            warningReporter: new FailureBackoff.FailureWarningBackoff({logger: {warn() {}}}),
        });
        assert.equal(gateway.read().stale, true);
    }
});
