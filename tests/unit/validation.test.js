"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const Validation = require("../../files/cinnamon-xpuwlm@geraldo-netto/lib/validation.js");
const RootValidation = require("../../files/cinnamon-xpuwlm@geraldo-netto/validation.js");

test("validation root shim exposes the canonical module", () => {
    assert.equal(RootValidation, Validation);
});

test("record validation accepts only non-null non-array objects", () => {
    assert.equal(Validation.isRecord({}), true);
    assert.equal(Validation.isRecord(Object.create(null)), true);
    for (const value of [null, undefined, [], "record", 1, true]) {
        assert.equal(Validation.isRecord(value), false);
    }
});

test("exact keys supports closed array and set contracts", () => {
    assert.equal(Validation.exactKeys({a: 1, b: 2}, ["a", "b"]), true);
    assert.equal(Validation.exactKeys({a: 1, b: 2}, new Set(["a", "b"])), true);
    assert.equal(Validation.exactKeys({a: 1, extra: 2}, ["a"]), false);
    assert.equal(Validation.exactKeys({a: 1}, ["a", "b"]), false);
    assert.equal(Validation.exactKeys({a: 1, extra: 2}, new Set(["a"])), false);
    assert.equal(Validation.exactKeys({a: 1}, new Set(["a", "b"])), false);
    assert.equal(Validation.exactKeys(null, ["a"]), false);
    assert.equal(Validation.exactKeys({}, "bad-contract"), false);
});

test("bounded text counts Unicode code points at both exact boundaries", () => {
    assert.equal(Validation.boundedText("a😀", 2, 2), true);
    assert.equal(Validation.boundedText("a", 2, 3), false);
    assert.equal(Validation.boundedText("abcd", 1, 3), false);
    assert.equal(Validation.boundedText("", 0, 0), true);
    assert.equal(Validation.boundedText(null, 0, 1), false);
});

test("digest validation accepts exactly 64 lowercase hexadecimal characters", () => {
    assert.equal(Validation.isDigest("a".repeat(64)), true);
    assert.equal(Validation.isDigest("a".repeat(63)), false);
    assert.equal(Validation.isDigest("a".repeat(65)), false);
    assert.equal(Validation.isDigest("A".repeat(64)), false);
    assert.equal(Validation.isDigest(null), false);
});

test("request IDs accept the exact alphabet and one-to-120 code-point bounds", () => {
    assert.equal(Validation.isRequestId("a.B_1-2"), true);
    assert.equal(Validation.isRequestId("x".repeat(120)), true);
    assert.equal(Validation.isRequestId(""), false);
    assert.equal(Validation.isRequestId("x".repeat(121)), false);
    assert.equal(Validation.isRequestId("contains space"), false);
    assert.equal(Validation.isRequestId(null), false);
});
