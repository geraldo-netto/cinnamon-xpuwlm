"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const Refusal = require("../../files/cinnamon-xpuwlm@geraldo-netto/lib/runtime-refusal-contract.js");

const refusal = Object.freeze({
    version: 1,
    status: "rejected",
    code: "rate-limit-exceeded",
    message: "ApplyCommand allows 30 calls per 10s",
    method: "ApplyCommand",
});

test("the refusal predicate accepts exactly the version 1 envelope", () => {
    assert.equal(Refusal.isRuntimeRefusal(refusal), true);
    assert.equal(Refusal.isRuntimeRefusal({...refusal, method: ""}), true);
    for (const code of Refusal.REFUSAL_CODES) {
        assert.equal(Refusal.isRuntimeRefusal({...refusal, code}), true, code);
    }
});

test("the refusal predicate rejects every envelope defect", () => {
    const rejected = [
        null,
        [],
        "rejected",
        {...refusal, version: 2},
        {...refusal, status: "applied"},
        {...refusal, code: "unknown-code"},
        {...refusal, message: ""},
        {...refusal, message: "x".repeat(501)},
        {...refusal, method: "1Method"},
        {...refusal, method: "A".repeat(65)},
        {...refusal, extra: 1},
    ];
    for (const candidate of rejected) {
        assert.equal(Refusal.isRuntimeRefusal(candidate), false, JSON.stringify(candidate));
    }
    const {method, ...withoutMethod} = refusal;
    assert.equal(method, "ApplyCommand");
    assert.equal(Refusal.isRuntimeRefusal(withoutMethod), false);
});

test("bounded refusal text counts code points, not UTF-16 units", () => {
    assert.equal(Refusal.boundedText("😀😀", 1, 2), true);
    assert.equal(Refusal.boundedText("😀😀", 1, 1), false);
    assert.equal(Refusal.boundedText(7, 0, 10), false);
});

test("a refused call carries the whole document, not a rendered sentence", () => {
    const error = new Refusal.RuntimeRefusedError(refusal);
    assert.equal(error.name, "RuntimeRefusedError");
    assert.equal(error.code, "rate-limit-exceeded");
    assert.equal(error.method, "ApplyCommand");
    assert.deepEqual(error.refusal, refusal);
    assert.match(String(error), /ApplyCommand: rate-limit-exceeded/u);
    assert.match(
        String(new Refusal.RuntimeRefusedError({...refusal, method: ""})),
        /the request: rate-limit-exceeded/u,
    );
    assert.throws(() => new Refusal.RuntimeRefusedError({}), /version 1 contract/u);
});

test("refusal recognition is structural so a second module copy still matches", () => {
    assert.deepEqual(Refusal.refusalOf(new Refusal.RuntimeRefusedError(refusal)), refusal);
    assert.deepEqual(Refusal.refusalOf({refusal: {...refusal}}), refusal);
    assert.equal(Refusal.refusalOf(new Error("transport failed")), null);
    assert.equal(Refusal.refusalOf({refusal: {...refusal, code: "nope"}}), null);
    assert.equal(Refusal.refusalOf(null), null);
    assert.equal(Refusal.refusalOf(undefined), null);
    assert.equal(Refusal.refusalOf("rejected"), null);
});
