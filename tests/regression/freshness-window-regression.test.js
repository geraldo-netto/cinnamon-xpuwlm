"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const Domain = require("../../files/cinnamon-tpuwm@geraldo-netto/lib/domain.js");
const BuiltIns = require("../helpers/built-in-workloads.js");
const FailureBackoff = require("../../files/cinnamon-tpuwm@geraldo-netto/lib/failure-log-backoff.js");
const Manager = require("../../files/cinnamon-tpuwm@geraldo-netto/lib/manager.js");
const Runtime = require("../../files/cinnamon-tpuwm@geraldo-netto/lib/runtime-gateway.js");
const RuntimeSchema = require("../../files/cinnamon-tpuwm@geraldo-netto/lib/runtime-snapshot-schema-validator.js");
const ViewModel = require("../../files/cinnamon-tpuwm@geraldo-netto/lib/view-model.js");
const {readSnapshot} = require("../helpers/fakes.js");

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

// The 60-second refresh setting used to hold a snapshot on screen as online for
// 45 seconds beyond the 15-second stale threshold, because freshness was only
// re-evaluated when the poller happened to read again.
test("regression: a slow poll interval cannot present expired state as online", () => {
    const pollIntervalMs = 60_000;
    let nowMs = NOW;
    const timers = [];
    const manager = new Manager.WorkloadManager({
        workloadRegistry: BuiltIns.coreRegistry(),
        repository: {load: () => ({}), save() {}},
        runtimeGateway: {
            read: (options, callback) => callback(Domain.normalizeSnapshot({
                version: Domain.SNAPSHOT_VERSION,
                generatedAt: nowMs,
                device: {available: true, name: "Coral USB", kind: "usb"},
                metrics: {load: 40, queueDepth: 0, runningProfiles: 0},
                profiles: {},
                alerts: [],
            }, nowMs)),
        },
        errorReporter: {report() {}, recover() {}},
        clock: {now: () => nowMs},
        scheduler: {
            schedule(delayMs, callback) {
                timers.push({dueAt: nowMs + delayMs, callback});
                return timers.length;
            },
            cancel: (handle) => timers.splice(handle - 1, 1).length > 0,
        },
    });
    const models = [];
    manager.subscribe((state) => models.push(ViewModel.toViewModel(state, nowMs)));
    manager.start();
    assert.equal(models.at(-1).panel.status, "online");

    for (nowMs = NOW + 1000; nowMs < NOW + pollIntervalMs; nowMs += 1000) {
        for (const timer of timers.filter((candidate) => candidate.dueAt <= nowMs)) {
            timer.callback();
        }
        const online = models.at(-1).panel.status === "online";
        assert.equal(
            online,
            nowMs - NOW <= Domain.DEFAULT_STALE_AFTER_MS,
            `age ${nowMs - NOW}ms must not read as online past the freshness deadline`,
        );
        assert.equal(manager.state().stale, nowMs - NOW > Domain.DEFAULT_STALE_AFTER_MS);
    }
    assert.equal(models.at(-1).panel.status, "unavailable");
    manager.dispose();
});

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
            readTextAsync: (filename, options, callback) => callback(null, JSON.stringify(document)),
            detectDevice: () => {
                throw new Error("runtime documents must not trigger probing");
            },
            snapshotValidator: new RuntimeSchema.RuntimeSnapshotSchemaValidator(),
            warningReporter: new FailureBackoff.FailureWarningBackoff({logger: {warn() {}}}),
        });
        const adapted = readSnapshot(gateway);
        assert.equal(adapted.stale, true);
        assert.equal(adapted.device.available, false);
    }
});
