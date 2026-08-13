"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const Fixture = require("../helpers/media-preprocessing-fixture.js");
const Media = require("../../files/cinnamon-xpuwlm@geraldo-netto/lib/media-preprocessing.js");

function generator(seed) {
    let state = seed >>> 0;
    return () => {
        state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
        return state / 0x100000000;
    };
}

test("property: sampled frames remain monotonic, bounded, and reproducible", () => {
    const random = generator(0x0102);
    for (let index = 0; index < 1000; index += 1) {
        const duration = 1 + Math.floor(random() * Media.MAX_VIDEO_DURATION_MS);
        const first = Media.sampleTimestamps(duration);
        const second = Media.sampleTimestamps(duration);
        assert.deepEqual(first, second);
        assert.ok(first.length >= 1 && first.length <= Media.MAX_VISUALS);
        assert.equal(first[0], 0);
        assert.ok(first.every((value, position) => (
            Number.isInteger(value)
            && value >= 0
            && value < duration
            && (position === 0 || value > first[position - 1])
        )));
    }
});

test("property: normalized image dimensions admit exactly the positive 768 square", () => {
    const random = generator(0x768);
    const selected = Fixture.source(".png");
    const inspected = Fixture.probe(selected);
    const plan = Media.preprocessingPlan(selected, inspected);
    for (let index = 0; index < 500; index += 1) {
        const width = Math.floor(random() * 900);
        const height = Math.floor(random() * 900);
        const output = Fixture.decoded(plan, inspected);
        output.images[0] = {...output.images[0], width, height};
        assert.equal(
            Media.validImages(output.images, plan, inspected),
            width >= 1 && width <= 768 && height >= 1 && height <= 768,
        );
    }
});

test("property: unsafe temporary names never cross the media boundary", () => {
    const selected = Fixture.source(".wav");
    const inspected = Fixture.probe(selected);
    const plan = Media.preprocessingPlan(selected, inspected);
    for (const name of ["", ".hidden", "../escape", "/absolute", "a/b", "a\\b", "x\0.raw"] ) {
        const output = Fixture.decoded(plan, inspected);
        output.audio = {...output.audio, name};
        assert.throws(() => Media.normalizedOutput(output, plan, inspected), /decoded media is invalid/u);
    }
});
