"use strict";

const assert = require("node:assert/strict");
const {describe, it} = require("node:test");

const Job = require("../../files/cinnamon-xpuwlm@geraldo-netto/lib/runtime-job-contract.js");

const DIGEST = "a".repeat(64);

function reference(overrides = {}) {
    return {
        path: "/home/user/omnitensor-inputs/.xpuwlm-staged/visual-library-xpuwlm-1-1.f32",
        shape: [1, 3, 227, 227],
        dtype: "float32",
        sha256: DIGEST,
        ...overrides,
    };
}

function submission(overrides = {}) {
    return {
        version: 1,
        requestId: "xpuwlm-1786373216892-1",
        workloadId: "visual-library",
        payload: {inputRefs: [reference()]},
        ...overrides,
    };
}

function acknowledgement(overrides = {}) {
    return {
        version: 1,
        requestId: "xpuwlm-1786373216892-1",
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
            requestId: "xpuwlm-1-1",
            workloadId: "visual-library",
            references: [reference()],
        });

        assert.equal(built.version, Job.JOB_VERSION);
        assert.deepEqual(built.payload, {inputRefs: [reference()]});
        assert.ok(Job.isJobSubmission(built));
    });

    it("refuses to build something the runtime would reject", () => {
        assert.throws(() => Job.jobSubmission({
            requestId: "xpuwlm 1",
            workloadId: "visual-library",
            references: [reference()],
        }), TypeError);
        assert.throws(() => Job.jobSubmission({
            requestId: "xpuwlm-1-1",
            workloadId: "visual-library",
            references: [],
        }), TypeError);
    });

    it("shares its identifier rules with the request grammar", () => {
        assert.ok(Job.isRequestId("xpuwlm-1.2_3-4"));
        assert.ok(!Job.isRequestId(""));
        assert.ok(!Job.isRequestId("xpuwlm/1"));
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

describe("job result contract", () => {
    function jobResult(overrides = {}) {
        return {
            version: 1,
            requestId: "xpuwlm-1-2",
            jobId: "job-7f3c",
            state: "succeeded",
            code: "job-succeeded",
            message: "Job finished",
            timestamp: 1786373216892,
            ...overrides,
        };
    }

    it("accepts every state the runtime may report", () => {
        for (const state of Job.RESULT_STATES) {
            assert.ok(Job.isJobResult(jobResult({state})), state);
        }
    });

    it("accepts the optional evidence and its absence alike", () => {
        assert.ok(Job.isJobResult(jobResult({progress: null, output: null})));
        assert.ok(Job.isJobResult(jobResult({progress: {fraction: 0.5, detail: "infer"}})));
        assert.ok(Job.isJobResult(jobResult({output: {outputs: [], durationMs: 21}})));
        assert.ok(Job.isJobResult(jobResult({message: ""})), "a message may be empty");
    });

    it("rejects a reply that does not match the contract", () => {
        assert.ok(!Job.isJobResult(jobResult({state: "queued"})));
        assert.ok(!Job.isJobResult(jobResult({code: "Job Succeeded"})));
        assert.ok(!Job.isJobResult(jobResult({timestamp: 0})));
        assert.ok(!Job.isJobResult(jobResult({jobId: null})));
        assert.ok(!Job.isJobResult(jobResult({progress: {fraction: 1.5, detail: ""}})));
        assert.ok(!Job.isJobResult(jobResult({progress: {fraction: 0.5}})));
        assert.ok(!Job.isJobResult(jobResult({output: []})));
        assert.ok(!Job.isJobResult({...jobResult(), extra: 1}));
        assert.ok(!Job.isJobResult(null));
    });

    it("names the states a job cannot leave", () => {
        assert.deepEqual([...Job.TERMINAL_STATES].sort(), ["cancelled", "failed", "succeeded", "unknown"]);
        assert.ok(Job.isTerminalState("failed"));
        assert.ok(!Job.isTerminalState("running"));
        for (const state of Job.TERMINAL_STATES) {
            assert.ok(Job.RESULT_STATES.has(state), `${state} is a state the runtime reports`);
        }
    });

    it("builds a result request or refuses to", () => {
        assert.deepEqual(Job.jobResultRequest({requestId: "xpuwlm-1-2", jobId: "job-1"}), {
            version: 1,
            requestId: "xpuwlm-1-2",
            jobId: "job-1",
        });
        assert.throws(() => Job.jobResultRequest({requestId: "a b", jobId: "job-1"}), TypeError);
        assert.throws(() => Job.jobResultRequest({requestId: "xpuwlm-1", jobId: ""}), TypeError);
    });

    it("validates progress on its own, including its absence", () => {
        assert.ok(Job.isProgress(null));
        assert.ok(Job.isProgress({fraction: 0, detail: ""}));
        assert.ok(!Job.isProgress({fraction: -0.1, detail: ""}));
        assert.ok(!Job.isProgress({fraction: 0.5, detail: "x".repeat(Job.MAX_PROGRESS_DETAIL_LENGTH + 1)}));
        assert.ok(!Job.isProgress(undefined));
    });
});

describe("reading a succeeded job", () => {
    function output(reading) {
        return {outputs: [], durationMs: 21, reading};
    }

    it("reads the reduction the profile's contract asked for", () => {
        const reading = Job.readingOf(output({
            kind: "classification",
            top: [{index: 669, score: 0.0918, label: "beacon"}, {index: 2, score: 0.01}],
        }));

        assert.equal(reading.kind, "classification");
        assert.deepEqual(reading.top[0], {index: 669, score: 0.0918, label: "beacon"});
        assert.deepEqual(reading.top[1], {index: 2, score: 0.01});
        assert.ok(!Object.hasOwn(reading.top[1], "label"), "an index gains no name here");
    });

    it("reports nothing rather than something partly understood", () => {
        assert.equal(Job.readingOf(null), null);
        assert.equal(Job.readingOf({}), null);
        assert.equal(Job.readingOf(output({kind: "guess", top: []})), null);
        assert.equal(Job.readingOf(output({kind: "classification", top: "top"})), null);
        assert.equal(Job.readingOf(output({kind: "classification", top: [{index: -1, score: 1}]})), null);
        assert.equal(Job.readingOf(output({kind: "classification", top: [{index: 1, score: "1"}]})), null);
        assert.equal(Job.readingOf(output({kind: "classification", top: [{index: 1}]})), null);
        assert.equal(Job.readingOf(output({kind: "classification", top: [{index: 1, score: 1, label: 5}]})), null);
    });

    it("is bounded however many candidates the runtime returned", () => {
        const many = Array.from({length: Job.MAX_READING_ENTRIES + 10}, (unused, index) => ({
            index,
            score: 0.1,
        }));

        assert.equal(Job.readingOf(output({kind: "classification", top: many})).top.length,
            Job.MAX_READING_ENTRIES);
    });

    it("returns an empty reduction as an empty one, not as an absence", () => {
        assert.deepEqual(Job.readingOf(output({kind: "classification", top: []})), {
            kind: "classification",
            top: [],
        });
    });

    it("accepts one exact bounded forecast reading", () => {
        for (const reading of [
            {kind: "forecast", targetFeature: "x", horizon: 1, value: -12.5},
            {
                kind: "forecast",
                targetFeature: "x".repeat(Job.MAX_FORECAST_TARGET_LENGTH),
                horizon: Job.MAX_FORECAST_HORIZON,
                value: Number.MAX_VALUE,
            },
        ]) {
            assert.deepEqual(Job.readingOf(output(reading)), reading);
        }
    });

    it("copies a forecast instead of trusting a mutable service object", () => {
        const source = {kind: "forecast", targetFeature: "load", horizon: 3, value: 0.75};
        const parsed = Job.readingOf(output(source));

        source.targetFeature = "queueDepth";
        assert.deepEqual(parsed, {
            kind: "forecast", targetFeature: "load", horizon: 3, value: 0.75,
        });
    });

    it("rejects every malformed forecast field and any undeclared field", () => {
        const valid = {kind: "forecast", targetFeature: "load", horizon: 3, value: 0.75};
        const invalid = [
            {...valid, kind: "prediction"},
            {...valid, targetFeature: ""},
            {...valid, targetFeature: "x".repeat(Job.MAX_FORECAST_TARGET_LENGTH + 1)},
            {...valid, targetFeature: 7},
            {...valid, horizon: true},
            {...valid, horizon: 0},
            {...valid, horizon: Job.MAX_FORECAST_HORIZON + 1},
            {...valid, horizon: 1.5},
            {...valid, value: true},
            {...valid, value: "0.75"},
            {...valid, value: Number.NaN},
            {...valid, value: Number.POSITIVE_INFINITY},
            {...valid, value: Number.NEGATIVE_INFINITY},
            {...valid, unit: "%"},
        ];
        for (const reading of invalid) {
            assert.equal(Job.forecastReadingOf(reading), null, JSON.stringify(reading));
        }
        for (const field of Job.FORECAST_READING_PROPERTIES) {
            const missing = {...valid};
            delete missing[field];
            assert.equal(Job.forecastReadingOf(missing), null, `missing ${field}`);
        }
    });
});
