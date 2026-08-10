"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const Domain = require("../../files/cinnamon-tpuwm@geraldo-netto/lib/domain.js");
const FailureBackoff = require("../../files/cinnamon-tpuwm@geraldo-netto/lib/failure-log-backoff.js");
const Manager = require("../../files/cinnamon-tpuwm@geraldo-netto/lib/manager.js");
const ControlService = require("../../files/cinnamon-tpuwm@geraldo-netto/lib/runtime-control-service.js");
const BuiltIns = require("../helpers/built-in-workloads.js");

const NOW = 1_700_000_000_000;
const PROFILE_IDS = BuiltIns.coreCatalog().definitions().map((definition) => definition.id);

function random(seed) {
    let state = seed >>> 0;
    return () => {
        state = ((state * 1664525) + 1013904223) >>> 0;
        return state / 0x100000000;
    };
}

function session(startingRevision) {
    const policy = {
        revision: startingRevision,
        portfolio: new Domain.WorkloadPortfolio(null, BuiltIns.coreCatalog()).serialize(),
    };
    const service = new ControlService.RuntimeControlService({
        repository: {
            load: () => structuredClone(policy),
            save: (value) => Object.assign(policy, structuredClone(value)),
        },
        catalog: BuiltIns.coreCatalog(),
        clock: {now: () => NOW},
    });
    const commands = [];
    const manager = new Manager.WorkloadManager({
        repository: {load: () => ({}), save() {}},
        runtimeGateway: {
            read: (_options, callback) => callback(Domain.probeSnapshot([], NOW)),
        },
        controlGateway: {
            send(command, callback) {
                commands.push(command);
                callback(null, service.handle(command));
            },
            cancel: () => false,
        },
        clock: {now: () => NOW},
        errorReporter: new FailureBackoff.FailureErrorBackoff({logger: {warn() {}, error() {}}}),
        workloadRegistry: BuiltIns.coreRegistry(),
    });
    manager.start();
    return {commands, manager, service};
}

// Whatever revision the runtime happens to be on when the applet starts, the
// user's first change must land, cost at most one extra round trip, and leave
// no message behind.
test("fuzz: a cold session converges on the runtime revision within one resend", () => {
    const next = random(0x5eed1e);
    for (let iteration = 0; iteration < 300; iteration += 1) {
        const startingRevision = Math.floor(next() * 5000);
        const {commands, manager, service} = session(startingRevision);
        const profileId = PROFILE_IDS[Math.floor(next() * PROFILE_IDS.length)];

        assert.equal(manager.toggleProfile(profileId), true, `iteration ${iteration}`);
        assert.equal(commands.length <= 2, true, `iteration ${iteration}: ${commands.length} attempts`);
        assert.equal(service.state().revision, startingRevision + 1, `iteration ${iteration}`);
        assert.equal(
            service.state().portfolio.profiles[profileId].enabled,
            commands[0].value,
            `iteration ${iteration}`,
        );
        assert.equal(manager.state().control.message, "", `iteration ${iteration}`);
        assert.equal(manager.state().control.pending, false, `iteration ${iteration}`);

        // Later commands reuse the learned revision, so the resend never
        // becomes a per-command tax.
        const attemptsBefore = commands.length;
        assert.equal(manager.toggleProfile(profileId), true, `iteration ${iteration}`);
        assert.equal(commands.length - attemptsBefore, 1, `iteration ${iteration}`);
        manager.dispose();
    }
});
