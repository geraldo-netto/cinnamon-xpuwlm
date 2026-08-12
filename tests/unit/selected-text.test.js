"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const Selected = require("../../files/cinnamon-xpuwlm@geraldo-netto/lib/selected-text.js");

const DIGEST = "a".repeat(64);

function output(overrides = {}) {
    return {
        version: 1,
        requestId: "job-1",
        operation: "summarize",
        result: "A bounded summary.",
        tasks: [],
        providerId: "qwen3-gpu",
        accelerator: "gpu",
        evidence: {
            selectionSha256: DIGEST,
            span: {start: 0, end: 14},
            textSha256: DIGEST,
        },
        ...overrides,
    };
}

function scheduler() {
    return {
        pending: [], cancelled: [],
        schedule(delay, callback) {
            const handle = {delay, callback};
            this.pending.push(handle);
            return handle;
        },
        cancel(handle) { this.cancelled.push(handle); return true; },
        run() { this.pending.shift().callback(); },
    };
}

function harness() {
    const timer = scheduler();
    const clipboard = {
        callback: null, cancelled: 0,
        readText(callback) { this.callback = callback; return true; },
        cancel() { this.cancelled += 1; return true; },
    };
    const gateway = {
        submissions: [], polls: [], cancellations: [], cancelled: 0,
        submit(document, callback) { this.submissions.push({document, callback}); },
        requestResult(document, callback) { this.polls.push({document, callback}); },
        cancelJob(document, callback) { this.cancellations.push({document, callback}); },
        cancel() { this.cancelled += 1; return true; },
    };
    const controller = new Selected.SelectedTextController({
        clipboard, gateway, scheduler: timer, clock: {now: () => 1_700_000_000_000},
    });
    return {clipboard, controller, gateway, timer};
}

function accept(h, jobId = "job-1") {
    h.gateway.submissions.at(-1).callback(null, {
        status: "accepted", jobId, message: "Queued",
    });
}

test("selected-text pure contracts preserve exact one-shot boundaries", () => {
    assert.equal(Selected.PROFILE_ID, "selected-text-tools");
    assert.deepEqual(Selected.OPERATIONS, [
        "explain", "summarize", "rewrite", "translate", "extract-tasks",
    ]);
    const error = new Selected.SelectedTextError("bad", "detail");
    assert.deepEqual([error.name, error.code, error.detail, error.message], [
        "SelectedTextError", "bad", "detail", "bad: detail",
    ]);
    assert.deepEqual(Selected.initialState().tasks, []);
    for (const operation of Selected.OPERATIONS) {
        assert.equal(Selected.normalizedOperation(operation), operation);
    }
    assert.throws(() => Selected.normalizedOperation("delete"), /operation-invalid/u);
    assert.equal(Selected.normalizedSelection(" x "), " x ");
    assert.equal(
        Selected.normalizedSelection("x".repeat(Selected.MAX_SELECTION_CHARACTERS)).length,
        Selected.MAX_SELECTION_CHARACTERS,
    );
    for (const invalid of [null, "", "  ", "x".repeat(Selected.MAX_SELECTION_CHARACTERS + 1)]) {
        assert.throws(() => Selected.normalizedSelection(invalid), /selection-invalid/u);
    }
    assert.equal(Selected.normalizedLanguage("translate", " Italian "), "Italian");
    assert.equal(Selected.normalizedLanguage("summarize", null), null);
    assert.equal(Selected.normalizedLanguage("summarize", ""), null);
    for (const [operation, language] of [
        ["translate", ""], ["translate", "it_IT"],
        ["translate", "x".repeat(Selected.MAX_LANGUAGE_CHARACTERS + 1)],
        ["summarize", "Italian"],
    ]) {
        assert.throws(() => Selected.normalizedLanguage(operation, language), /language-invalid/u);
    }
    assert.deepEqual(Selected.submission("request-1", "Selected text", "translate", "Italian"), {
        version: 1,
        requestId: "request-1",
        workloadId: "selected-text-tools",
        payload: {selection: "Selected text", operation: "translate", language: "Italian"},
    });
    assert.deepEqual(Selected.submission("request-2", "Selected text", "explain"), {
        version: 1,
        requestId: "request-2",
        workloadId: "selected-text-tools",
        payload: {selection: "Selected text", operation: "explain"},
    });
    assert.throws(
        () => Selected.submission("bad request", "Selected text", "explain"),
        /request-invalid/u,
    );
});

