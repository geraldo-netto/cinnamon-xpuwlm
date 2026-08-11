"use strict";

const assert = require("node:assert/strict");
const {describe, it} = require("node:test");

const Gateway = require("../../files/cinnamon-xpuwlm@geraldo-netto/lib/runtime-job-gateway.js");
const Refusal = require("../../files/cinnamon-xpuwlm@geraldo-netto/lib/runtime-refusal-contract.js");
const RuntimeControl = require("../../files/cinnamon-xpuwlm@geraldo-netto/lib/runtime-control-contract.js");

const REQUEST_ID = "xpuwlm-1786373216892-1";

function submission(overrides = {}) {
    return {
        version: 1,
        requestId: REQUEST_ID,
        workloadId: "visual-library",
        payload: {
            inputRefs: [{
                path: "/home/user/omnitensor-inputs/.xpuwlm-staged/visual-library-x.f32",
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
        const {gateway} = harness({reply: acknowledgement({requestId: "xpuwlm-other-1"})});
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
        gateway.submit(submission({requestId: "xpuwlm-2-2"}), (error) => seen.push(["second", error]));

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

describe("asking what became of a job", () => {
    function jobResult(overrides = {}) {
        return JSON.stringify({
            version: 1,
            requestId: "xpuwlm-poll-1",
            jobId: "job-1",
            state: "succeeded",
            code: "job-succeeded",
            message: "Job finished",
            timestamp: 1786373216892,
            ...overrides,
        });
    }

    function pollHarness({reply = jobResult(), defer = false} = {}) {
        const calls = {submit: [], result: []};
        const pending = [];
        const gateway = new Gateway.RuntimeJobGateway({
            sendText(text, options, callback) {
                calls.submit.push(text);
                callback(null, acknowledgement());
            },
            sendResultText(text, options, callback) {
                calls.result.push(text);
                if (defer) {
                    pending.push(() => callback(null, reply));
                    return;
                }
                callback(null, reply);
            },
        });
        return {gateway, calls, pending};
    }

    it("asks with the request the runtime expects and returns its answer", () => {
        const {gateway, calls} = pollHarness();
        let received = null;

        gateway.requestResult({requestId: "xpuwlm-poll-1", jobId: "job-1"}, (error, reply) => {
            received = {error, reply};
        });

        assert.deepEqual(JSON.parse(calls.result[0]), {
            version: 1,
            requestId: "xpuwlm-poll-1",
            jobId: "job-1",
        });
        assert.equal(received.error, null);
        assert.equal(received.reply.state, "succeeded");
    });

    it("refuses a request the runtime would reject before sending it", () => {
        const {gateway, calls} = pollHarness();

        assert.throws(() => gateway.requestResult({requestId: "a b", jobId: "job-1"}), TypeError);
        assert.throws(() => gateway.requestResult({requestId: "xpuwlm-1", jobId: "job-1"}, null), TypeError);
        assert.deepEqual(calls.result, []);
    });

    it("tells an answer for a different poll from this one", () => {
        const {gateway} = pollHarness({reply: jobResult({requestId: "xpuwlm-poll-9"})});
        let received = null;

        gateway.requestResult({requestId: "xpuwlm-poll-1", jobId: "job-1"}, (error) => {
            received = error;
        });

        assert.ok(RuntimeControl.isContractViolation(received));
    });

    it("recognises a refusal of the poll itself", () => {
        const {gateway} = pollHarness({
            reply: JSON.stringify({
                version: 1,
                status: "rejected",
                code: "rate-limit-exceeded",
                message: "too many",
                method: "GetJobResult",
            }),
        });
        let received = null;

        gateway.requestResult({requestId: "xpuwlm-poll-1", jobId: "job-1"}, (error) => {
            received = error;
        });

        assert.equal(Refusal.refusalOf(received).method, "GetJobResult");
    });

    it("keeps the two channels independent, so a new job does not abandon a poll", () => {
        const {gateway, pending} = pollHarness({defer: true});
        const seen = [];

        gateway.requestResult({requestId: "xpuwlm-poll-1", jobId: "job-1"}, (error, reply) => {
            seen.push(reply.state);
        });
        gateway.submit(submission({requestId: "xpuwlm-2-2"}), () => {});
        pending[0]();

        assert.deepEqual(seen, ["succeeded"], "the poll still answered the caller waiting on it");
    });

    it("says when it cannot ask at all, rather than pretending to", () => {
        const gateway = new Gateway.RuntimeJobGateway({
            sendText(text, options, callback) {
                callback(null, acknowledgement());
            },
        });

        assert.equal(gateway.pollable, false);
        assert.equal(gateway.cancelResult(), false);
        assert.throws(
            () => gateway.requestResult({requestId: "xpuwlm-1-1", jobId: "job-1"}, () => {}),
            /cannot request results/u,
        );
    });

    it("cancels both channels together when the caller gives up", () => {
        const {gateway} = pollHarness({defer: true});

        gateway.requestResult({requestId: "xpuwlm-poll-1", jobId: "job-1"}, () => {});
        assert.equal(gateway.cancel(), true);
        assert.equal(gateway.cancel(), false);
        assert.equal(gateway.pollable, true);
    });

    it("parses a result on its own", () => {
        assert.equal(Gateway.parseJobResult(jobResult()).state, "succeeded");
        assert.throws(() => Gateway.parseJobResult("{"), SyntaxError);
        assert.throws(() => Gateway.parseJobResult(jobResult({state: "queued"})), TypeError);
    });
});

describe("cancelling a runtime job", () => {
    function cancelHarness({reply = acknowledgement({requestId: "xpuwlm-cancel-1"})} = {}) {
        const calls = [];
        const gateway = new Gateway.RuntimeJobGateway({
            sendText() {},
            sendCancelText(text, options, callback) {
                calls.push({text, options});
                callback(null, reply);
            },
        });
        return {gateway, calls};
    }

    it("sends the closed cancellation envelope and validates its acknowledgement", () => {
        const {gateway, calls} = cancelHarness();
        let received = null;

        gateway.cancelJob({requestId: "xpuwlm-cancel-1", jobId: "job-1"}, (error, reply) => {
            received = {error, reply};
        });

        assert.deepEqual(JSON.parse(calls[0].text), {
            version: 1,
            requestId: "xpuwlm-cancel-1",
            jobId: "job-1",
        });
        assert.equal(received.error, null);
        assert.equal(received.reply.status, "accepted");
    });

    it("refuses invalid input, an absent channel, and mismatched replies", () => {
        const {gateway, calls} = cancelHarness({
            reply: acknowledgement({requestId: "xpuwlm-other-1"}),
        });
        let error = null;

        assert.throws(() => gateway.cancelJob({requestId: "bad id", jobId: "job-1"}, () => {}), TypeError);
        assert.throws(() => gateway.cancelJob({requestId: "xpuwlm-1", jobId: "job-1"}, null), TypeError);
        gateway.cancelJob({requestId: "xpuwlm-cancel-1", jobId: "job-1"}, (seen) => {
            error = seen;
        });
        assert.ok(RuntimeControl.isContractViolation(error));
        assert.equal(calls.length, 1);

        const unavailable = new Gateway.RuntimeJobGateway({sendText() {}});
        assert.throws(
            () => unavailable.cancelJob({requestId: "xpuwlm-1", jobId: "job-1"}, () => {}),
            /cannot cancel jobs/u,
        );
    });

    it("includes the independent cancellation channel in aggregate cancellation", () => {
        const gateway = new Gateway.RuntimeJobGateway({
            sendText() {},
            sendCancelText() {},
        });
        assert.equal(gateway.cancel(), false);
        gateway.cancelJob({requestId: "xpuwlm-cancel-1", jobId: "job-1"}, () => {});
        assert.equal(gateway.cancel(), true);
        assert.equal(gateway.cancel(), false);
    });
});
