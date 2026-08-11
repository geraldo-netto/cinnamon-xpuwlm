"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const Question = require("../../files/cinnamon-xpuwlm@geraldo-netto/lib/document-question.js");

const A = "a".repeat(64);
const B = "b".repeat(64);

function source(overrides = {}) {
    return {
        path: "/home/tester/Documents/guide.pdf",
        name: "guide.pdf",
        size: 120,
        regular: true,
        symlink: false,
        ...overrides,
    };
}

function citation(overrides = {}) {
    return {
        fileId: "selected-file-1",
        fileName: "guide.pdf",
        sourceSha256: A,
        page: 3,
        span: {start: 10, end: 42},
        textSha256: B,
        ...overrides,
    };
}

function answer(overrides = {}) {
    return {
        version: 1,
        requestId: "job-1",
        answer: "The guide requires a restart.",
        providerId: "qwen3-gpu",
        accelerator: "gpu",
        citations: [citation()],
        ...overrides,
    };
}

function scheduler() {
    return {
        pending: [],
        cancelled: [],
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
    const picker = {callback: null, chooseFiles(callback) { this.callback = callback; }};
    const gateway = {
        submissions: [], polls: [], cancellations: [], cancelled: 0,
        submit(document, callback) { this.submissions.push({document, callback}); },
        requestResult(document, callback) { this.polls.push({document, callback}); },
        cancelJob(document, callback) { this.cancellations.push({document, callback}); },
        cancel() { this.cancelled += 1; return true; },
    };
    const controller = new Question.DocumentQuestionController({
        picker, gateway, scheduler: timer, clock: {now: () => 1_700_000_000_000},
    });
    return {controller, gateway, picker, timer};
}

test("document question constants and pure request boundaries are exact", () => {
    assert.equal(Question.PROFILE_ID, "ask-selected-files");
    assert.equal(Question.MAX_SOURCES, 16);
    assert.equal(Question.MAX_SOURCE_BYTES, 134_217_728);
    assert.equal(Question.MAX_QUESTION_CHARACTERS, 4096);
    assert.equal(Question.MAX_ANSWER_CHARACTERS, 16384);
    assert.equal(Question.MAX_CITATIONS, 16);
    assert.equal(Question.MAX_POLLS, 600);
    assert.equal(Question.POLL_INTERVAL_MS, 500);
    assert.deepEqual(Question.SOURCE_SUFFIXES, [
        ".jpeg", ".jpg", ".md", ".pdf", ".png", ".txt", ".webp",
    ]);
    const error = new Question.DocumentQuestionError("bad", "detail");
    assert.deepEqual([error.name, error.code, error.detail, error.message], [
        "DocumentQuestionError", "bad", "detail", "bad: detail",
    ]);
    assert.equal(Question.normalizedQuestion("  What changed?  "), "What changed?");
    assert.deepEqual(Question.submission("request-1", [source()], "What changed?"), {
        version: 1,
        requestId: "request-1",
        workloadId: "ask-selected-files",
        payload: {sources: [source().path], question: "What changed?"},
    });
});

test("selection admits every supported suffix and refuses unsafe or excessive files", () => {
    for (const suffix of Question.SOURCE_SUFFIXES) {
        assert.equal(Question.supportedSource(source({
            path: `/private/file${suffix.toUpperCase()}`,
            name: `file${suffix}`,
        })), true);
    }
    const maximum = Array.from({length: Question.MAX_SOURCES}, (_item, index) => source({
        path: `/private/${index}.txt`, name: `${index}.txt`, size: index + 1,
    }));
    assert.equal(Question.selectedSources(maximum).length, Question.MAX_SOURCES);
    assert.equal(Question.selectedSources([source({
        path: `/${"p".repeat(4090)}.txt`, name: "n".repeat(251) + ".txt",
        size: Question.MAX_SOURCE_BYTES,
    })]).length, 1);
    const excessive = Array.from({length: Question.MAX_SOURCES + 1}, (_item, index) => source({
        path: `/private/excess-${index}.txt`, name: `excess-${index}.txt`,
    }));
    for (const invalid of [
        null, [], excessive,
        [source({path: "relative.txt"})], [source({name: ".hidden.txt"})],
        [source({regular: false})], [source({symlink: true})], [source({size: 0})],
        [source({size: Question.MAX_SOURCE_BYTES + 1})], [source({path: "/a/file.ics"})],
        [source(), source()], [source(), source({path: "/bad/file.ics", name: "file.ics"})],
    ]) {
        assert.throws(() => Question.selectedSources(invalid), Question.DocumentQuestionError);
    }
    for (const invalid of ["", "   ", "x".repeat(Question.MAX_QUESTION_CHARACTERS + 1), null]) {
        assert.throws(() => Question.normalizedQuestion(invalid), /question-invalid/u);
    }
    assert.equal(Question.normalizedQuestion("x"), "x");
    assert.equal(Question.normalizedQuestion("x".repeat(Question.MAX_QUESTION_CHARACTERS)).length, 4096);
});

test("public answers require exact bounded unique citations and clone nested state", () => {
    const parsed = Question.groundedAnswer(answer(), "job-1");
    assert.deepEqual(parsed, answer());
    assert.equal(Object.isFrozen(parsed), true);
    assert.equal(Object.isFrozen(parsed.citations[0].span), true);
    const faults = [
        answer({version: 2}), answer({requestId: "other"}), answer({answer: ""}),
        answer({providerId: "Bad Provider"}), answer({accelerator: "cpu"}),
        answer({citations: []}), answer({extra: true}),
        answer({citations: [citation({fileId: "private:1"})]}),
        answer({citations: [citation({fileName: "dir/file.pdf"})]}),
        answer({citations: [citation({sourceSha256: "A".repeat(64)})]}),
        answer({citations: [citation({page: 0})]}),
        answer({citations: [citation({span: {start: 10, end: 10}})]}),
        answer({citations: [citation({textSha256: "bad"})]}),
        answer({citations: [citation(), citation()]}),
        answer({requestId: `bad!job-1`}), answer({requestId: `job-1!`}),
        answer({providerId: "qwen3-gpu!"}), answer({providerId: "!qwen3-gpu"}),
        answer({citations: [citation({fileId: "xselected-file-1"})]}),
        answer({citations: [citation({fileId: "selected-file-1x"})]}),
        answer({citations: [citation({fileId: "selected-file-a"})]}),
        answer({citations: [citation({sourceSha256: `x${A}`})]}),
        answer({citations: [citation({textSha256: `${B}x`})]}),
    ];
    for (const fault of faults) {
        assert.throws(() => Question.groundedAnswer(fault, "job-1"), /result-invalid/u);
    }
    assert.equal(Question.validSpan({start: 0, end: 5_000_000}), true);
    for (const invalid of [
        null, [], {start: 0}, {start: 0, end: 1, extra: true},
        {start: 0.5, end: 1}, {start: 0, end: 1.5}, {start: -1, end: 1},
        {start: 0, end: 5_000_001},
    ]) {
        assert.equal(Question.validSpan(invalid), false);
    }
    assert.equal(Question.validCitation(citation()), true);
    assert.equal(Question.validCitation(null), false);
    assert.equal(Question.validCitation(citation({page: 2000})), true);
    assert.equal(Question.validCitation(citation({page: 2001})), false);
    assert.equal(Question.validCitationLocation(null), false);
    assert.equal(Question.validCitationLocation(citation({page: 1})), true);
    assert.equal(Question.exactRecord(() => {}, new Set()), false);
    assert.equal(Question.exactRecord({start: 0, wrong: 1}, new Set(["start", "end"])), false);
    const maximumCitations = Array.from({length: Question.MAX_CITATIONS}, (_item, index) => (
        citation({fileId: `selected-file-${index + 1}`, page: index + 1})
    ));
    assert.equal(Question.validAnswerCitations({citations: maximumCitations}), true);
    assert.equal(Question.validAnswerCitations({citations: [...maximumCitations, citation()]}), false);
    assert.equal(Question.validAnswerCitations({citations: [citation(), citation({page: 0})]}), false);
    const twoGrounded = Question.groundedAnswer(answer({citations: [
        citation(),
        citation({fileId: "selected-file-2", page: 4}),
    ]}), "job-1");
    assert.equal(twoGrounded.citations.length, 2);
});

test("request and port validation rejects partial or malformed contracts exactly", () => {
    assert.equal(Question.sourceIdentity(null), false);
    assert.throws(() => Question.submission("bad!request", [source()], "Question"), /request-invalid/u);
    const picker = {chooseFiles() {}};
    const gateway = {submit() {}, requestResult() {}, cancelJob() {}, cancel() {}};
    const schedulerPort = {schedule() {}, cancel() {}};
    assert.throws(() => new Question.DocumentQuestionController({
        picker: {}, gateway, scheduler: schedulerPort, clock: Date,
    }), /picker/u);
    assert.throws(() => new Question.DocumentQuestionController({
        picker, gateway: {...gateway, cancelJob: null}, scheduler: schedulerPort, clock: Date,
    }), /gateway/u);
    assert.throws(() => new Question.DocumentQuestionController({
        picker, gateway, scheduler: {schedule() {}}, clock: Date,
    }), /scheduler/u);
});

test("controller selects, submits, polls, validates, and clears one explicit question", () => {
    const {controller, gateway, picker, timer} = harness();
    const observed = [];
    const unsubscribe = controller.subscribe((state) => observed.push(state.phase));
    assert.deepEqual(controller.state(), Question.initialState());
    assert.equal(controller.setAvailability(true), true);
    assert.equal(controller.setAvailability(true), false);
    assert.equal(controller.chooseFiles(), true);
    picker.callback(null, [source()]);
    assert.equal(controller.state().phase, "selected");
    assert.equal(controller.start("What changed?"), true);
    assert.equal(gateway.submissions[0].document.payload.question, "What changed?");
    assert.equal(controller.state().question, undefined, "question is not retained in public state");
    gateway.submissions[0].callback(null, {
        requestId: gateway.submissions[0].document.requestId,
        jobId: "job-1",
        status: "accepted",
        code: "accepted",
        message: "queued",
    });
    assert.equal(timer.pending[0].delay, Question.POLL_INTERVAL_MS);
    timer.run();
    gateway.polls[0].callback(null, {
        requestId: gateway.polls[0].document.requestId,
        jobId: "job-1",
        state: "running",
        code: "running",
        message: "retrieving",
        progress: {fraction: 0.5, detail: "retrieve"},
        output: null,
    });
    timer.run();
    gateway.polls[1].callback(null, {
        requestId: gateway.polls[1].document.requestId,
        jobId: "job-1",
        state: "succeeded",
        code: "succeeded",
        message: "done",
        progress: {fraction: 1, detail: "done"},
        output: answer(),
    });
    assert.deepEqual(controller.state().citations, [citation()]);
    assert.equal(controller.state().answer, answer().answer);
    const clone = controller.state();
    clone.citations[0].span.start = 99;
    clone.sources[0].name = "changed";
    clone.progress.fraction = 0;
    assert.deepEqual(controller.state().citations, [citation()]);
    assert.equal(controller.state().sources[0].name, "guide.pdf");
    assert.deepEqual(controller.state().progress, {fraction: 1, detail: "Answer ready"});
    assert.equal(controller.reset(), true);
    assert.deepEqual(controller.state().sources, []);
    assert.equal(controller.state().available, true);
    assert.equal(unsubscribe(), true);
    assert.ok(observed.includes("complete"));
    assert.equal(controller.dispose(), true);
    assert.equal(controller.dispose(), false);
    assert.equal(gateway.cancelled, 1);
    assert.throws(() => controller.chooseFiles(), /disposed/u);
});

test("controller fails closed, retries transport polling, and cancels accepted work", () => {
    const {controller, gateway, picker, timer} = harness();
    controller.setAvailability(true, "ready");
    controller.chooseFiles();
    picker.callback(null, [source()]);
    assert.equal(controller.start("   "), false);
    assert.equal(controller.state().phase, "selected");
    assert.equal(controller.start("Question"), true);
    gateway.submissions[0].callback(null, {
        requestId: gateway.submissions[0].document.requestId,
        jobId: "job-1", status: "accepted", code: "accepted", message: "queued",
    });
    timer.run();
    gateway.polls[0].callback(new Error("transient"), null);
    assert.equal(timer.pending.length, 1);
    timer.run();
    gateway.polls[1].callback(null, {
        requestId: gateway.polls[1].document.requestId,
        jobId: "job-1", state: "succeeded", code: "succeeded", message: "done",
        progress: null, output: answer({requestId: "wrong"}),
    });
    assert.equal(controller.state().phase, "error");
    assert.match(controller.state().message, /version 1/u);
    controller.reset();
    controller.chooseFiles();
    picker.callback(null, [source()]);
    controller.start("Question");
    gateway.submissions[1].callback(null, {
        requestId: gateway.submissions[1].document.requestId,
        jobId: "job-2", status: "accepted", code: "accepted", message: "queued",
    });
    assert.equal(controller.cancel(), true);
    assert.match(gateway.cancellations[0].document.requestId, /^xpuwlm-question-cancel-/u);
    gateway.cancellations[0].callback(null);
    assert.equal(controller.state().phase, "selected");
    assert.equal(controller.cancel(), false);
});

test("constructor, selection, acknowledgement, and terminal error branches are bounded", () => {
    const {controller, gateway, picker} = harness();
    assert.throws(() => new Question.DocumentQuestionController({}), /picker/u);
    assert.throws(() => new Question.DocumentQuestionController({
        picker: {chooseFiles() {}}, gateway: {}, scheduler: {}, clock: Date,
    }), /gateway/u);
    assert.throws(() => new Question.DocumentQuestionController({
        picker: {chooseFiles() {}},
        gateway: {submit() {}, requestResult() {}, cancelJob() {}, cancel() {}},
        scheduler: {schedule() {}, cancel() {}}, clock: {},
    }), /clock/u);
    assert.throws(() => controller.subscribe(null), /listener/u);
    assert.equal(controller.chooseFiles(), false);
    controller.setAvailability(true, "x".repeat(241));
    assert.equal(controller.state().availabilityDetail, "");
    controller.chooseFiles();
    picker.callback(null, []);
    assert.equal(controller.state().phase, "idle");
    controller.chooseFiles();
    picker.callback(new Error("picker failed"), null);
    assert.equal(controller.state().phase, "error");
    controller.reset();
    controller.chooseFiles();
    picker.callback(null, [source()]);
    controller.start("Question");
    gateway.submissions[0].callback(null, {status: "rejected", message: "no worker"});
    assert.equal(controller.state().message, "no worker");
});

test("controller internals enforce exact sequencing, polling, and cleanup contracts", () => {
    const {controller, gateway, picker, timer} = harness();
    controller.setAvailability(true);
    assert.equal(controller._current(0), true);
    assert.equal(controller._current(1), false);
    assert.equal(controller._nextSequence(), 1);
    assert.equal(controller._current(1), true);

    assert.equal(controller._clearPoll(), false);
    const handle = {id: 9};
    controller._pollHandle = handle;
    assert.equal(controller._clearPoll(), true);
    assert.deepEqual(timer.cancelled, [handle]);
    assert.equal(controller._pollHandle, null);

    controller._state.phase = "running";
    controller._state.jobId = "job-1";
    assert.equal(controller._poll(0), false, "stale sequence cannot poll");
    controller._polls = Question.MAX_POLLS;
    assert.equal(controller._poll(1), false);
    assert.equal(controller.state().phase, "error");
    assert.equal(controller.state().message, "Runtime did not report a document answer");

    controller._state.phase = "running";
    controller._polls = 0;
    assert.equal(controller._poll(1), true);
    assert.deepEqual(gateway.polls[0].document, {
        requestId: "xpuwlm-question-poll-1700000000000-1", jobId: "job-1",
    });
    assert.equal(controller._polls, 1);

    assert.equal(controller._result(0, null, {}), false);
    controller._state.phase = "selected";
    assert.equal(controller._result(1, null, {}), false);
    controller._state.phase = "running";
    assert.equal(controller._result(1, new Error("temporary"), null), false);
    assert.equal(timer.pending.length, 1);
    controller._clearPoll();

    assert.equal(controller._terminalResult({state: "failed", message: "worker failed"}), false);
    assert.equal(controller.state().message, "worker failed");
    assert.equal(controller._terminalResult({state: "cancelled", message: ""}), false);
    assert.equal(controller.state().message, "Document question cancelled");
    controller._state.phase = "running";
    assert.equal(controller._terminalResult({
        state: "succeeded", jobId: "job-1", output: answer({requestId: "wrong"}),
    }), false);
    assert.match(controller.state().message, /version 1/u);
    assert.equal(controller._fail(null), false);
    assert.equal(controller.state().message, "Document question failed");

    controller._state.phase = "running";
    assert.equal(controller.reset(), false);
    controller._state.phase = "idle";
    assert.equal(controller.reset(), true);
    assert.equal(controller._sequence, 1);
    picker.callback = null;
});

test("late selection, acknowledgement, cancellation, and result callbacks are ignored exactly", () => {
    const {controller, gateway, picker} = harness();
    controller.setAvailability(true);
    controller.chooseFiles();
    assert.equal(controller._selected(controller._sequence - 1, null, [source()]), false);
    assert.equal(controller.state().phase, "selecting");
    picker.callback(null, [source()]);
    controller.start("Question");
    const current = controller._sequence;
    assert.equal(controller._accepted(current - 1, null, {}), false);
    assert.equal(controller._accepted(current, new Error("offline"), null), false);
    assert.equal(controller.state().message, "Error: offline");

    controller._state.phase = "selected";
    controller.start("Question");
    const second = controller._sequence;
    assert.equal(controller._accepted(second, null, null), false);
    assert.equal(controller.state().message, "Runtime rejected document question");
    controller._state.phase = "selected";
    controller.start("Question");
    const third = controller._sequence;
    assert.equal(controller._accepted(third, null, {status: "accepted", jobId: ""}), false);

    controller._state.phase = "running";
    controller._state.jobId = "job-1";
    assert.equal(controller.cancel(), true);
    const cancelSequence = controller._sequence;
    assert.equal(controller._cancelled(cancelSequence - 1, null), false);
    assert.equal(controller._cancelled(cancelSequence, new Error("cannot cancel")), false);
    assert.equal(controller.state().message, "Error: cannot cancel");
    controller._state.phase = "cancelling";
    assert.equal(controller._cancelled(cancelSequence, null), true);
    assert.equal(controller.state().phase, "selected");
    assert.equal(gateway.cancellations.length, 1);
});

test("controller transition guards preserve exact state and transport effects", () => {
    const {controller, gateway, picker, timer} = harness();
    assert.equal(controller.start("Question"), false);
    assert.equal(controller.state().phase, "idle");
    controller.setAvailability(true, "");
    assert.equal(controller.setAvailability(true, "changed"), true);
    assert.equal(controller.state().availabilityDetail, "changed");
    assert.equal(controller.setAvailability(false, "changed"), true);
    assert.equal(controller.state().available, false);
    controller.setAvailability(true, "ready");

    for (const phase of ["selecting", "submitting", "running", "cancelling"]) {
        controller._state.phase = phase;
        assert.equal(controller.chooseFiles(), false, phase);
    }
    controller._state.phase = "complete";
    controller._state.citations = [citation()];
    assert.equal(controller.chooseFiles(), true);
    assert.equal(controller.state().phase, "selecting");
    assert.deepEqual(controller.state().citations, []);
    assert.equal(controller._selected(controller._sequence, null, []), true);
    assert.equal(controller.state().message, "Selection cancelled");

    controller.chooseFiles();
    assert.equal(controller._selected(controller._sequence, new Error("picker exact"), null), false);
    assert.equal(controller.state().message, "Error: picker exact");
    controller.reset();
    controller.chooseFiles();
    assert.equal(controller._selected(controller._sequence, null, [source({name: ".bad.txt"})]), false);
    assert.equal(controller.state().message, "choose supported non-empty regular files");

    controller.reset();
    controller.chooseFiles();
    picker.callback(null, [source()]);
    assert.equal(controller.start(" "), false);
    assert.equal(controller.state().phase, "selected");
    assert.equal(controller.state().message, "question must contain 1-4096 characters");
    assert.equal(controller.start("Question"), true);
    assert.equal(controller.state().phase, "submitting");
    const beforeStale = controller.state();
    assert.equal(controller._accepted(controller._sequence - 1, null, {
        status: "accepted", jobId: "wrong", message: "wrong",
    }), false);
    assert.deepEqual(controller.state(), beforeStale);
    assert.equal(controller._accepted(controller._sequence, null, {
        status: "rejected", jobId: "job-rejected", message: "rejected exactly",
    }), false);
    assert.equal(controller.state().message, "rejected exactly");

    controller._state.phase = "selected";
    controller.start("Question");
    assert.equal(controller._accepted(controller._sequence, null, {
        status: "accepted", jobId: "job-1", message: "queued",
    }), true);
    assert.deepEqual(controller.state().progress, {fraction: 0, detail: "Queued"});
    const running = controller.state();
    assert.equal(controller._result(controller._sequence - 1, null, {
        state: "succeeded", jobId: "job-1", output: answer(),
    }), false);
    assert.deepEqual(controller.state(), running);

    controller._state.phase = "selected";
    assert.equal(controller._poll(controller._sequence), false);
    controller._state.phase = "running";
    controller._polls = Question.MAX_POLLS - 1;
    assert.equal(controller._poll(controller._sequence), true);
    assert.equal(controller._polls, Question.MAX_POLLS);
    assert.equal(gateway.polls.length, 1);
    const preserved = {fraction: 0.25, detail: "old"};
    controller._state.progress = preserved;
    assert.equal(controller._result(controller._sequence, null, {
        state: "running", progress: null, message: "still running",
    }), true);
    assert.deepEqual(controller.state().progress, preserved);
    assert.equal(controller.state().message, "still running");
    timer.pending = [];
    assert.equal(controller._result(controller._sequence, null, {
        state: "running", progress: {fraction: 0.75, detail: "new"}, message: "new progress",
    }), true);
    assert.deepEqual(controller.state().progress, {fraction: 0.75, detail: "new"});

    assert.equal(controller._terminalResult({
        state: "succeeded", jobId: "job-1", output: answer(),
    }), true);
    assert.deepEqual(controller.state().progress, {fraction: 1, detail: "Answer ready"});
    assert.equal(controller.state().message, "Answer grounded in selected documents");
});

test("synchronous picker, gateway, poll, and cancellation failures stay bounded", () => {
    const {controller, gateway, picker, timer} = harness();
    controller.setAvailability(true);
    picker.chooseFiles = () => { throw new Error("picker threw"); };
    assert.equal(controller.chooseFiles(), true);
    assert.equal(controller.state().message, "Error: picker threw");

    controller.reset();
    picker.chooseFiles = (callback) => { picker.callback = callback; };
    controller.chooseFiles();
    picker.callback(null, [source()]);
    gateway.submit = () => { throw new Error("submit threw"); };
    assert.equal(controller.start("Question"), true);
    assert.equal(controller.state().message, "Error: submit threw");

    controller._state.phase = "running";
    controller._state.jobId = "job-1";
    gateway.requestResult = () => { throw new Error("poll threw"); };
    assert.equal(controller._poll(controller._sequence), true);
    assert.equal(timer.pending.length, 1);

    controller._state.phase = "submitting";
    controller._state.jobId = "";
    const cancelledBefore = gateway.cancelled;
    assert.equal(controller.cancel(), true);
    assert.equal(gateway.cancelled, cancelledBefore + 1);
    assert.equal(controller.state().phase, "selected");

    controller._state.phase = "running";
    controller._state.jobId = "job-2";
    gateway.cancelJob = () => { throw new Error("cancel threw"); };
    assert.equal(controller.cancel(), true);
    assert.equal(controller.state().message, "Error: cancel threw");
});
