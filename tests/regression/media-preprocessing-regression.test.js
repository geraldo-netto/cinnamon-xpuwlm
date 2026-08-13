"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const Fixture = require("../helpers/media-preprocessing-fixture.js");
const Media = require("../../files/cinnamon-xpuwlm@geraldo-netto/lib/media-preprocessing.js");

function lifecycle(overrides = {}) {
    let cleanups = 0;
    const selected = Fixture.source(".mp4");
    const inspected = Fixture.probe(selected);
    return {
        request: {
            source: selected,
            adapter: {
                async inspect() { return inspected; },
                async decode(plan) { return Fixture.decoded(plan, inspected); },
            },
            temporary: {
                async open() { return {id: "owned"}; },
                async cleanup() { cleanups += 1; },
            },
            signal: {throwIfCancelled() {}},
            async consume(output) { return output; },
            ...overrides,
        },
        cleanups: () => cleanups,
    };
}

test("regression: temporary media is removed after decode or consumer failure", async () => {
    const decodeFailure = lifecycle();
    decodeFailure.request.adapter.decode = async () => { throw new Error("decoder failed"); };
    await assert.rejects(Media.preprocessMedia(decodeFailure.request), /decoder failed/u);
    assert.equal(decodeFailure.cleanups(), 1);

    const consumerFailure = lifecycle({async consume() { throw new Error("consumer failed"); }});
    await assert.rejects(Media.preprocessMedia(consumerFailure.request), /consumer failed/u);
    assert.equal(consumerFailure.cleanups(), 1);
});

test("regression: cancellation is checked around each asynchronous boundary", async () => {
    const current = lifecycle();
    let checks = 0;
    current.request.signal.throwIfCancelled = () => {
        checks += 1;
        if (checks === 4) {
            throw new Media.MediaPreprocessingError("cancelled", "operator cancelled");
        }
    };
    await assert.rejects(Media.preprocessMedia(current.request), /operator cancelled/u);
    assert.equal(checks, 4);
    assert.equal(current.cleanups(), 1);
});

test("regression: compressed inputs never become lossy intermediate files", () => {
    for (const suffix of [".mp3", ".m4a", ".ogg", ".opus", ".mp4", ".mkv", ".webm"] ) {
        const selected = Fixture.source(suffix);
        const plan = Media.preprocessingPlan(selected, Fixture.probe(selected));
        assert.equal(plan.audio.intermediate, "memory", suffix);
        assert.equal(plan.audio.sampleFormat, "float32-planar", suffix);
        assert.equal(plan.operations.some((name) => /encode.*(?:mp3|video)/u.test(name)), false, suffix);
    }
});
