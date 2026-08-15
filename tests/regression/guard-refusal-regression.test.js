"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const Domain = require("../../files/cinnamon-xpuwlm@geraldo-netto/lib/domain.js");
const FailureBackoff = require("../../files/cinnamon-xpuwlm@geraldo-netto/lib/failure-log-backoff.js");
const Gateway = require("../../files/cinnamon-xpuwlm@geraldo-netto/lib/runtime-control-gateway.js");
const Manager = require("../../files/cinnamon-xpuwlm@geraldo-netto/lib/manager.js");
const Refusal = require("../../files/cinnamon-xpuwlm@geraldo-netto/lib/runtime-refusal-contract.js");
const BuiltIns = require("../helpers/built-in-workloads.js");

const NOW = 1_700_000_000_000;

function refusalDocument(code) {
    return {
        version: 1,
        status: "rejected",
        code,
        message: `apply-command refused with ${code}`,
        method: "apply-command",
    };
}

// The service answers a guarded method with a refusal envelope rather than an
// acknowledgement. The applet used to require the seven acknowledgement keys
// exactly, so every refusal became an opaque parse error and reached the user
// as one generic sentence with no code and no recovery advice.
test("regression: a refusal reaches the user with its code, over the real transport", () => {
    for (const code of Refusal.REFUSAL_CODES) {
        const messages = [];
        const logger = {warn() {}, error: (message) => messages.push(message)};
        const controlGateway = new Gateway.RuntimeControlGateway({
            sendText: (_text, _options, callback) => callback(
                null,
                JSON.stringify(refusalDocument(code)),
            ),
        });
        const manager = new Manager.WorkloadManager({
            repository: {load: () => ({}), save() {}},
            runtimeGateway: {
                read: (_options, callback) => callback(Domain.probeSnapshot(
                    [{id: "tpu-usb", backend: "tpu", available: true, name: "Coral", kind: "usb"}],
                    NOW,
                )),
            },
            controlGateway,
            clock: {now: () => NOW},
            errorReporter: new FailureBackoff.FailureErrorBackoff({logger}),
            logger,
            workloadRegistry: BuiltIns.coreRegistry(),
        });
        manager.start();
        assert.equal(manager.toggleProfile("hardware-health"), true);

        const state = manager.state();
        assert.equal(state.control.pending, false);
        assert.equal(state.control.message, Manager.REFUSAL_TEXTS[code], code);
        assert.notEqual(state.control.message, "The runtime service could not apply the change");
        assert.equal(messages.length, 1, code);
        assert.match(messages[0], new RegExp(code, "u"));
        manager.dispose();
    }
});

// A reply that is neither an acknowledgement nor a refusal must keep failing
// loudly: recognising refusals must not widen what counts as a valid reply.
test("regression: near-refusal replies stay contract failures", () => {
    const nearMisses = [
        {...refusalDocument("rate-limit-exceeded"), status: "applied"},
        {...refusalDocument("rate-limit-exceeded"), code: "not-a-guard-code"},
        {...refusalDocument("rate-limit-exceeded"), extra: true},
    ];
    for (const candidate of nearMisses) {
        assert.throws(
            () => Gateway.parseAcknowledgement(JSON.stringify(candidate)),
            /version 2 contract/u,
            JSON.stringify(candidate),
        );
    }
});
