"use strict";

const assert = require("node:assert/strict");
const {describe, it} = require("node:test");

const Gateway = require("../../files/cinnamon-tpuwm@geraldo-netto/lib/runtime-job-gateway.js");
const Refusal = require("../../files/cinnamon-tpuwm@geraldo-netto/lib/runtime-refusal-contract.js");
const RuntimeControl = require("../../files/cinnamon-tpuwm@geraldo-netto/lib/runtime-control-contract.js");

const REQUEST_ID = "tpuwm-1786373216892-1";

function submission(overrides = {}) {
    return {
        version: 1,
        requestId: REQUEST_ID,
        workloadId: "visual-library",
        payload: {
            inputRefs: [{
                path: "/home/user/omnitensor-inputs/.tpuwm-staged/visual-library-x.f32",
                shape: [1, 3, 227, 227],
                dtype: "float32",
                sha256: "b".repeat(64),
            }],
        },
        ...overrides,
    };
}

function acknowledgement(overrides = {}) {
    return JSON.stringify({
        version: 1,
        requestId: REQUEST_ID,
        jobId: "job-1",
        status: "accepted",
        code: "job-accepted",
        message: "Job accepted",
        timestamp: 1786373216892,
        ...overrides,
    });
}

function harness({reply = acknowledgement(), failWith = null, defer = false} = {}) {
    const calls = [];
    const cancellables = [];
    const pending = [];
    const gateway = new Gateway.RuntimeJobGateway({
        cancellableFactory() {
            const cancellable = {cancelled: false, cancel() { this.cancelled = true; }};
            cancellables.push(cancellable);
            return cancellable;
        },
        sendText(text, options, callback) {
            calls.push({text, options});
            if (failWith !== null) {
                throw failWith;
            }
            const deliver = () => callback(null, typeof reply === "function" ? reply() : reply);
            if (defer) {
                pending.push(deliver);
                return;
            }
            deliver();
        },
    });
    return {gateway, calls, cancellables, pending};
}

describe("runtime job gateway construction", () => {
    it("requires the ports it cannot work without", () => {
        assert.throws(() => new Gateway.RuntimeJobGateway({}), TypeError);
        assert.throws(
            () => new Gateway.RuntimeJobGateway({sendText() {}, cancellableFactory: null}),
            TypeError,
        );
        assert.doesNotThrow(() => Gateway.requirePorts(() => {}, () => null));
    });
});

describe("submitting a job", () => {
    it("sends the submission and returns its acknowledgement", () => {
        const {gateway, calls} = harness();
        let received = null;

        gateway.submit(submission(), (error, reply) => {
            received = {error, reply};
        });

        assert.equal(JSON.parse(calls[0].text).workloadId, "visual-library");
        assert.equal(received.error, null);
        assert.equal(received.reply.jobId, "job-1");
    });

    it("refuses to send something the runtime would reject", () => {
        const {gateway, calls} = harness();

        assert.throws(() => gateway.submit(submission({version: 9}), () => {}), TypeError);
        assert.throws(() => gateway.submit(submission(), null), TypeError);
        assert.equal(calls.length, 0);
    });

    it("reports a transport failure rather than inventing a reply", () => {
        const {gateway} = harness({failWith: new Error("NameHasNoOwner")});
        let received = null;

        gateway.submit(submission(), (error, reply) => {
            received = {error, reply};
        });

        assert.match(String(received.error), /NameHasNoOwner/u);
        assert.equal(received.reply, null);
    });
});

describe("reading a reply", () => {
    it("recognises a transport refusal before the acknowledgement contract", () => {
        const {gateway} = harness({
            reply: JSON.stringify({
                version: 1,
                status: "rejected",
                code: "rate-limit-exceeded",
                message: "too many",
                method: "SubmitJob",
            }),
        });
        let received = null;

        gateway.submit(submission(), (error) => {
            received = error;
        });

        assert.equal(Refusal.refusalOf(received).code, "rate-limit-exceeded");
        assert.ok(!RuntimeControl.isContractViolation(received));
    });

    it("marks an unreadable reply as a contract violation, not a transport fault", () => {
        for (const reply of ["{", "null", acknowledgement({status: "queued"}), 7]) {
            const {gateway} = harness({reply});
            let received = null;

            gateway.submit(submission(), (error) => {
                received = error;
            });

            assert.ok(RuntimeControl.isContractViolation(received), JSON.stringify(reply));
        }
    });

    it("refuses an acknowledgement answering a different request", () => {
        const {gateway} = harness({reply: acknowledgement({requestId: "tpuwm-other-1"})});
        let received = null;

        gateway.submit(submission(), (error) => {
            received = error;
        });

        assert.ok(RuntimeControl.isContractViolation(received));
        assert.match(String(received), /request ID/u);
    });

    it("parses an acknowledgement on its own", () => {
        assert.equal(Gateway.parseJobAcknowledgement(acknowledgement()).status, "accepted");
        assert.throws(() => Gateway.parseJobAcknowledgement(null), TypeError);
    });
});

describe("superseding a job submission", () => {
    it("cancels the call in flight when a newer one starts", () => {
        const {gateway, cancellables, pending} = harness({defer: true});
        const seen = [];

        gateway.submit(submission(), (error, reply) => seen.push(["first", error, reply]));
        gateway.submit(submission({requestId: "tpuwm-2-2"}), (error) => seen.push(["second", error]));

        assert.ok(cancellables[0].cancelled);
        pending[0]();

        assert.deepEqual(seen, [], "a superseded reply is discarded, not delivered");
    });

    it("reports whether there was anything to cancel", () => {
        const {gateway} = harness({defer: true});

        assert.equal(gateway.cancel(), false);
        gateway.submit(submission(), () => {});
        assert.equal(gateway.cancel(), true);
        assert.equal(gateway.cancel(), false);
    });

    it("defaults to no cancellable when the caller supplies no factory", () => {
        const seen = [];
        const gateway = new Gateway.RuntimeJobGateway({
            sendText(text, options, callback) {
                seen.push(options.cancellable);
                callback(null, acknowledgement());
            },
        });

        gateway.submit(submission(), () => {});

        assert.deepEqual(seen, [null]);
        assert.equal(gateway.cancel(), false);
    });

    it("tolerates a cancellable factory that yields nothing", () => {
        const gateway = new Gateway.RuntimeJobGateway({
            cancellableFactory: () => null,
            sendText(text, options, callback) {
                callback(null, acknowledgement());
            },
        });
        let received = null;

        gateway.submit(submission(), (error, reply) => {
            received = reply;
        });

        assert.equal(received.status, "accepted");
        assert.equal(gateway.cancel(), false);
    });
});
