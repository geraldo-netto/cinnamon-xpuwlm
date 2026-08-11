"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const Domain = require("../../files/cinnamon-xpuwlm@geraldo-netto/lib/domain.js");
const FailureBackoff = require("../../files/cinnamon-xpuwlm@geraldo-netto/lib/failure-log-backoff.js");
const Manager = require("../../files/cinnamon-xpuwlm@geraldo-netto/lib/manager.js");
const BuiltIns = require("../helpers/built-in-workloads.js");

const NOW = 1_700_000_000_000;

function random(seed) {
    let state = seed >>> 0;
    return () => {
        state = ((state * 1664525) + 1013904223) >>> 0;
        return state / 0x100000000;
    };
}

function session() {
    let listener = null;
    const requests = [];
    const manager = new Manager.WorkloadManager({
        repository: {load: () => ({}), save() {}},
        runtimeGateway: {
            read: (_options, callback) => callback(Domain.probeSnapshot([], NOW)),
        },
        controlGateway: {
            send(command, callback) { requests.push({command, callback}); },
            cancel: () => false,
        },
        controlWatch: {
            watch(candidate) {
                listener = candidate;
                return () => {};
            },
        },
        clock: {now: () => NOW},
        errorReporter: new FailureBackoff.FailureErrorBackoff({logger: {warn() {}, error() {}}}),
        workloadRegistry: BuiltIns.coreRegistry(),
    });
    manager.start();
    return {announce: (value) => listener(value), manager, requests};
}

// However the bus stutters — repeats, restarts, hostile non-boolean values —
// availability must stay a faithful mirror of the last announcement, and a
// command must only ever reach the transport while the service is believed to
// be there.
test("fuzz: availability tracks the last announcement across hostile sequences", () => {
    const next = random(0xb0a7fee);
    const announcements = [true, false, true, false, 1, 0, "true", "", null, undefined, {}];
    for (let iteration = 0; iteration < 400; iteration += 1) {
        const {announce, manager, requests} = session();
        const length = 1 + Math.floor(next() * 8);
        let expected = null;
        for (let step = 0; step < length; step += 1) {
            const value = announcements[Math.floor(next() * announcements.length)];
            announce(value);
            expected = value === true;
            assert.equal(manager.state().control.available, expected, `iteration ${iteration}`);
        }

        const before = requests.length;
        const sent = manager.toggleProfile("hardware-health");
        assert.equal(sent, expected, `iteration ${iteration}: send follows availability`);
        assert.equal(requests.length - before, expected ? 1 : 0, `iteration ${iteration}`);
        assert.equal(
            manager.state().control.message.length > 0,
            true,
            `iteration ${iteration}: the user always gets a sentence`,
        );
        manager.dispose();
    }
});
