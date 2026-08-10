"use strict";

const assert = require("node:assert/strict");
const {describe, it} = require("node:test");

const Encoder = require("../../files/cinnamon-tpuwm@geraldo-netto/lib/tensor-encoder.js");
const Submission = require("../../files/cinnamon-tpuwm@geraldo-netto/lib/job-submission.js");

const SPEC = Object.freeze({
    shape: [1, 3, 2, 2],
    dtype: "float32",
    layout: "NCHW",
    preprocess: {channelOrder: "BGR", mean: [104, 117, 123], scale: [1, 1, 1]},
});
const ROOT = "/home/user/omnitensor-inputs";

function image() {
    return {
        width: 2,
        height: 2,
        channels: 3,
        rowstride: 6,
        pixels: new Uint8Array([10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 110, 120]),
    };
}

function harness(options = {}) {
    const events = [];
    const imagePort = {
        decode(path, geometry, callback) {
            events.push(["decode", path, geometry]);
            if (options.decodeError) {
                callback(options.decodeError, null);
                return;
            }
            if (options.deferDecode) {
                events.deferred = () => callback(null, options.image ?? image());
                return;
            }
            callback(null, options.image ?? image());
        },
        write(path, bytes, callback) {
            events.push(["write", path, bytes.length]);
            if (options.deferWrite) {
                events.deferredWrite = () => callback(null);
                return;
            }
            callback(options.writeError ?? null);
        },
        remove(path) {
            events.push(["remove", path]);
            if (options.removeThrows) {
                throw new Error("read-only");
            }
            return true;
        },
        digest() {
            return "c".repeat(64);
        },
    };
    const gateway = {
        submissions: [],
        polls: [],
        pollable: options.pollable !== false,
        requestResult(poll, callback) {
            this.polls.push(poll);
            if (options.resultThrows) {
                throw new Error("no such method");
            }
            callback(null, {state: "succeeded"});
            return true;
        },
        cancelResult: options.noCancelResult ? undefined : () => {
            events.push(["cancelResult"]);
            return true;
        },
        submit(document, callback) {
            this.submissions.push(document);
            events.push(["submit", document.workloadId]);
            if (options.deferSubmit) {
                events.deferredSubmit = () => callback(options.submitError ?? null, ack());
                return true;
            }
            callback(options.submitError ?? null, options.submitError ? null : ack());
            return true;
        },
        cancel() {
            events.push(["cancel"]);
            return true;
        },
    };
    const submitter = new Submission.JobSubmitter({
        gateway,
        imagePort,
        clock: {now: () => 1786373216892},
    });
    return {submitter, gateway, events, imagePort};
}

function ack() {
    return {
        version: 1,
        requestId: "tpuwm-1786373216892-1",
        jobId: "job-1",
        status: "accepted",
        code: "job-accepted",
        message: "Job accepted",
        timestamp: 1786373216892,
    };
}

function request(overrides = {}) {
    return {
        workloadId: "visual-library",
        spec: SPEC,
        sourcePath: `${ROOT}/cat.png`,
        stagingRoot: ROOT,
        ...overrides,
    };
}

describe("staging paths", () => {
    it("stages inside the runtime's own input root", () => {
        const path = Submission.stagedPath(ROOT, "visual-library", "tpuwm-1-1");

        assert.equal(path, `${ROOT}/${Submission.STAGING_DIRECTORY}/visual-library-tpuwm-1-1.f32`);
        assert.ok(path.startsWith(`${ROOT}/`), "containment is what makes the read permitted");
    });

    it("refuses a name that would leave the directory it names", () => {
        assert.throws(
            () => Submission.stagedFilename("visual-library", "../../etc/passwd"),
            (error) => error.code === "staging-name-invalid",
        );
        assert.throws(
            () => Submission.stagedFilename("visual-library", "a/b"),
            (error) => error.code === "staging-name-invalid",
        );
    });
});

describe("submitting a picture as a job", () => {
    it("decodes to the size the model wants, then submits a reference to the buffer", () => {
        const {submitter, gateway, events} = harness();
        let received = null;

        submitter.submit(request(), (error, reply) => {
            received = {error, reply};
        });

        assert.deepEqual(events[0], ["decode", `${ROOT}/cat.png`, {channels: 3, height: 2, width: 2}]);
        assert.equal(events[1][0], "write");
        assert.equal(events[1][2], 48, "twelve floats");
        const reference = gateway.submissions[0].payload.inputRefs[0];
        assert.deepEqual(reference.shape, [1, 3, 2, 2]);
        assert.equal(reference.dtype, "float32");
        assert.equal(reference.sha256, "c".repeat(64));
        assert.equal(received.error, null);
        assert.equal(received.reply.jobId, "job-1");
    });

    it("keeps the staged buffer an accepted job still has to read", () => {
        const {submitter, events} = harness();
        let staged = null;

        submitter.submit(request(), (error, reply) => {
            staged = reply.stagedPath;
        });

        assert.ok(staged.endsWith(".f32"));
        assert.ok(!events.some(([name]) => name === "remove"), "the job has not read it yet");
    });

    it("refuses a contract it cannot honour without touching the picture", () => {
        const {submitter, events} = harness();
        let received = null;

        submitter.submit(request({spec: {...SPEC, dtype: "uint8"}}), (error) => {
            received = error;
        });

        assert.equal(Submission.refusalCode(received), "dtype-unsupported");
        assert.ok(Encoder.isRefusal(received));
        assert.deepEqual(events, [], "nothing was decoded, written, or sent");
    });

    it("removes the staged buffer when nothing will ever read it", () => {
        for (const [options, code] of [
            [{writeError: new Error("no space")}, "staging-write-failed"],
            [{submitError: new Error("NameHasNoOwner")}, null],
        ]) {
            const {submitter, events} = harness(options);
            let received = null;

            submitter.submit(request(), (error) => {
                received = error;
            });

            assert.equal(Submission.refusalCode(received), code);
            assert.ok(events.some(([name]) => name === "remove"), JSON.stringify(options));
        }
    });

    it("reports a picture it could not read as a picture problem", () => {
        const {submitter} = harness({decodeError: new Error("Unrecognized image file format")});
        let received = null;

        submitter.submit(request(), (error) => {
            received = error;
        });

        assert.equal(Submission.refusalCode(received), "image-decode-failed");
        assert.match(received.detail, /Unrecognized image/u);
    });

    it("reports a picture that is not the size it asked for", () => {
        const {submitter} = harness({
            image: {...image(), width: 4, rowstride: 12, pixels: new Uint8Array(24)},
        });
        let received = null;

        submitter.submit(request(), (error) => {
            received = error;
        });

        assert.equal(Submission.refusalCode(received), "image-size-mismatch");
    });

    it("survives a staged buffer it cannot remove", () => {
        const {submitter} = harness({writeError: new Error("no space"), removeThrows: true});
        let received = null;

        submitter.submit(request(), (error) => {
            received = error;
        });

        assert.equal(Submission.refusalCode(received), "staging-write-failed");
    });
});

