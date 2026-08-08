"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const Domain = require("../../lib/domain.js");

function generator(seed) {
    let state = seed >>> 0;
    return () => {
        state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
        return state;
    };
}

test("fuzz: bounded runtime text contains only complete Unicode code points", () => {
    const random = generator(0x554e4943);
    for (let iteration = 0; iteration < 4_096; iteration += 1) {
        let input = "";
        const inputLength = random() % 80;
        for (let index = 0; index < inputLength; index += 1) {
            const choice = random() % 5;
            if (choice === 0) {
                input += String.fromCodePoint(0x1f300 + (random() % 0x300));
            } else if (choice === 1) {
                input += String.fromCharCode(0xd800 + (random() % 0x800));
            } else {
                input += String.fromCharCode(0x21 + (random() % 94));
            }
        }
        const maximumLength = random() % 64;
        const output = Domain.safeText(input, maximumLength);
        const outputCharacters = Array.from(output);

        assert.ok(outputCharacters.length <= maximumLength);
        assert.equal(outputCharacters.some((character) => {
            const codePoint = character.codePointAt(0);
            return codePoint >= 0xd800 && codePoint <= 0xdfff;
        }), false);
    }
});
