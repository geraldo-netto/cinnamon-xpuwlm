"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const Validation = require("../../files/cinnamon-xpuwlm@geraldo-netto/lib/validation.js");

function generator(seed) {
    let state = seed >>> 0;
    return () => {
        state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
        return state / 0x1_0000_0000;
    };
}

test("fuzz: bounded text agrees with code-point length", () => {
    const random = generator(0x56414c49);
    for (let index = 0; index < 5000; index += 1) {
        const length = Math.floor(random() * 130);
        let value = "";
        for (let character = 0; character < length; character += 1) {
            const codePoint = random() < 0.5
                ? 32 + Math.floor(random() * 95)
                : 0x1f300 + Math.floor(random() * 0x300);
            value += String.fromCodePoint(codePoint);
        }
        const minimum = Math.floor(random() * 12);
        const maximum = minimum + Math.floor(random() * 120);
        assert.equal(
            Validation.boundedText(value, minimum, maximum),
            [...value].length >= minimum && [...value].length <= maximum,
        );
    }
});

test("fuzz: text comparison is antisymmetric and preserves code-unit order", () => {
    const random = generator(0x534f5254);
    const alphabet = ["A", "Z", "a", "z", "é", "Ω", "😀"];
    for (let index = 0; index < 5000; index += 1) {
        const left = alphabet[Math.floor(random() * alphabet.length)];
        const right = alphabet[Math.floor(random() * alphabet.length)];
        const comparison = Validation.compareText(left, right);
        assert.equal(comparison + Validation.compareText(right, left), 0);
        assert.deepEqual(
            [left, right].sort(Validation.compareText),
            left <= right ? [left, right] : [right, left],
        );
    }
});

test("fuzz: digest and request ID predicates agree with their canonical syntax", () => {
    const random = generator(0x424f554e);
    const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789._- !";
    for (let index = 0; index < 5000; index += 1) {
        const length = Math.floor(random() * 130);
        let value = "";
        for (let character = 0; character < length; character += 1) {
            value += alphabet[Math.floor(random() * alphabet.length)];
        }
        assert.equal(Validation.isDigest(value), /^[a-f0-9]{64}$/u.test(value));
        assert.equal(Validation.isRequestId(value), /^[A-Za-z0-9._-]{1,120}$/u.test(value));
    }
});
