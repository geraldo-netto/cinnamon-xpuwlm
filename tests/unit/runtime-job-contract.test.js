"use strict";

const assert = require("node:assert/strict");
const {describe, it} = require("node:test");

const Job = require("../../files/cinnamon-tpuwm@geraldo-netto/lib/runtime-job-contract.js");

const DIGEST = "a".repeat(64);

function reference(overrides = {}) {
    return {
        path: "/home/user/omnitensor-inputs/.tpuwm-staged/visual-library-tpuwm-1-1.f32",
        shape: [1, 3, 227, 227],
        dtype: "float32",
        sha256: DIGEST,
        ...overrides,
    };
}

function submission(overrides = {}) {
    return {
        version: 1,
        requestId: "tpuwm-1786373216892-1",
        workloadId: "visual-library",
        payload: {inputRefs: [reference()]},
        ...overrides,
    };
}

function acknowledgement(overrides = {}) {
    return {
        version: 1,
        requestId: "tpuwm-1786373216892-1",
        jobId: "job-7f3c",
        status: "accepted",
        code: "job-accepted",
        message: "Job accepted",
        timestamp: 1786373216892,
        ...overrides,
    };
}

describe("job submission contract", () => {
    it("accepts the submission the applet builds", () => {
        assert.ok(Job.isJobSubmission(submission()));
        assert.ok(Job.isReferencePayload(submission().payload));
    });

    it("rejects an envelope the runtime would not read", () => {
        assert.ok(!Job.isJobSubmission(null));
        assert.ok(!Job.isJobSubmission(submission({version: 2})));
        assert.ok(!Job.isJobSubmission(submission({requestId: "has spaces"})));
        assert.ok(!Job.isJobSubmission(submission({requestId: "x".repeat(121)})));
        assert.ok(!Job.isJobSubmission(submission({workloadId: "Visual-Library"})));
        assert.ok(!Job.isJobSubmission(submission({workloadId: ""})));
        assert.ok(!Job.isJobSubmission(submission({payload: []})));
        assert.ok(!Job.isJobSubmission({...submission(), extra: 1}));
        const missing = submission();
        delete missing.payload;
        assert.ok(!Job.isJobSubmission(missing));
    });

    it("bounds a payload the way the runtime bounds it", () => {
        const wide = {};
        for (let index = 0; index <= Job.MAX_PAYLOAD_PROPERTIES; index += 1) {
            wide[`key${index}`] = index;
        }

        assert.ok(!Job.isPayload(wide));
        assert.ok(Job.isPayload({}));
        assert.ok(!Job.isPayload(null));
    });
});

describe("input reference contract", () => {
    it("accepts a reference the runtime can verify", () => {
        assert.ok(Job.isInputReference(reference()));
    });

    it("requires the digest that makes the reference meaningful", () => {
        assert.ok(!Job.isInputReference(reference({sha256: "abc"})));
        assert.ok(!Job.isInputReference(reference({sha256: DIGEST.toUpperCase()})));
        const bare = reference();
        delete bare.sha256;
        assert.ok(!Job.isInputReference(bare));
    });

    it("bounds rank, dimensions, and dtype exactly as the runtime does", () => {
        assert.ok(!Job.isInputReference(reference({shape: []})));
        assert.ok(!Job.isInputReference(reference({shape: [1, 1, 1, 1, 1, 1, 1]})));
        assert.ok(!Job.isInputReference(reference({shape: [0, 3]})));
        assert.ok(!Job.isInputReference(reference({shape: [Job.MAX_DIMENSION + 1]})));
        assert.ok(!Job.isInputReference(reference({shape: [1.5]})));
        assert.ok(!Job.isInputReference(reference({dtype: "float16"})));
        assert.ok(Job.isInputReference(reference({shape: [4], dtype: "uint8"})));
    });

    it("refuses a buffer larger than the runtime will read", () => {
        const huge = reference({shape: [Job.MAX_TENSOR_BYTES / 4 + 1], dtype: "float32"});

        assert.equal(Job.referenceBytes(huge), Job.MAX_TENSOR_BYTES + 4);
        assert.ok(!Job.isInputReference(huge));
    });

    it("counts elements the way the shape declares them", () => {
        assert.equal(Job.elementCount([1, 3, 227, 227]), 154_587);
        assert.equal(Job.elementCount([5]), 5);
    });

    it("refuses a payload carrying both inline tensors and references", () => {
        assert.ok(!Job.isReferencePayload({inputs: [[1]], inputRefs: [reference()]}));
        assert.ok(!Job.isReferencePayload({inputRefs: []}));
        assert.ok(!Job.isReferencePayload({inputRefs: [reference({dtype: "bogus"})]}));
        assert.ok(!Job.isReferencePayload({}));
    });

    it("refuses more references than the runtime accepts", () => {
        const many = new Array(Job.MAX_INPUT_REFERENCES + 1).fill(null).map(() => reference());

        assert.ok(!Job.isReferencePayload({inputRefs: many}));
    });
});