describe("superseding a submission", () => {
    it("discards a decode that finished after a newer submission started", () => {
        const {submitter, events} = harness({deferDecode: true});
        const seen = [];

        submitter.submit(request(), (error) => seen.push(error));
        const stale = events.deferred;
        submitter.submit(request(), (error) => seen.push(error));
        stale();

        assert.deepEqual(seen, [], "the superseded picture never becomes a job");
    });

    it("never submits a buffer whose submission was cancelled mid-write", () => {
        const {submitter, gateway, events} = harness({deferWrite: true});

        submitter.submit(request(), () => {});
        const finishWrite = events.deferredWrite;
        submitter.cancel();
        finishWrite();

        assert.deepEqual(gateway.submissions, [], "the cancelled buffer never reached the runtime");
    });

    it("removes the buffer staged for a submission that was cancelled", () => {
        const {submitter, events} = harness({deferSubmit: true});

        submitter.submit(request(), () => {});
        assert.equal(submitter.cancel(), true);

        assert.ok(events.some(([name]) => name === "remove"));
        assert.equal(submitter.cancel(), false, "nothing is pending twice");
    });
});

describe("submission ports", () => {
    it("requires collaborators that can do the work", () => {
        assert.throws(() => Submission.requireImagePort({decode() {}}), TypeError);
        assert.throws(() => Submission.requireImagePort(null), TypeError);
        assert.throws(() => Submission.requireJobGateway({submit() {}}), TypeError);
        assert.throws(() => new Submission.JobSubmitter({gateway: null, imagePort: null}), TypeError);
    });

    it("requires a callback, because a job with no reader is a silent job", () => {
        const {submitter} = harness();

        assert.throws(() => submitter.submit(request(), null), TypeError);
    });

    it("classifies only the refusals it knows how to explain", () => {
        assert.equal(Submission.refusalCode(new Error("plain")), null);
        assert.equal(Submission.refusalCode(null), null);
        assert.equal(Submission.refusalCode("text"), null);
        assert.equal(Submission.refusalCode(Submission.decodeFailure("x")), "image-decode-failed");
        assert.equal(Submission.refusalCode(Submission.writeFailure("x")), "staging-write-failed");
        assert.equal(new Submission.JobStagingError("a", "b").name, "JobStagingError");
    });
});

describe("asking what became of a job", () => {
    it("polls with a fresh request each time, so a stale answer is discarded", () => {
        const {submitter, gateway} = harness();
        const seen = [];

        submitter.requestResult("job-1", (error, reply) => seen.push([error, reply]));
        submitter.requestResult("job-1", () => {});

        assert.equal(gateway.polls.length, 2);
        assert.notEqual(gateway.polls[0].requestId, gateway.polls[1].requestId);
        assert.equal(gateway.polls[0].jobId, "job-1");
        assert.deepEqual(seen[0], [null, {state: "succeeded"}]);
    });

    it("reports a runtime it cannot ask rather than throwing at the caller", () => {
        const {submitter} = harness({resultThrows: true});
        let received = null;

        submitter.requestResult("job-1", (error) => {
            received = error;
        });

        assert.equal(Submission.refusalCode(received), "job-result-unavailable");
        assert.match(received.detail, /no such method/u);
    });

    it("reports whether this runtime can be asked at all", () => {
        assert.equal(harness().submitter.pollable, true);
        assert.equal(harness({pollable: false}).submitter.pollable, false);
    });

    it("requires a callback, because an unread outcome is no outcome", () => {
        assert.throws(() => harness().submitter.requestResult("job-1", null), TypeError);
    });

    it("cancels a poll where the gateway can, and says so where it cannot", () => {
        const {submitter, events} = harness();

        assert.equal(submitter.cancelResult(), true);
        assert.ok(events.some(([name]) => name === "cancelResult"));
        assert.equal(harness({noCancelResult: true}).submitter.cancelResult(), false);
    });
});