test("public results are closed, operation-bound, grounded, and deeply cloned", () => {
    const parsed = Selected.selectedTextResult(output(), "job-1", "summarize");
    assert.deepEqual(parsed, output());
    assert.equal(Object.isFrozen(parsed), true);
    assert.equal(Object.isFrozen(parsed.tasks), true);
    assert.equal(Object.isFrozen(parsed.evidence.span), true);
    const taskOutput = output({
        operation: "extract-tasks", tasks: ["Restart service", "Review logs"],
    });
    assert.equal(
        Selected.selectedTextResult(taskOutput, "job-1", "extract-tasks").tasks.length,
        2,
    );
    const invalid = [
        output({version: 2}), output({requestId: "other"}), output({operation: "rewrite"}),
        output({result: ""}), output({tasks: ["unexpected"]}),
        output({providerId: "Bad Provider"}), output({accelerator: "cpu"}),
        output({extra: true}), output({evidence: {...output().evidence, extra: true}}),
        output({evidence: {...output().evidence, selectionSha256: "b".repeat(64)}}),
        output({evidence: {...output().evidence, span: {start: 1, end: 14}}}),
        output({evidence: {...output().evidence, span: {start: 0, end: 0}}}),
        output({tasks: new Array(Selected.MAX_TASKS + 1).fill("task")}),
    ];
    for (const value of invalid) {
        assert.throws(
            () => Selected.selectedTextResult(value, "job-1", "summarize"),
            /result-invalid/u,
        );
    }
    assert.equal(Selected.validEvidence(output().evidence), true);
    assert.equal(Selected.validEvidence(null), false);
    assert.equal(Selected.validTasks([], "summarize"), true);
    assert.equal(Selected.validTasks(["one", "one"], "extract-tasks"), false);
    assert.equal(Selected.validResultIdentity(output(), "job-1", "summarize"), true);
    assert.equal(Selected.validResultIdentity(output(), "job-1", "explain"), false);
    assert.equal(Selected.validResultContent(output()), true);
});

test("controller reads clipboard only after a click and never retains selection text", () => {
    const h = harness();
    const phases = [];
    const unsubscribe = h.controller.subscribe((state) => phases.push(state.phase));
    assert.deepEqual(h.controller.state(), Selected.initialState());
    assert.equal(h.clipboard.callback, null);
    assert.equal(h.controller.start("summarize"), false);
    assert.equal(h.controller.setAvailability(true, "Ready"), true);
    assert.equal(h.controller.setAvailability(true, "Ready"), false);
    assert.equal(h.controller.start("summarize"), true);
    assert.equal(h.controller.state().phase, "selecting");
    assert.equal(h.controller.state().selection, undefined);
    h.clipboard.callback(null, "Private selected text");
    assert.equal(h.gateway.submissions.length, 1);
    assert.deepEqual(h.gateway.submissions[0].document.payload, {
        selection: "Private selected text", operation: "summarize",
    });
    assert.equal(h.controller.state().selection, undefined);
    accept(h);
    assert.equal(h.timer.pending[0].delay, Selected.POLL_INTERVAL_MS);
    h.timer.run();
    h.gateway.polls[0].callback(null, {
        state: "running", message: "Generating", progress: {fraction: 0.5, detail: "Model"},
    });
    h.timer.run();
    h.gateway.polls[1].callback(null, {
        state: "succeeded", jobId: "job-1", output: output(),
    });
    const state = h.controller.state();
    assert.equal(state.phase, "complete");
    assert.equal(state.result, "A bounded summary.");
    assert.equal(state.selection, undefined);
    state.evidence.span.end = 1;
    assert.equal(h.controller.state().evidence.span.end, 14);
    assert.equal(h.controller.reset(), true);
    assert.equal(h.controller.state().available, true);
    assert.equal(unsubscribe(), true);
    assert.ok(phases.includes("submitting"));
});

