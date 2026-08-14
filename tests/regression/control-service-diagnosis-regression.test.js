"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const Domain = require("../../files/cinnamon-xpuwlm@geraldo-netto/lib/domain.js");
const FailureBackoff = require("../../files/cinnamon-xpuwlm@geraldo-netto/lib/failure-log-backoff.js");
const Contract = require("../../files/cinnamon-xpuwlm@geraldo-netto/lib/runtime-control-contract.js");
const Gateway = require("../../files/cinnamon-xpuwlm@geraldo-netto/lib/runtime-control-gateway.js");
const Manager = require("../../files/cinnamon-xpuwlm@geraldo-netto/lib/manager.js");
const BuiltIns = require("../helpers/built-in-workloads.js");

const NOW = 1_700_000_000_000;

function managerFor(replyText) {
    const controlGateway = new Gateway.RuntimeControlGateway({
        sendText: (_text, _options, callback) => callback(null, replyText),
    });
    return new Manager.WorkloadManager({
        repository: {load: () => ({}), save() {}},
        runtimeGateway: {
            read: (_options, callback) => callback(Domain.probeSnapshot(
                [{id: "tpu-usb", backend: "tpu", available: true, name: "Coral", kind: "usb"}],
                NOW,
            )),
        },
        controlGateway,
        clock: {now: () => NOW},
        errorReporter: new FailureBackoff.FailureErrorBackoff({logger: {warn() {}, error() {}}}),
        workloadRegistry: BuiltIns.coreRegistry(),
    });
}

// Every failure that was not a name-resolution or timeout error used to end up
// as "The runtime service could not apply the change", so an older service, a
// wrong reply signature, a mismatched command id, and an outright malformed
// document were indistinguishable to the user.
test("regression: an unreadable reply is diagnosed as unreadable, not as a generic failure", () => {
    const unreadable = [
        "not json at all",
        JSON.stringify({version: 2, commandId: "other-command", status: "applied", revision: 1, appliedAt: NOW, message: "", portfolio: {paused: false, profiles: {}, deviceChoices: {}}}),
        JSON.stringify({version: 2, unexpected: true}),
        JSON.stringify([]),
    ];
    for (const reply of unreadable) {
        const manager = managerFor(reply);
        manager.start();
        manager.toggleProfile("hardware-health");
        assert.equal(manager.state().control.message, Manager.UNINTELLIGIBLE_REPLY_TEXT, reply);
        manager.dispose();
    }
});

test("regression: the failure vocabulary keeps every diagnosis distinct", () => {
    const diagnoses = [
        new Error("org.freedesktop.DBus.Error.ServiceUnknown"),
        new Error("org.freedesktop.DBus.Error.TimedOut"),
        new Error("org.freedesktop.DBus.Error.UnknownMethod"),
        new Error("org.freedesktop.DBus.Error.AccessDenied"),
        Contract.contractViolation(TypeError, "Runtime acknowledgement is not text"),
        new Error("something nobody anticipated"),
    ];
    const messages = diagnoses.map((error) => Manager.controlFailureText(error));
    assert.equal(
        new Set(messages).size,
        diagnoses.length,
        "each transport diagnosis must read differently",
    );
    for (const message of messages) {
        assert.doesNotMatch(message, /freedesktop|DBus|Error/u);
    }
});
