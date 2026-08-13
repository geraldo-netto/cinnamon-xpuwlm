"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const Fixture = require("../helpers/file-auto-tagging-fixture.js");
const Tagging = require("../../files/cinnamon-xpuwlm@geraldo-netto/lib/file-auto-tagging.js");

function generator(seed) {
    let state = seed >>> 0;
    return () => {
        state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
        return state / 0x100000000;
    };
}

test("property: valid tag order never changes exact-match correctness", () => {
    const random = generator(0x121);
    const tags = ["invoice", "scan", "tax-2026", "italian"];
    for (let index = 0; index < 1000; index += 1) {
        const shuffled = [...tags].sort(() => random() - 0.5);
        assert.equal(Tagging.sameTags(tags, shuffled), true);
    }
});

test("property: file byte and batch bounds are exact", () => {
    const random = generator(0x128);
    for (let index = 0; index < 500; index += 1) {
        const size = Math.floor(random() * (Tagging.MAX_FILE_BYTES + 3));
        const file = Fixture.file("item-1", "item.png", size, []);
        assert.equal(Tagging.validFile(file), size >= 1 && size <= Tagging.MAX_FILE_BYTES);
    }
    for (let count = 0; count <= Tagging.MAX_FILES_PER_BATCH + 1; count += 1) {
        const input = Fixture.input("batch", Array.from({length: count}, (_value, index) => (
            Fixture.file(`item-${index}`, `item-${index}.png`, 1, [])
        )));
        assert.equal(Tagging.validInput(input), count >= 1 && count <= Tagging.MAX_FILES_PER_BATCH);
    }
});

test("fuzz: hostile shallow values never escape tag validators", () => {
    const random = generator(0x125);
    const values = [null, undefined, true, false, 0, 1, "", [], {}, Symbol("x")];
    for (let index = 0; index < 1000; index += 1) {
        const value = values[Math.floor(random() * values.length)];
        assert.doesNotThrow(() => Tagging.validTag(value));
        assert.doesNotThrow(() => Tagging.validFile(value));
        assert.doesNotThrow(() => Tagging.validInput(value));
        assert.doesNotThrow(() => Tagging.validCandidate(value));
    }
});