test("controller fails closed across capture, submit, poll, and result faults", () => {
    const capture = harness();
    capture.controller.setAvailability(true);
    capture.controller.start("translate", "bad-1");
    assert.equal(capture.controller.state().phase, "error");
    assert.equal(
        capture.controller.state().message,
        `translation language must contain 1-${Selected.MAX_LANGUAGE_CHARACTERS} letters`,
    );
    assert.equal(capture.controller.start("summarize"), true);
    capture.clipboard.callback(null, " ");
    assert.match(capture.controller.state().message, /selection/u);

    const submit = harness();
    submit.controller.setAvailability(true);
    submit.controller.start("explain");
    submit.clipboard.callback(new Error("clipboard denied"));
    assert.match(submit.controller.state().message, /denied/u);
    assert.equal(submit.controller.start("explain"), true);
    submit.clipboard.callback(null, "Text");
    submit.gateway.submissions.at(-1).callback(new Error("offline"));
    assert.match(submit.controller.state().message, /offline/u);
    assert.equal(submit.controller.start("explain"), true);
    submit.clipboard.callback(null, "Text");
    submit.gateway.submissions.at(-1).callback(null, {status: "rejected", message: "No model"});
    assert.match(submit.controller.state().message, /No model/u);

    const poll = harness();
    poll.controller.setAvailability(true);
    poll.controller.start("summarize");
    poll.clipboard.callback(null, "Text");
    accept(poll);
    poll.timer.run();
    poll.gateway.polls[0].callback(new Error("temporary"));
    assert.equal(poll.controller.state().phase, "running");
    poll.timer.run();
    poll.gateway.polls[1].callback(null, {state: "failed", message: "Generation failed"});
    assert.match(poll.controller.state().message, /Generation failed/u);

    const mismatch = harness();
    mismatch.controller.setAvailability(true);
    mismatch.controller.start("summarize");
    mismatch.clipboard.callback(null, "Text");
    accept(mismatch);
    mismatch.timer.run();
    mismatch.gateway.polls[0].callback(null, {
        state: "succeeded", jobId: "job-1", output: output({operation: "rewrite"}),
    });
    assert.match(mismatch.controller.state().message, /result/u);
});

test("cancellation, stale callbacks, disposal, and port validation are deterministic", () => {
    const selecting = harness();
    selecting.controller.setAvailability(true);
    selecting.controller.start("explain");
    const staleCapture = selecting.clipboard.callback;
    assert.equal(selecting.controller.cancel(), true);
    assert.equal(selecting.clipboard.cancelled, 1);
    assert.equal(selecting.gateway.cancelled, 1);
    assert.equal(selecting.controller.state().phase, "idle");
    staleCapture(null, "must be ignored");
    assert.equal(selecting.gateway.submissions.length, 0);

    const running = harness();
    running.controller.setAvailability(true);
    running.controller.start("rewrite");
    running.clipboard.callback(null, "Text");
    accept(running);
    assert.equal(running.controller.cancel(), true);
    assert.equal(running.timer.cancelled.length, 1);
    running.gateway.cancellations[0].callback(null);
    assert.equal(running.controller.state().phase, "idle");
    assert.equal(running.controller.cancel(), false);
    assert.equal(running.controller.dispose(), true);
    assert.equal(running.controller.dispose(), false);
    assert.throws(() => running.controller.start("explain"), /disposed/u);

    const gateway = {submit() {}, requestResult() {}, cancelJob() {}, cancel() {}};
    const clipboard = {readText() {}, cancel() {}};
    const timer = {schedule() {}, cancel() {}};
    assert.throws(() => new Selected.SelectedTextController({
        clipboard: {}, gateway, scheduler: timer, clock: Date,
    }), /Clipboard reader/u);
    assert.throws(() => new Selected.SelectedTextController({
        clipboard, gateway: {}, scheduler: timer, clock: Date,
    }), /gateway/u);
    assert.throws(() => new Selected.SelectedTextController({
        clipboard, gateway, scheduler: {}, clock: Date,
    }), /scheduler/u);
    assert.throws(() => new Selected.SelectedTextController({
        clipboard, gateway, scheduler: timer, clock: {},
    }), /clock/u);
    assert.throws(() => selecting.controller.subscribe(null), /listener/u);
});