describe("job acknowledgement contract", () => {
    it("accepts every status the runtime may answer with", () => {
        for (const status of Job.ACKNOWLEDGEMENT_STATUSES) {
            assert.ok(Job.isJobAcknowledgement(acknowledgement({status})), status);
        }
    });

    it("accepts a refused job that was never given an id", () => {
        assert.ok(Job.isJobAcknowledgement(acknowledgement({
            jobId: null,
            status: "rejected",
            code: "input-contract-mismatch",
        })));
    });

    it("rejects a reply that does not match the contract", () => {
        assert.ok(!Job.isJobAcknowledgement(null));
        assert.ok(!Job.isJobAcknowledgement(acknowledgement({version: 2})));
        assert.ok(!Job.isJobAcknowledgement(acknowledgement({status: "queued"})));
        assert.ok(!Job.isJobAcknowledgement(acknowledgement({code: "Job Accepted"})));
        assert.ok(!Job.isJobAcknowledgement(acknowledgement({message: ""})));
        assert.ok(!Job.isJobAcknowledgement(acknowledgement({timestamp: 0})));
        assert.ok(!Job.isJobAcknowledgement(acknowledgement({jobId: "has spaces"})));
        assert.ok(!Job.isJobAcknowledgement({...acknowledgement(), extra: true}));
        const missing = acknowledgement();
        delete missing.code;
        assert.ok(!Job.isJobAcknowledgement(missing));
    });
});

describe("building a submission", () => {
    it("wraps references in the envelope the runtime expects", () => {
        const built = Job.jobSubmission({
            requestId: "tpuwm-1-1",
            workloadId: "visual-library",
            references: [reference()],
        });

        assert.equal(built.version, Job.JOB_VERSION);
        assert.deepEqual(built.payload, {inputRefs: [reference()]});
        assert.ok(Job.isJobSubmission(built));
    });

    it("refuses to build something the runtime would reject", () => {
        assert.throws(() => Job.jobSubmission({
            requestId: "tpuwm 1",
            workloadId: "visual-library",
            references: [reference()],
        }), TypeError);
        assert.throws(() => Job.jobSubmission({
            requestId: "tpuwm-1-1",
            workloadId: "visual-library",
            references: [],
        }), TypeError);
    });

    it("shares its identifier rules with the request grammar", () => {
        assert.ok(Job.isRequestId("tpuwm-1.2_3-4"));
        assert.ok(!Job.isRequestId(""));
        assert.ok(!Job.isRequestId("tpuwm/1"));
        assert.ok(Job.isWorkloadId("visual-library"));
        assert.ok(!Job.isWorkloadId("visual_library"));
        assert.ok(Job.isShape([1, 3, 227, 227]));
        assert.ok(!Job.isShape("1,3"));
        assert.ok(Job.boundedText("ok", 1, 4));
        assert.ok(!Job.boundedText(7, 1, 4));
        assert.ok(Job.boundedProperties({a: 1}, ["a"], new Set(["a"])));
        assert.ok(!Job.boundedProperties({a: 1, b: 2}, ["a"], new Set(["a"])));
    });
});
