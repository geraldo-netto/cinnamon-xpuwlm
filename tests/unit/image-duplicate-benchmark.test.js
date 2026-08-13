"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const Fixture = require("../helpers/image-duplicate-fixture.js");
const Duplicate = require("../../files/cinnamon-xpuwlm@geraldo-netto/lib/image-duplicate-benchmark.js");

test("images require supported visual formats and complete SHA-256 digests", () => {
    const current = Fixture.plan().inputs[0].images[0];
    assert.equal(Duplicate.validImage(current), true);
    assert.deepEqual(Duplicate.taggingImage(current).expectedTags, []);
    for (const fault of [
        null,
        {...current, extra: true},
        {...current, name: "image.svg"},
        {...current, sha256: "a".repeat(63)},
        {...current, sha256: `${"a".repeat(64)}0`},
    ]) {
        assert.equal(Duplicate.validImage(fault), false);
    }
});

test("labeled pairs are bounded, unique, and reference selected images", () => {
    const input = Fixture.plan().inputs[1];
    assert.equal(Duplicate.validInput(input), true);
    for (const fault of [
        null,
        {...input, extra: true},
        {...input, images: input.images.slice(0, 1)},
        {...input, images: [input.images[0], input.images[0]]},
        {...input, pairs: []},
        {...input, pairs: [input.pairs[0], {...input.pairs[0], leftId: input.pairs[0].rightId,
            rightId: input.pairs[0].leftId}]},
        {...input, pairs: [{leftId: "copy-a", rightId: "missing", expectedRelated: true}]},
        {...input, pairs: [{leftId: "copy-a", rightId: "copy-a", expectedRelated: true}]},
    ]) {
        assert.equal(Duplicate.validInput(fault), false);
    }
});

test("each duplicate strategy is pinned to its execution kind", () => {
    const plan = Fixture.plan();
    for (const candidate of plan.candidates) {
        assert.equal(Duplicate.validCandidate(candidate), true);
    }
    assert.equal(Duplicate.validCandidate({...plan.candidates[0], kind: "gpu"}), false);
    assert.equal(Duplicate.validCandidate({...plan.candidates[0], strategy: "unknown"}), false);
    assert.equal(Duplicate.validCandidate({...plan.candidates[0], extra: true}), false);
    assert.equal(Duplicate.validCandidate(null), false);
});

test("byte identity is derived only from exact source digests", () => {
    const edited = Fixture.plan().inputs[0];
    const editedDecision = Fixture.decision(edited, edited.pairs[0]);
    assert.equal(Duplicate.validDecision(editedDecision, edited), true);
    assert.equal(editedDecision.related, true);
    assert.equal(editedDecision.byteIdentical, false);
    const exact = Fixture.plan().inputs[1];
    const exactDecision = Fixture.decision(exact, exact.pairs[0]);
    assert.equal(Duplicate.validDecision(exactDecision, exact), true);
    assert.equal(exactDecision.byteIdentical, true);
    for (const fault of [
        {...exactDecision, leftSha256: "c".repeat(63)},
        {...exactDecision, leftSha256: Fixture.DIGEST_A},
        {...exactDecision, byteIdentical: false},
        {...exactDecision, score: -1},
        {...exactDecision, extra: true},
    ]) {
        assert.equal(Duplicate.validDecision(fault, exact), false);
    }
});

test("decisions cover every labeled pair and score relatedness", () => {
    const input = Fixture.plan().inputs[1];
    const decisions = input.pairs.map((pair) => Fixture.decision(input, pair));
    assert.equal(Duplicate.validDecisions(decisions, input), true);
    assert.equal(Duplicate.decisionsCorrect(decisions, input), true);
    assert.equal(Duplicate.decisionsCorrect([
        {...decisions[0], related: false}, decisions[1],
    ], input), false);
    assert.equal(Duplicate.validDecisions(null, input), false);
    assert.equal(Duplicate.validDecisions([], input), false);
    assert.equal(Duplicate.validDecisions([decisions[0], decisions[0]], input), false);
});

test("candidate outputs become immutable common observations", () => {
    const input = Fixture.plan().inputs[0];
    const valid = Fixture.output(input);
    assert.equal(Duplicate.validOutput(valid, input), true);
    const observed = Duplicate.observation(valid, input);
    assert.equal(observed.correct, true);
    assert.equal(Object.isFrozen(observed.stages), true);
    for (const fault of [null, {...valid, extra: true}, {...valid, decisions: []}]) {
        assert.equal(Duplicate.validOutput(fault, input), false);
        assert.throws(() => Duplicate.observation(fault, input), /output is invalid/u);
    }
});

test("benchmark plans require every measured strategy", () => {
    const plan = Fixture.plan();
    assert.doesNotThrow(() => Duplicate.validatePlan(plan));
    for (const fault of [
        null,
        {...plan, extra: true},
        {...plan, inputs: null},
        {...plan, inputs: []},
        {...plan, candidates: null},
        {...plan, candidates: plan.candidates.slice(1)},
        {...plan, measuredRuns: 0},
    ]) {
        assert.throws(() => Duplicate.validatePlan(fault));
    }
});

test("duplicate review has no destructive capability", () => {
    const input = Fixture.plan().inputs[0];
    const decisions = input.pairs.map((pair) => Fixture.decision(input, pair));
    const review = Duplicate.reviewDuplicatePairs(input, decisions, "gpu-embedding");
    assert.equal(review.reviewOnly, true);
    assert.equal(Object.isFrozen(review.pairs[0]), true);
    for (const key of ["delete", "apply", "move", "rename"]) {
        assert.equal(Object.hasOwn(review, key), false);
    }
    assert.throws(() => Duplicate.reviewDuplicatePairs(null, decisions, "gpu"));
    assert.throws(() => Duplicate.reviewDuplicatePairs(input, [], "gpu"));
    assert.throws(() => Duplicate.reviewDuplicatePairs(input, decisions, "Bad id"));
});