test("controller covers malformed acknowledgements, timeout, and callback race boundaries", () => {
    for (const acknowledgement of [null, {status: "accepted"}]) {
        const rejected = harness();
        rejected.controller.setAvailability(true);
        rejected.controller.start("explain");
        rejected.clipboard.callback(null, "Text");
        rejected.gateway.submissions[0].callback(null, acknowledgement);
        assert.equal(rejected.controller.state().phase, "error");
        assert.match(rejected.controller.state().message, /rejected/u);
    }

    const timeout = harness();
    timeout.controller.setAvailability(true);
    timeout.controller.start("explain");
    timeout.clipboard.callback(null, "Text");
    accept(timeout);
    assert.equal(timeout.controller._poll(timeout.controller._sequence + 1), false);
    timeout.controller._polls = Selected.MAX_POLLS;
    timeout.timer.run();
    assert.match(timeout.controller.state().message, /did not report/u);

    const transport = harness();
    transport.controller.setAvailability(true);
    transport.controller.start("explain");
    transport.clipboard.callback(null, "Text");
    accept(transport);
    transport.gateway.requestResult = () => { throw new Error("poll transport"); };
    transport.timer.run();
    assert.equal(transport.controller.state().phase, "running");
    assert.equal(transport.timer.pending.length, 1);
    assert.equal(transport.controller._result(transport.controller._sequence + 1, null, {}), false);

    const progressFallback = harness();
    progressFallback.controller.setAvailability(true);
    progressFallback.controller.start("explain");
    progressFallback.clipboard.callback(null, "Text");
    accept(progressFallback);
    progressFallback.timer.run();
    progressFallback.gateway.polls[0].callback(null, {state: "running", message: "Still running"});
    assert.deepEqual(progressFallback.controller.state().progress, {fraction: 0, detail: "Queued"});
    assert.equal(progressFallback.controller._terminalResult({state: "failed"}), false);
    assert.match(progressFallback.controller.state().message, /failed/u);
});

test("controller covers busy reset, cancellation failures, and fallback error text", () => {
    const busy = harness();
    busy.controller.setAvailability(true);
    busy.controller.start("rewrite");
    assert.equal(busy.controller.start("summarize"), false);
    assert.equal(busy.controller.reset(), false);
    assert.equal(busy.controller._cancelled(busy.controller._sequence + 1, null), false);
    busy.controller.cancel();
    assert.equal(busy.controller._fail(""), false);
    assert.equal(busy.controller.state().message, "Selected-text request failed");

    const running = harness();
    running.controller.setAvailability(true);
    running.controller.start("rewrite");
    running.clipboard.callback(null, "Text");
    accept(running);
    running.controller.cancel();
    running.gateway.cancellations[0].callback(new Error("cancel failed"));
    assert.match(running.controller.state().message, /cancel failed/u);
});

test("controller return values, sequence, state clearing, and synchronous faults are exact", () => {
    const syncRead = harness();
    syncRead.controller.setAvailability(true);
    syncRead.clipboard.readText = () => { throw new Error("read failed"); };
    assert.equal(syncRead.controller.start("explain"), true);
    assert.equal(syncRead.controller.state().message, "Error: read failed");
    assert.equal(syncRead.controller._nextSequence(), 2);
    assert.equal(syncRead.controller._nextSequence(), 3);

    const syncSubmit = harness();
    syncSubmit.controller.setAvailability(true);
    syncSubmit.controller.start("extract-tasks");
    syncSubmit.gateway.submit = () => { throw new Error("submit failed"); };
    assert.equal(syncSubmit.controller._captured(
        syncSubmit.controller._sequence,
        null,
        "Selected text",
        "extract-tasks",
        null,
    ), true);
    assert.equal(syncSubmit.controller.state().message, "Error: submit failed");
    assert.equal(syncSubmit.controller._captured(
        syncSubmit.controller._sequence,
        null,
        "Selected text",
        "extract-tasks",
        null,
    ), false);

    const resultFlow = harness();
    resultFlow.controller.setAvailability(true);
    resultFlow.controller.start("extract-tasks");
    resultFlow.clipboard.callback(null, "Selected text");
    accept(resultFlow);
    assert.equal(resultFlow.controller._result(resultFlow.controller._sequence, null, {
        state: "running", message: "Generating", progress: {fraction: 0.25, detail: "Qwen"},
    }), true);
    assert.deepEqual(resultFlow.controller.state().progress, {fraction: 0.25, detail: "Qwen"});
    assert.equal(resultFlow.controller._terminalResult({
        state: "succeeded", jobId: "job-1", output: output({
            operation: "extract-tasks", tasks: ["Review logs"],
        }),
    }), true);
    assert.deepEqual(resultFlow.controller.state().tasks, ["Review logs"]);
    assert.equal(resultFlow.controller._result(
        resultFlow.controller._sequence, null, {state: "running"},
    ), false);

    const poll = harness();
    assert.equal(poll.controller._clearPoll(), false);
    const handle = {id: 1};
    poll.controller._pollHandle = handle;
    assert.equal(poll.controller._clearPoll(), true);
    assert.deepEqual(poll.timer.cancelled, [handle]);
    assert.equal(poll.controller._pollHandle, null);
});
