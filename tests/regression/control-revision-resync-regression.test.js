"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const Domain = require("../../files/cinnamon-xpuwlm@geraldo-netto/lib/domain.js");
const FailureBackoff = require("../../files/cinnamon-xpuwlm@geraldo-netto/lib/failure-log-backoff.js");
const Manager = require("../../files/cinnamon-xpuwlm@geraldo-netto/lib/manager.js");
const ControlService = require("../../files/cinnamon-xpuwlm@geraldo-netto/lib/runtime-control-service.js");
const BuiltIns = require("../helpers/built-in-workloads.js");

const NOW = 1_700_000_000_000;

// Drives the real control service, which is what rejects a stale
// `expectedRevision`, so the fix is exercised against the rule it works
// around rather than against a hand-written acknowledgement.
function harness(startingRevision) {
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
    const errors = [];
    const logger = {warn() {}, error: (message) => errors.push(message)};
    const manager = new Manager.WorkloadManager({
        repository: {load: () => ({}), save() {}},
        runtimeGateway: {
            read: (_options, callback) => callback(Domain.probeSnapshot(
                [{id: "tpu-usb", backend: "tpu", available: true, name: "Coral", kind: "usb"}],
                NOW,
            )),
        },
        controlGateway: {
            send(command, callback) {
                commands.push(command);
                callback(null, service.handle(command));
            },
            cancel: () => false,
        },
        clock: {now: () => NOW},
        errorReporter: new FailureBackoff.FailureErrorBackoff({logger}),
        logger,
        workloadRegistry: BuiltIns.coreRegistry(),
    });
    return {commands, errors, manager, service};
}

// The applet initialised its revision to 0 and only ever learned the real one
// from an acknowledgement, and the snapshot carries no `revision`. Every
// restart therefore burned the user's first click on a rejection they had to
// repeat by hand.
test("regression: the first command of a session lands without a user-visible rejection", () => {
    const {commands, errors, manager, service} = harness(5);
    manager.start();

    assert.equal(manager.toggleProfile("hardware-health"), true);
    assert.equal(commands.length, 2, "one cold rejection, one corrected resend");
    assert.equal(commands[0].expectedRevision, 0);
    assert.equal(commands[1].expectedRevision, 5);
    assert.equal(service.state().revision, 6, "the change reached the runtime");
    assert.equal(
        service.state().portfolio.profiles["hardware-health"].enabled,
        commands[0].value,
        "the resend carried the value the user chose",
    );

    const state = manager.state();
    assert.equal(state.control.pending, false);
    assert.equal(state.control.message, "", "the user never sees the revision rejection");
    assert.deepEqual(errors, []);
});

test("regression: a session that starts in step spends no extra round trip", () => {
    const {commands, manager, service} = harness(0);
    manager.start();

    assert.equal(manager.toggleProfile("hardware-health"), true);
    assert.equal(commands.length, 1);
    assert.equal(service.state().revision, 1);
    assert.equal(manager.state().control.message, "");
});
