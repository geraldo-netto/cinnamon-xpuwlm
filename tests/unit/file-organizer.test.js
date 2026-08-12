"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const Organizer = require("../../files/cinnamon-xpuwlm@geraldo-netto/lib/file-organizer.js");

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

function evidence(overrides = {}) {
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

function item(overrides = {}) {
    return {
        fileId: "selected-file-1",
        fileName: "guide.pdf",
        sourceSha256: A,
        tags: ["project-notes"],
        proposedName: "project-guide.pdf",
        proposedFolder: "Projects/Mars",
        duplicateGroup: null,
        reason: "The selected content is a project guide.",
        evidence: [evidence()],
        ...overrides,
    };
}

function result(overrides = {}) {
    return {
        version: 1,
        requestId: "job-1",
        providerId: "qwen3-gpu",
        accelerator: "gpu",
        plan: [item()],
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
    const controller = new Organizer.FileOrganizerController({
        picker, gateway, scheduler: timer, clock: {now: () => 1_700_000_000_000},
    });
    return {controller, gateway, picker, timer};
}

test("organizer constants, error, and submission are exact and action-free", () => {
    assert.equal(Organizer.PROFILE_ID, "file-organizer");
    assert.equal(Organizer.MAX_PLAN_ITEMS, 16);
    assert.equal(Organizer.MAX_TAGS, 16);
    assert.equal(Organizer.MAX_EVIDENCE, 8);
    assert.equal(Organizer.MAX_POLLS, 600);
    assert.equal(Organizer.POLL_INTERVAL_MS, 500);
    const error = new Organizer.FileOrganizerError("bad", "detail");
    assert.deepEqual([error.name, error.code, error.detail, error.message], [
        "FileOrganizerError", "bad", "detail", "bad: detail",
    ]);
    assert.deepEqual(Organizer.submission("request-1", [source()]), {
        version: 1,
        requestId: "request-1",
        workloadId: "file-organizer",
        payload: {sources: [source().path]},
    });
    assert.throws(() => Organizer.submission("bad!request", [source()]), /request-invalid/u);
    const sourceText = require("node:fs").readFileSync(
        require("node:path").join(
            __dirname, "../../files/cinnamon-xpuwlm@geraldo-netto/lib/file-organizer.js",
        ),
        "utf8",
    );
    for (const forbidden of ["rename(", "unlink(", "move(", "subprocess", "exec(", "spawn("]) {
        assert.equal(sourceText.includes(forbidden), false, forbidden);
    }
});

test("safe names and folders enforce exact review-plan boundaries", () => {
    for (const value of [null, "a", "a b.pdf", "Report.PDF", "a".repeat(255)]) {
        assert.equal(Organizer.safeName(value), true, String(value));
    }
    for (const value of [
        undefined, "", ".hidden", "../x", "a/b", "a\\b", "a\nb", `a${String.fromCodePoint(127)}b`,
        "a".repeat(256),
    ]) {
        assert.equal(Organizer.safeName(value), false, String(value));
    }
    for (const value of [null, "a", "Projects/2026", `${"a".repeat(119)}/${"b".repeat(120)}`]) {
        assert.equal(Organizer.safeFolder(value), true, String(value));
    }
    for (const value of [
        undefined, "", "/root", "\\root", "~user/x", "a\\b", "a//b", "a/./b",
        "a/../b", "a\nb", "a".repeat(241), `a/${"b".repeat(121)}`,
    ]) {
        assert.equal(Organizer.safeFolder(value), false, String(value));
    }
});

test("public plan parser accepts exact evidence and deeply freezes it", () => {
    const parsed = Organizer.organizationPlan(result(), "job-1", [source()]);
    assert.deepEqual(parsed, result());
    assert.equal(Object.isFrozen(parsed), true);
    assert.equal(Object.isFrozen(parsed.plan), true);
    assert.equal(Object.isFrozen(parsed.plan[0]), true);
    assert.equal(Object.isFrozen(parsed.plan[0].tags), true);
    assert.equal(Object.isFrozen(parsed.plan[0].evidence[0].span), true);
    assert.equal(Organizer.validResultIdentity(result(), "job-1"), true);
    assert.equal(Organizer.validPlan(result()), true);
    assert.equal(Organizer.validPlanItem(item(), 0), true);
    assert.equal(Organizer.validEvidence(evidence(), item()), true);
    assert.equal(Organizer.validSpan({start: 0, end: 5_000_000}), true);
    assert.equal(Organizer.exactRecord(() => {}, new Set()), false);
    assert.equal(Organizer.exactRecord({a: 1, c: 2}, new Set(["a", "b"])), false);
});

test("public plan parser verifies exact duplicate groups and preserves file suffixes", () => {
    const first = item({
        sourceSha256: "a".repeat(64), duplicateGroup: "duplicate-group-1",
    });
    const second = item({
        fileId: "selected-file-2", fileName: "copy.pdf",
        sourceSha256: "a".repeat(64), duplicateGroup: "duplicate-group-1",
        evidence: [evidence({
            fileId: "selected-file-2", fileName: "copy.pdf", sourceSha256: "a".repeat(64),
        })],
    });
    const duplicatePlan = result({plan: [first, second]});
    assert.equal(Organizer.validDuplicateGroups(duplicatePlan.plan), true);
    assert.deepEqual(
        Organizer.organizationPlan(duplicatePlan, "job-1", [source(), source({name: "copy.pdf"})])
            .plan.map((entry) => entry.duplicateGroup),
        ["duplicate-group-1", "duplicate-group-1"],
    );
    for (const plan of [
        [item({duplicateGroup: "duplicate-group-1"})],
        [first, {...second, duplicateGroup: "duplicate-group-2"}],
        [first, {...second, sourceSha256: "b".repeat(64)}],
    ]) {
        assert.throws(() => Organizer.organizationPlan(result({plan}), "job-1"), /result-invalid/u);
    }
    assert.throws(
        () => Organizer.organizationPlan(
            result({plan: [item({proposedName: "project-guide.txt"})]}),
            "job-1",
            [source()],
        ),
        /selection/u,
    );
    const suffixless = item({
        fileName: "README", proposedName: "NOTES",
        evidence: [evidence({fileName: "README"})],
    });
    assert.equal(
        Organizer.organizationPlan(result({plan: [suffixless]}), "job-1", [{name: "README"}])
            .plan[0].proposedName,
        "NOTES",
    );
    const hiddenSource = item({
        fileName: ".profile", proposedName: "PROFILE",
        evidence: [evidence({fileName: ".profile"})],
    });
    assert.equal(
        Organizer.organizationPlan(result({plan: [hiddenSource]}), "job-1", [{name: ".profile"}])
            .plan[0].proposedName,
        "PROFILE",
    );
});

test("public plan parser rejects every identity, metadata, and evidence drift", () => {
    const faults = [
        result({version: 2}), result({requestId: "other"}), result({requestId: "bad!id"}),
        result({requestId: "!job-1"}), result({requestId: "job-1!"}),
        result({providerId: "Bad Provider"}), result({accelerator: "cpu"}), result({extra: true}),
        {...result(), version: undefined, wrong: 1},
        result({plan: []}), result({plan: Array.from({length: 17}, () => item())}),
        result({plan: [item({fileId: "selected-file-2"})]}),
        result({plan: [item({fileId: "xselected-file-1"})]}),
        result({plan: [item({fileId: "selected-file-1x"})]}),
        result({plan: [item({fileName: ""})]}),
        result({plan: [item({fileName: "x".repeat(256)})]}),
        result({plan: [item({fileName: "dir/file.pdf"})]}),
        result({plan: [item({fileName: "dir\\file.pdf"})]}),
        result({plan: [item({sourceSha256: "A".repeat(64)})]}),
        result({plan: [item({sourceSha256: `x${A}`})]}),
        result({plan: [item({sourceSha256: `${A}x`})]}),
        result({plan: [{...item(), unexpected: true}]}),
        result({plan: [item({tags: ["bad tag"]})]}),
        result({plan: [item({tags: ["notes", "notes"]})]}),
        result({plan: [item({tags: Array.from({length: 17}, (_value, index) => `t-${index}`)})]}),
        result({plan: [item({proposedName: "../escape.pdf"})]}),
        result({plan: [item({proposedFolder: "../escape"})]}),
        result({plan: [item({duplicateGroup: "group-1"})]}),
        result({plan: [item({reason: ""})]}),
        result({plan: [item({evidence: []})]}),
        result({plan: [item({evidence: [evidence({fileId: "selected-file-2"})]})]}),
        result({plan: [item({evidence: [evidence({fileName: "other.pdf"})]})]}),
        result({plan: [item({evidence: [evidence({sourceSha256: "c".repeat(64)})]})]}),
        result({plan: [item({evidence: [evidence({page: 0})]})]}),
        result({plan: [item({evidence: [evidence({page: 2001})]})]}),
        result({plan: [item({evidence: [evidence({page: 1.5})]})]}),
        result({plan: [item({evidence: [evidence({span: {start: 10, end: 10}})]})]}),
        result({plan: [item({evidence: [evidence({textSha256: "bad"})]})]}),
        result({plan: [item({evidence: [evidence(), evidence()]})]}),
    ];
    for (const fault of faults) {
        assert.throws(() => Organizer.organizationPlan(fault, "job-1"), /result-invalid/u);
    }
    assert.throws(
        () => Organizer.organizationPlan(result(), "job-1", [source({name: "other.pdf"})]),
        /selection/u,
    );
    assert.throws(() => Organizer.organizationPlan(result(), "job-1", {}), /selection/u);
    for (const invalid of [
        null, [], {start: 0}, {start: 0, end: 1, extra: true},
        {start: 0.5, end: 1}, {start: 0, end: 1.5}, {start: -1, end: 1},
        {start: 0, end: 5_000_001},
    ]) {
        assert.equal(Organizer.validSpan(invalid), false);
    }
    for (const page of [1, 2000]) {
        assert.equal(Organizer.validEvidenceLocation(evidence({page})), true);
    }
    const tags = Array.from({length: Organizer.MAX_TAGS}, (_value, index) => `tag-${index}`);
    assert.equal(Organizer.validTags(item({tags})), true);
    const manyEvidence = Array.from({length: Organizer.MAX_EVIDENCE}, (_value, index) => evidence({
        page: index + 1,
        span: {start: index, end: index + 1},
        textSha256: index.toString(16).padStart(64, "0"),
    }));
    assert.equal(Organizer.validPlanItemEvidence(item({evidence: manyEvidence})), true);
    assert.equal(Organizer.validPlanItem(item({evidence: manyEvidence}), 0), true);
    assert.equal(Organizer.validPlanItemEvidence(item({
        evidence: [...manyEvidence, evidence({page: 9})],
    })), false);
    assert.equal(Organizer.validPlanItemEvidence(item({
        evidence: [evidence(), evidence({page: 0})],
    })), false);
    const maximumPlan = Array.from({length: Organizer.MAX_PLAN_ITEMS}, (_value, index) => {
        const digest = (index + 1).toString(16).padStart(64, "0");
        const fileName = `file-${index + 1}.pdf`;
        return item({
            fileId: `selected-file-${index + 1}`, fileName, sourceSha256: digest,
            evidence: [evidence({
                fileId: `selected-file-${index + 1}`, fileName, sourceSha256: digest,
            })],
        });
    });
    assert.equal(Organizer.validPlan(result({plan: maximumPlan})), true);
});

test("controller selects, submits, polls, validates, clones, and clears a plan", () => {
    const {controller, gateway, picker, timer} = harness();
    const observed = [];
    const unsubscribe = controller.subscribe((state) => observed.push(state.phase));
    assert.deepEqual(controller.state(), Organizer.initialState());
    assert.equal(controller.setAvailability(true), true);
    assert.equal(controller.setAvailability(true), false);
    assert.equal(controller.chooseFiles(), true);
    picker.callback(null, [source()]);
    assert.equal(controller.state().phase, "selected");
    assert.equal(controller.start(), true);
    assert.deepEqual(gateway.submissions[0].document.payload, {sources: [source().path]});
    gateway.submissions[0].callback(null, {
        requestId: gateway.submissions[0].document.requestId,
        jobId: "job-1", status: "accepted", code: "accepted", message: "queued",
    });
    assert.equal(timer.pending[0].delay, Organizer.POLL_INTERVAL_MS);
    timer.run();
    gateway.polls[0].callback(null, {
        requestId: gateway.polls[0].document.requestId,
        jobId: "job-1", state: "running", code: "running", message: "suggesting",
        progress: {fraction: 0.5, detail: "model"}, output: null,
    });
    timer.run();
    gateway.polls[1].callback(null, {
        requestId: gateway.polls[1].document.requestId,
        jobId: "job-1", state: "succeeded", code: "succeeded", message: "done",
        progress: {fraction: 1, detail: "done"}, output: result(),
    });
    assert.equal(controller.state().phase, "complete");
    assert.equal(controller.state().message, "Review-only plan ready; no files changed");
    assert.deepEqual(controller.state().plan, [item()]);
    const clone = controller.state();
    clone.plan[0].tags[0] = "changed";
    clone.plan[0].evidence[0].span.start = 99;
    clone.sources[0].name = "changed";
    clone.progress.fraction = 0;
    assert.deepEqual(controller.state().plan, [item()]);
    assert.equal(controller.state().sources[0].name, "guide.pdf");
    assert.deepEqual(controller.state().progress, {fraction: 1, detail: "Plan ready"});
    assert.equal(controller.reset(), true);
    assert.equal(controller.state().available, true);
    assert.deepEqual(controller.state().sources, []);
    assert.equal(unsubscribe(), true);
    assert.ok(observed.includes("complete"));
    assert.equal(controller.dispose(), true);
    assert.equal(controller.dispose(), false);
    assert.equal(gateway.cancelled, 1);
    assert.throws(() => controller.chooseFiles(), /disposed/u);
});

test("controller handles cancelled selection, parser refusal, retries, and accepted cancellation", () => {
    const {controller, gateway, picker, timer} = harness();
    controller.setAvailability(true, "ready");
    controller.chooseFiles();
    picker.callback(null, []);
    assert.equal(controller.state().message, "Selection cancelled");
    controller.chooseFiles();
    picker.callback(null, [source()]);
    controller.start();
    gateway.submissions[0].callback(null, {
        jobId: "job-1", status: "accepted", message: "queued",
    });
    timer.run();
    gateway.polls[0].callback(new Error("transient"), null);
    timer.run();
    gateway.polls[1].callback(null, {
        jobId: "job-1", state: "succeeded", output: result({requestId: "wrong"}),
    });
    assert.equal(controller.state().phase, "error");
    controller.reset();
    controller.chooseFiles();
    picker.callback(null, [source()]);
    controller.start();
    gateway.submissions[1].callback(null, {
        jobId: "job-2", status: "accepted", message: "queued",
    });
    assert.equal(controller.cancel(), true);
    assert.match(gateway.cancellations[0].document.requestId, /^xpuwlm-file-organizer-cancel-/u);
    gateway.cancellations[0].callback(null);
    assert.equal(controller.state().phase, "selected");
    assert.equal(controller.state().message, "File organization cancelled; no files changed");
    assert.equal(controller.cancel(), false);
});

test("controller validates ports, bounded availability, stale callbacks, and terminal branches", () => {
    const {controller, gateway, picker, timer} = harness();
    assert.throws(() => new Organizer.FileOrganizerController({}), /picker/u);
    assert.throws(() => new Organizer.FileOrganizerController({
        picker: {chooseFiles() {}}, gateway: {}, scheduler: {}, clock: Date,
    }), /gateway/u);
    assert.throws(() => new Organizer.FileOrganizerController({
        picker: {chooseFiles() {}},
        gateway: {submit() {}, requestResult() {}, cancelJob() {}, cancel() {}},
        scheduler: {schedule() {}, cancel() {}}, clock: {},
    }), /clock/u);
    assert.throws(() => controller.subscribe(null), /listener/u);
    assert.equal(controller.start(), false);
    assert.equal(controller.chooseFiles(), false);
    controller.setAvailability(true, "x".repeat(241));
    assert.equal(controller.start(), false);
    controller._state.phase = "selected";
    controller._state.sources = [];
    assert.equal(controller.start(), false);
    assert.equal(controller.state().phase, "selected");
    assert.equal(controller.state().message, "choose 1-16 document files");
    assert.equal(gateway.submissions.length, 0);
    controller._state.available = false;
    controller._state.sources = [source()];
    assert.equal(controller.start(), false);
    assert.equal(gateway.submissions.length, 0);
    assert.equal(controller.state().availabilityDetail, "");
    controller.setAvailability(true);
    controller.chooseFiles();
    assert.equal(controller._selected(controller._sequence - 1, null, [source()]), false);
    picker.callback(new Error("picker failed"), null);
    assert.equal(controller.state().message, "Error: picker failed");
    controller.reset();
    controller.chooseFiles();
    picker.callback(null, [source({name: ".hidden.pdf"})]);
    assert.equal(controller.state().phase, "error");
    controller.reset();
    controller.chooseFiles();
    picker.callback(null, [source()]);
    controller.start();
    assert.equal(controller._accepted(controller._sequence - 1, null, {}), false);
    assert.equal(controller._cancelled(controller._sequence - 1, null), false);
    assert.equal(controller._accepted(controller._sequence, new Error("offline"), null), false);
    assert.equal(controller.state().message, "Error: offline");
    controller._state.phase = "selected";
    controller.start();
    assert.equal(controller._accepted(controller._sequence, null, null), false);
    assert.equal(controller.state().message, "Runtime rejected file organization");

    controller._state.phase = "running";
    controller._state.jobId = "job-1";
    assert.equal(controller._poll(controller._sequence - 1), false);
    controller._polls = Organizer.MAX_POLLS;
    assert.equal(controller._poll(controller._sequence), false);
    assert.equal(controller.state().message, "Runtime did not report a file organization plan");
    controller._state.phase = "running";
    assert.equal(controller._result(controller._sequence - 1, null, {}), false);
    assert.equal(controller._terminalResult({state: "failed", message: "worker failed"}), false);
    assert.equal(controller.state().message, "worker failed");
    assert.equal(controller._terminalResult({state: "cancelled", message: ""}), false);
    assert.equal(controller.state().message, "File organization cancelled");
    assert.equal(controller._fail(null), false);
    assert.equal(controller.state().message, "File organization failed");
    controller._state.phase = "running";
    assert.equal(controller.reset(), false);
    assert.equal(controller._clearPoll(), false);
    controller._pollHandle = {id: 1};
    assert.equal(controller._clearPoll(), true);
    assert.deepEqual(timer.cancelled, [{id: 1}]);
    assert.equal(gateway.polls.length, 0);

    const sequence = harness().controller;
    assert.equal(sequence._nextSequence(), 1);
    assert.equal(sequence._nextSequence(), 2);
});

test("controller reports exact submission, polling, and terminal transitions", () => {
    const {controller, gateway, timer} = harness();
    controller.setAvailability(true);
    controller._state.phase = "selected";
    controller._state.sources = [source()];
    assert.equal(controller.start(), true);
    assert.deepEqual(controller.state(), {
        ...Organizer.initialState(),
        available: true,
        availabilityDetail: "",
        phase: "submitting",
        sources: [source()],
        message: "Submitting selected files…",
    });
    gateway.submissions[0].callback(null, {jobId: "job-1", status: "accepted", message: "queued"});
    assert.equal(controller._accepted(controller._sequence - 1, null, {}), false);
    timer.run();
    const priorProgress = controller.state().progress;
    assert.equal(controller._result(controller._sequence, new Error("retry"), null), false);
    assert.equal(timer.pending.length, 1);
    timer.run();
    assert.equal(controller._result(controller._sequence, null, {
        state: "running", progress: null, message: "still running",
    }), true);
    assert.deepEqual(controller.state().progress, priorProgress);
    assert.equal(controller.state().message, "still running");
    assert.equal(controller._result(controller._sequence, null, {
        state: "running", progress: {fraction: 0.75, detail: "model"}, message: "model",
    }), true);
    assert.deepEqual(controller.state().progress, {fraction: 0.75, detail: "model"});
    assert.equal(controller._result(controller._sequence, null, {
        state: "succeeded", jobId: "job-1", output: result(),
    }), true);
    assert.equal(controller.state().phase, "complete");
    controller._state.phase = "running";
    assert.equal(controller._result(controller._sequence, null, {
        state: "succeeded", jobId: "job-1", output: result({requestId: "wrong"}),
    }), false);
    assert.equal(controller.state().message, "file organization plan does not match version 1");
});

test("synchronous port failures and cancellation before acknowledgement remain contained", () => {
    const timer = scheduler();
    const gateway = {
        cancelCount: 0,
        submit() { throw new Error("submit failed"); },
        requestResult() { throw new Error("poll failed"); },
        cancelJob() { throw new Error("cancel failed"); },
        cancel() { this.cancelCount += 1; },
    };
    const picker = {chooseFiles() { throw new Error("pick failed"); }};
    const controller = new Organizer.FileOrganizerController({
        picker, gateway, scheduler: timer, clock: {now: () => 1},
    });
    controller.setAvailability(true);
    assert.equal(controller.chooseFiles(), true);
    assert.equal(controller.state().message, "Error: pick failed");
    controller._state.phase = "selected";
    controller._state.sources = [source()];
    assert.equal(controller.start(), true);
    assert.equal(controller.state().message, "Error: submit failed");
    controller._state.phase = "submitting";
    controller._state.jobId = "";
    assert.equal(controller.cancel(), true);
    assert.equal(gateway.cancelCount, 1);
    controller._state.phase = "running";
    controller._state.jobId = "job-1";
    assert.equal(controller.cancel(), true);
    assert.equal(controller.state().message, "Error: cancel failed");
    controller._state.phase = "running";
    controller._polls = 0;
    assert.equal(controller._poll(controller._sequence), true);
    assert.equal(timer.pending.length, 1);
});
