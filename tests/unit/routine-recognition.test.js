"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const Fixture = require("../helpers/routine-recognition-fixture.js");
const Routine = require("../../files/cinnamon-xpuwlm@geraldo-netto/lib/routine-recognition.js");

test("activity samples accept only bounded content-free features", () => {
    const valid = Fixture.sample(1);
    assert.equal(Routine.validSample(valid), true);
    for (const fault of [
        null,
        {...valid, windowTitle: "Private document"},
        {...valid, minuteBucket: -1},
        {...valid, minuteBucket: 1440},
        {...valid, weekday: 7},
        {...valid, appClass: 6},
        {...valid, deviceClass: 6},
        {...valid, activeSeconds: 86_401},
        {...valid, transitionCount: 1025},
    ]) {
        assert.equal(Routine.validSample(fault), false);
    }
});

test("routine inputs are versioned, bounded, and sequence-unique", () => {
    const input = Fixture.plan().inputs[0];
    assert.equal(Routine.validInput(input), true);
    for (const fault of [
        null,
        {...input, extra: true},
        {...input, featureVersion: 0},
        {...input, samples: []},
        {...input, samples: [Fixture.sample(1), Fixture.sample(1)]},
        {...input, expectedSuggestions: [
            Fixture.expected("same", "prepare-development"),
            Fixture.expected("same", "prepare-meeting"),
        ]},
        {...input, expectedSuggestions: [Fixture.expected("x", "unknown")]},
    ]) {
        assert.equal(Routine.validInput(fault), false);
    }
});

test("strategies are pinned to statistical, host, GPU, and hybrid kinds", () => {
    const plan = Fixture.plan();
    for (const candidate of plan.candidates) {
        assert.equal(Routine.validCandidate(candidate), true);
    }
    assert.equal(Routine.validCandidate({...plan.candidates[0], kind: "gpu"}), false);
    assert.equal(Routine.validCandidate({...plan.candidates[0], strategy: "unknown"}), false);
    assert.equal(Routine.validCandidate({...plan.candidates[0], extra: true}), false);
    assert.equal(Routine.validCandidate(null), false);
});

test("suggestions are allowlisted and bound to observed feature sequences", () => {
    const input = Fixture.plan().inputs[1];
    const valid = Fixture.suggestion("meeting", "prepare-meeting", [10, 12]);
    assert.equal(Routine.validSuggestion(valid, input), true);
    assert.equal(Routine.validSuggestions([valid], input), true);
    for (const fault of [
        {...valid, extra: true},
        {...valid, actionId: "launch-command"},
        {...valid, confidence: -1},
        {...valid, confidence: 1.1},
        {...valid, evidenceSequences: []},
        {...valid, evidenceSequences: [999]},
        {...valid, evidenceSequences: [10, 10]},
    ]) {
        assert.equal(Routine.validSuggestion(fault, input), false);
    }
    assert.equal(Routine.validSuggestions(null, input), false);
    assert.equal(Routine.validSuggestions([valid, valid], input), false);
});

test("correctness compares the complete suggestion identity set", () => {
    const input = Fixture.plan().inputs[0];
    const valid = [Fixture.suggestion("morning-dev", "prepare-development", [1])];
    assert.equal(Routine.suggestionsCorrect(valid, input), true);
    assert.equal(Routine.suggestionsCorrect([], input), false);
    assert.equal(Routine.suggestionsCorrect([
        Fixture.suggestion("morning-dev", "prepare-meeting", [1]),
    ], input), false);
});

test("candidate output becomes immutable measured evidence", () => {
    const input = Fixture.plan().inputs[0];
    const valid = Fixture.output(input);
    assert.equal(Routine.validOutput(valid, input), true);
    const observed = Routine.observation(valid, input);
    assert.equal(observed.correct, true);
    assert.equal(Object.isFrozen(observed.stages), true);
    for (const fault of [null, {...valid, extra: true}, {...valid, suggestions: null}]) {
        assert.equal(Routine.validOutput(fault, input), false);
        assert.throws(() => Routine.observation(fault, input), /output is invalid/u);
    }
});

test("benchmark plan requires every routine strategy", () => {
    const plan = Fixture.plan();
    assert.doesNotThrow(() => Routine.validatePlan(plan));
    for (const fault of [
        null,
        {...plan, extra: true},
        {...plan, inputs: null},
        {...plan, inputs: []},
        {...plan, candidates: null},
        {...plan, candidates: plan.candidates.slice(1)},
        {...plan, measuredRuns: 0},
    ]) {
        assert.throws(() => Routine.validatePlan(fault));
    }
});

