"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const Captions = require("../../files/cinnamon-xpuwlm@geraldo-netto/lib/caption-export.js");

test("property: timestamp formatting preserves every bounded millisecond", () => {
    for (let value = 0; value <= 86_400_000; value += 97_531) {
        const rendered = Captions.timestamp(value, ".");
        const match = /^(\d{2}):(\d{2}):(\d{2})\.(\d{3})$/u.exec(rendered);
        assert.ok(match);
        const restored = Number(match[1]) * 3_600_000 + Number(match[2]) * 60_000
            + Number(match[3]) * 1000 + Number(match[4]);
        assert.equal(restored, value);
    }
});

test("fuzz: shallow hostile values never escape caption validators", () => {
    const values = [null, undefined, true, false, 0, 1, "", [], {}, Symbol("x")];
    for (let index = 0; index < 1000; index += 1) {
        const value = values[index % values.length];
        assert.doesNotThrow(() => Captions.validCaptionSource(value));
        assert.doesNotThrow(() => Captions.validCueSequence(value, 1000));
        assert.doesNotThrow(() => Captions.validMeasurements(value));
        assert.doesNotThrow(() => Captions.validExport(value));
    }
});