test("every review suggestion requires opt-in and fresh confirmation", () => {
    const input = Fixture.plan().inputs[0];
    const suggestions = [Fixture.suggestion("morning-dev", "prepare-development", [1])];
    const review = Routine.reviewRoutineSuggestions(input, suggestions, "vulkan");
    assert.equal(review.optInRequired, true);
    assert.equal(review.reviewOnly, true);
    assert.equal(review.suggestions[0].confirmationRequired, true);
    assert.equal(Object.isFrozen(review.suggestions[0].evidenceSequences), true);
    for (const key of ["execute", "apply", "confirm", "enable"]) {
        assert.equal(Object.hasOwn(review, key), false);
    }
    assert.throws(() => Routine.reviewRoutineSuggestions(null, suggestions, "vulkan"));
    assert.throws(() => Routine.reviewRoutineSuggestions(input, null, "vulkan"));
    assert.throws(() => Routine.reviewRoutineSuggestions(input, suggestions, "Bad id"));
});

// A routine suggestion is review-only and acts on nothing by itself, so its
// evidence is the only thing the user has to judge it by: a sequence that was
// never sampled shows them a reason that did not happen.
test("a suggestion cites sampled sequences, a known action, and a real confidence", () => {
    const samples = [Fixture.sample(1), Fixture.sample(2), Fixture.sample(3)];
    const input = Fixture.input("day", samples, []);
    const valid = (overrides) => Routine.validSuggestion(
        Fixture.suggestion("morning", Routine.ACTIONS[0], [1], overrides),
        input,
    );

    assert.equal(valid({}), true);
    assert.equal(
        Routine.validSuggestion(Fixture.suggestion("morning", Routine.ACTIONS[0], [1, 3]), input),
        true,
        "several sampled sequences",
    );

    // Every action is one the host allowlist knows; anything else is a
    // suggestion nothing can carry out.
    for (const actionId of Routine.ACTIONS) {
        assert.equal(
            Routine.validSuggestion(Fixture.suggestion("morning", actionId, [1]), input),
            true,
            actionId,
        );
    }
    assert.equal(
        Routine.validSuggestion(Fixture.suggestion("morning", "run-anything", [1]), input),
        false,
        "an action outside the allowlist",
    );

    // Evidence has to name sequences that were actually sampled.
    for (const [label, sequences] of [
        ["never sampled", [9]],
        ["nothing cited", []],
        ["repeated", [1, 1]],
        ["not a list", "1"],
    ]) {
        assert.equal(
            Routine.validSuggestion(Fixture.suggestion("morning", Routine.ACTIONS[0], sequences), input),
            false,
            label,
        );
    }

    // Confidence is a probability, not a score.
    for (const confidence of [-0.1, 1.1, Number.NaN, Infinity, "0.9", null]) {
        assert.equal(valid({confidence}), false, String(confidence));
    }
    assert.equal(valid({confidence: 0}), true, "zero is a real confidence");
    assert.equal(valid({confidence: 1}), true, "and so is one");

    assert.equal(valid({extra: true}), false, "closed record");
    assert.equal(
        Routine.validSuggestion(Fixture.suggestion("Morning", Routine.ACTIONS[0], [1]), input),
        false,
        "identifier shape",
    );
});

test("a suggestion list is bounded and cannot repeat an identity", () => {
    const samples = [Fixture.sample(1)];
    const input = Fixture.input("day", samples, []);
    const one = Fixture.suggestion("morning", Routine.ACTIONS[0], [1]);

    assert.equal(Routine.validSuggestions([], input), true, "no suggestion is an answer");
    assert.equal(Routine.validSuggestions([one], input), true);
    assert.equal(
        Routine.validSuggestions([one, Fixture.suggestion("evening", Routine.ACTIONS[1], [1])], input),
        true,
    );

    // The same identity twice is one routine claimed twice, which would be
    // counted twice by anything measuring these.
    assert.equal(Routine.validSuggestions([one, {...one}], input), false, "repeated identity");
    assert.equal(
        Routine.validSuggestions(new Array(Routine.MAX_SUGGESTIONS + 1).fill(one), input),
        false,
        "bounded",
    );
    assert.equal(Routine.validSuggestions("suggestions", input), false);
});
