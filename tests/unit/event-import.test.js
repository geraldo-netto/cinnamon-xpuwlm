"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const EventImport = require("../../files/cinnamon-xpuwlm@geraldo-netto/lib/event-import.js");

const DIGEST = "a".repeat(64);
const SECOND_DIGEST = "b".repeat(64);

function source(overrides = {}) {
    return {
        path: "/home/tester/events/agenda.txt",
        name: "agenda.txt",
        size: 120,
        regular: true,
        symlink: false,
        ...overrides,
    };
}

function evidence(overrides = {}) {
    return {
        sourceRef: "private:job-1:source:1:page:1",
        sourceSha256: DIGEST,
        page: 1,
        span: {start: 0, end: 12},
        textSha256: SECOND_DIGEST,
        ...overrides,
    };
}

function candidate(overrides = {}) {
    return {
        candidateId: "event-1",
        title: "Planning session",
        start: "2026-09-01T09:00:00+02:00",
        end: "2026-09-01T10:00:00+02:00",
        timezone: "Europe/Rome",
        location: "Studio",
        confirmation: "pending",
        evidence: [evidence()],
        ...overrides,
    };
}

function result(overrides = {}) {
    return {
        version: 1,
        requestId: "job-1",
        outcome: "succeeded",
        code: "events-extracted",
        detail: "Review candidates",
        duplicatePolicy: "keep-first-title-start-location",
        confirmationState: "pending",
        events: [candidate()],
        ...overrides,
    };
}

function scheduler() {
    return {
        callbacks: [],
        cancelled: [],
        schedule(delay, callback) {
            const handle = {delay, callback};
            this.callbacks.push(handle);
            return handle;
        },
        cancel(handle) {
            this.cancelled.push(handle);
            return true;
        },
        run() {
            const handle = this.callbacks.shift();
            handle.callback();
        },
    };
}

function harness() {
    const timer = scheduler();
    const picker = {
        files: null,
        folder: null,
        chooseFiles(callback) { this.files = callback; },
        chooseFolder(callback) { this.folder = callback; },
    };
    const gateway = {
        submissions: [],
        polls: [],
        cancellations: [],
        cancelled: 0,
        submit(submission, callback) { this.submissions.push({submission, callback}); },
        requestResult(request, callback) { this.polls.push({request, callback}); },
        cancelJob(request, callback) { this.cancellations.push({request, callback}); },
        cancel() { this.cancelled += 1; return true; },
    };
    const exporter = {
        calls: [],
        saveIcs(calendar, forbidden, callback) { this.calls.push({calendar, forbidden, callback}); },
    };
    const controller = new EventImport.EventImportController({
        picker,
        gateway,
        exporter,
        scheduler: timer,
        clock: {now: () => 1700000000000},
    });
    return {controller, exporter, gateway, picker, timer};
}

test("event constants, errors, and initial state pin the bounded local contract", () => {
    assert.equal(EventImport.EVENT_PROFILE_ID, "event-extraction");
    assert.equal(EventImport.MAX_SOURCES, 32);
    assert.equal(EventImport.MAX_SOURCE_BYTES, 134_217_728);
    assert.equal(EventImport.MAX_EVENTS, 64);
    assert.equal(EventImport.MAX_EVIDENCE, 16);
    assert.equal(EventImport.MAX_POLLS, 600);
    assert.equal(EventImport.POLL_INTERVAL_MS, 500);
    assert.equal(EventImport.SOURCE_SUFFIXES.length, 8);
    const error = new EventImport.EventImportError("event-code", "detail");
    assert.equal(error.name, "EventImportError");
    assert.equal(error.code, "event-code");
    assert.equal(error.detail, "detail");
    assert.equal(error.message, "event-code: detail");
    assert.deepEqual(EventImport.initialState(), {
        available: false,
        availabilityDetail: "Event provider is not ready",
        phase: "idle",
        selectionKind: "",
        sources: [],
        jobId: "",
        progress: null,
        message: "",
        candidates: [],
        duplicatesDropped: 0,
        exportedPath: "",
    });
});

test("source selection accepts only bounded explicit regular files", () => {
    assert.deepEqual(EventImport.selectedSources([source()]), [{
        path: "/home/tester/events/agenda.txt", name: "agenda.txt", size: 120,
        regular: true, symlink: false,
    }]);
    assert.equal(EventImport.isSupportedSourceName("A.PDF"), true);
    assert.equal(EventImport.isSupportedSourceName(".secret.txt"), false);
    assert.equal(EventImport.suffixOf("scan.JPEG"), ".jpeg");

    for (const invalid of [
        null,
        [],
        new Array(EventImport.MAX_SOURCES + 1).fill(source()),
        [source({path: "relative.txt"})],
        [source({path: "/tmp/a.exe"})],
        [source({regular: false})],
        [source({symlink: true})],
        [source({size: 0})],
        [source({size: EventImport.MAX_SOURCE_BYTES + 1})],
        [source(), source()],
        [source({path: 1})],
        [source({path: "/tmp/a\0.txt"})],
        [source({name: ""})],
        [source({name: "x".repeat(256)})],
        [source({size: 1.5})],
    ]) {
        assert.throws(() => EventImport.selectedSources(invalid), EventImport.EventImportError);
    }
    const maximum = Array.from({length: EventImport.MAX_SOURCES}, (_item, index) => source({
        path: `/home/tester/events/${index}.txt`,
        name: `${index}.txt`,
        size: index === 0 ? 1 : EventImport.MAX_SOURCE_BYTES,
    }));
    assert.equal(EventImport.selectedSources(maximum).length, EventImport.MAX_SOURCES);
    assert.equal(EventImport.exactRecord({a: 1, c: 2}, new Set(["a", "b"])), false);
});

test("event submission carries paths only in the closed runtime envelope", () => {
    const submission = EventImport.eventSubmission("request-1", [source()]);
    assert.deepEqual(submission, {
        version: 1,
        requestId: "request-1",
        workloadId: "event-extraction",
        payload: {sources: ["/home/tester/events/agenda.txt"]},
    });
    assert.equal(JSON.stringify(submission).includes("Planning session"), false);
    assert.throws(() => EventImport.eventSubmission("bad request", [source()]), /request-invalid/u);
});

test("grounded results validate evidence, identity, and deterministic deduplication", () => {
    const duplicate = candidate({candidateId: "event-2", title: " planning   SESSION "});
    const parsed = EventImport.groundedEventResult(result({events: [candidate(), duplicate]}), "job-1");
    assert.equal(parsed.candidates.length, 1);
    assert.equal(parsed.duplicatesDropped, 1);
    assert.equal(EventImport.sourceLabel(parsed.candidates[0].evidence[0], [source()]), "agenda.txt");
    assert.equal(EventImport.sourceLabel(evidence({sourceRef: "private:job-1:unknown"}), []), "Selected source");

    for (const invalid of [
        result({requestId: "another"}),
        result({extra: true}),
        result({confirmationState: "confirmed"}),
        result({events: [candidate({confirmation: "confirmed"})]}),
        result({events: [candidate({evidence: [evidence({sourceSha256: "bad"})]})]}),
        result({events: [candidate(), candidate()]}),
        result({outcome: "refused", confirmationState: "refused", events: [candidate()]}),
    ]) {
        assert.throws(() => EventImport.groundedEventResult(invalid, "job-1"), /result-invalid/u);
    }
    assert.equal(EventImport.groundedEventResult(result({
        outcome: "refused", code: "nothing-found", confirmationState: "refused", events: [],
    }), "job-1").outcome, "refused");
});

test("grounded evidence rejects every identity, page, span, and digest defect", () => {
    const faults = [
        null,
        {...evidence(), extra: true},
        evidence({sourceRef: "bad"}),
        evidence({sourceRef: `private:${"x".repeat(201)}`}),
        evidence({sourceSha256: "A".repeat(64)}),
        evidence({sourceSha256: `${DIGEST}a`}),
        evidence({page: 0}),
        evidence({page: 2001}),
        evidence({page: 1.5}),
        evidence({span: null}),
        evidence({span: {start: 0, end: 1, extra: true}}),
        evidence({span: {start: -1, end: 1}}),
        evidence({span: {start: 0.5, end: 1}}),
        evidence({span: {start: 1, end: 1}}),
        evidence({span: {start: 2, end: 1}}),
        evidence({span: {start: 0, end: 5_000_001}}),
        evidence({span: {start: 0, end: 1.5}}),
        evidence({textSha256: "bad"}),
    ];
    assert.equal(faults.every((value) => !EventImport.validEvidence(value)), true);
    assert.equal(EventImport.validEvidence(evidence({page: null})), true);
    assert.equal(EventImport.validEvidence(evidence({page: 2000, span: {start: 0, end: 5_000_000}})), true);
});

test("event candidates reject every identity, schedule, and evidence defect", () => {
    const faults = [
        null,
        {...candidate(), extra: true},
        candidate({candidateId: "bad id"}),
        candidate({candidateId: `${"x".repeat(120)}!`}),
        candidate({title: ""}),
        candidate({title: "x".repeat(201)}),
        candidate({start: "not-a-date"}),
        candidate({end: "not-a-date"}),
        candidate({timezone: ""}),
        candidate({timezone: "Rome"}),
        candidate({timezone: "Europe/Rome\r\nX-Test: bad"}),
        candidate({timezone: "x".repeat(65)}),
        candidate({location: ""}),
        candidate({location: "x".repeat(201)}),
        candidate({confirmation: "confirmed"}),
        candidate({evidence: null}),
        candidate({evidence: []}),
        candidate({evidence: new Array(EventImport.MAX_EVIDENCE + 1).fill(evidence())}),
        candidate({evidence: [evidence({page: 0})]}),
    ];
    assert.equal(faults.every((value) => !EventImport.validEvent(value)), true);
    assert.equal(EventImport.validDate(null, true), true);
    assert.equal(EventImport.validDate(null), false);
    assert.equal(EventImport.validDate("2026-09-01T09:00:00.123456Z"), true);
    assert.equal(EventImport.validDate("x2026-09-01T09:00:00Z"), false);
    assert.equal(EventImport.validDate("2026-09-01T09:00:00Zx"), false);
    assert.equal(EventImport.validDate("2026-09-01 09:00:00"), false);
    assert.equal(EventImport.validDate("2026-99-99T09:00:00Z"), false);
    assert.equal(EventImport.validDate("2026-09-01T09:00"), true);
    assert.equal(EventImport.validDate("2026-09-01T09:00:00+02:00"), true);
    assert.equal(EventImport.validDate("2026-09-01T09:00:00.1Z"), true);
    assert.equal(EventImport.isNamedTimezone("UTC"), true);
    assert.equal(EventImport.isNamedTimezone("America/Sao_Paulo"), true);
    assert.equal(EventImport.isNamedTimezone("floating"), false);
});

test("grounded result rejects every report and collection defect", () => {
    const invalid = [
        result({version: 2}),
        result({requestId: "bad id"}),
        result({outcome: "confirmed"}),
        result({code: "Bad"}),
        result({code: "x".repeat(65)}),
        result({detail: 1}),
        result({detail: "x".repeat(501)}),
        result({duplicatePolicy: "keep-last"}),
        result({confirmationState: "mixed"}),
        result({events: null}),
        result({events: new Array(EventImport.MAX_EVENTS + 1).fill(candidate())}),
        result({outcome: "refused", confirmationState: "pending", events: []}),
        result({outcome: "succeeded", confirmationState: "refused", events: []}),
    ];
    assert.equal(invalid.every((value) => {
        try {
            EventImport.groundedEventResult(value, "job-1");
            return false;
        } catch {
            return true;
        }
    }), true);
    assert.equal(EventImport.groundedEventResult(result({outcome: "partial"}), "job-1").outcome, "partial");
    const maximumEvents = Array.from({length: EventImport.MAX_EVENTS}, (_item, index) => candidate({
        candidateId: `event-${index}`,
        title: `Event ${index}`,
    }));
    assert.equal(EventImport.groundedEventResult(result({events: maximumEvents}), "job-1").candidates.length,
        EventImport.MAX_EVENTS);
    const tooManyUnique = [...maximumEvents, candidate({candidateId: "event-overflow", title: "Overflow"})];
    assert.throws(
        () => EventImport.groundedEventResult(result({events: tooManyUnique}), "job-1"),
        (error) => error instanceof EventImport.EventImportError
            && error.detail === "event result does not match version 1",
    );
    assert.throws(
        () => EventImport.groundedEventResult(result({events: {length: 0, every: () => true}}), "job-1"),
        (error) => error instanceof EventImport.EventImportError
            && error.detail === "event result does not match version 1",
    );
});

test("editing preserves evidence, resets decisions, and dedupes again", () => {
    const original = candidate();
    const edited = EventImport.editedCandidate(original, {
        title: "Changed",
        start: "2026-09-02T09:00:00+02:00",
        end: null,
        timezone: "Europe/Rome",
        location: null,
    });
    assert.equal(edited.title, "Changed");
    assert.deepEqual(edited.evidence, original.evidence);
    assert.notEqual(edited.evidence, original.evidence);
    assert.equal(edited.confirmation, "pending");
    assert.throws(() => EventImport.editedCandidate(original, {unknown: "x"}), /edit-invalid/u);
    assert.throws(() => EventImport.editedCandidate(original, {title: ""}), /edit-invalid/u);
    assert.throws(
        () => EventImport.editedCandidate(original, null),
        (error) => error instanceof EventImport.EventImportError && error.code === "edit-invalid",
    );
    assert.throws(
        () => EventImport.editedCandidate(original, {title: "Changed", unknown: "x"}),
        (error) => error instanceof EventImport.EventImportError && error.code === "edit-invalid",
    );

    const second = candidate({candidateId: "event-2"});
    assert.equal(EventImport.dedupeCandidates([original, second]).dropped, 1);
    assert.equal(EventImport.decidedCandidate(original, "confirmed").confirmation, "confirmed");
    assert.throws(() => EventImport.decidedCandidate(original, "maybe"), /decision-invalid/u);
    assert.equal(EventImport.duplicateKey({title: null, start: "", location: null}), '["","",""]');
});

test("ICS export requires every decision, named timezones, and folds UTF-8 lines", () => {
    const kept = EventImport.decidedCandidate(candidate({title: `Meet ${"é".repeat(100)}`}), "confirmed");
    const rejected = EventImport.decidedCandidate(candidate({candidateId: "event-2"}), "rejected");
    const calendar = EventImport.confirmedIcs([kept, rejected]);
    assert.match(calendar, /BEGIN:VCALENDAR\r\n/u);
    assert.match(calendar, /DTSTART:20260901T070000Z/u);
    assert.match(calendar, /SUMMARY:Meet/u);
    assert.equal(calendar.includes("event-2@omnitensor"), false);
    assert.equal(calendar.includes("DTEND:20260901T080000Z\r\n"), true);
    assert.equal(calendar.includes(`LOCATION:Studio\r\n`), true);
    assert.equal(calendar.split("\r\n").every((line) => [...line].reduce(
        (width, character) => width + EventImport.utf8Width(character), 0,
    ) <= 74), true);

    assert.match(EventImport.exportRefusal([]), /No event/u);
    assert.match(EventImport.exportRefusal([candidate()]), /Decide/u);
    assert.match(EventImport.exportRefusal([EventImport.decidedCandidate(candidate(), "rejected")]), /Keep/u);
    assert.match(EventImport.exportRefusal([
        EventImport.decidedCandidate(candidate({timezone: "floating", start: "2026-09-01T09:00"}), "confirmed"),
    ]), /named timezone/u);
    assert.match(EventImport.exportRefusal([
        EventImport.decidedCandidate(candidate(), "confirmed"),
        EventImport.decidedCandidate(candidate({candidateId: "event-2", timezone: "floating"}), "confirmed"),
    ]), /named timezone/u);

    const local = EventImport.decidedCandidate(candidate({
        start: "2026-09-01T09:00",
        end: "2026-09-01T10:00:30.123",
    }), "confirmed");
    const localCalendar = EventImport.confirmedIcs([local]);
    assert.match(localCalendar, /DTSTART;TZID=Europe\/Rome:20260901T090000\r\n/u);
    assert.match(localCalendar, /DTEND;TZID=Europe\/Rome:20260901T100030\r\n/u);
    assert.equal(
        EventImport.icsDateProperty("DTSTART", "2026-09-01T09:00:00Z", "Europe/Rome"),
        "DTSTART:20260901T090000Z",
    );
    assert.throws(
        () => EventImport.icsDateProperty("DTSTART", "invalid", "Europe/Rome"),
        (error) => error instanceof EventImport.EventImportError && error.code === "date-invalid",
    );

    const sparse = EventImport.decidedCandidate(candidate({
        candidateId: "event-sparse",
        title: "A;B,C\\D\nE",
        end: null,
        location: null,
    }), "confirmed");
    const sparseCalendar = EventImport.confirmedIcs([sparse]);
    assert.doesNotMatch(sparseCalendar, /DTEND/u);
    assert.doesNotMatch(sparseCalendar, /LOCATION/u);
    assert.match(sparseCalendar, /SUMMARY:A\\;B\\,C\\\\D\\nE/u);
    assert.deepEqual(
        ["A", "\u007f", "é", "\u07ff", "€", "\uffff", "😀"].map(EventImport.utf8Width),
        [1, 1, 2, 2, 3, 3, 4],
    );
    assert.deepEqual(EventImport.foldIcsLine("a".repeat(73)), ["a".repeat(73)]);
    assert.deepEqual(EventImport.foldIcsLine("a".repeat(74)), ["a".repeat(73), " a"]);
    assert.deepEqual(EventImport.foldIcsLine(`${"a".repeat(71)}é`), [`${"a".repeat(71)}é`]);
    assert.deepEqual(EventImport.foldIcsLine(`${"a".repeat(72)}é`), ["a".repeat(72), " é"]);
    assert.deepEqual(EventImport.foldIcsLine(""), [""]);
    assert.equal(sparseCalendar, [
        "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Cinnamon XPU WLM//Events 1//EN",
        "BEGIN:VEVENT", "UID:event-sparse@omnitensor", "DTSTART:20260901T070000Z",
        "SUMMARY:A\\;B\\,C\\\\D\\nE", "END:VEVENT", "END:VCALENDAR", "",
    ].join("\r\n"));
});

test("controller covers chooser cancellation, selection errors, and superseded choices", () => {
    const cancelled = harness();
    cancelled.controller.setAvailability(true, "ready");
    cancelled.controller.chooseFiles();
    cancelled.picker.files(null, []);
    assert.equal(cancelled.controller.state().phase, "idle");
    assert.match(cancelled.controller.state().message, /cancelled/u);

    const failed = harness();
    failed.controller.setAvailability(true, "ready");
    failed.controller.chooseFiles();
    failed.picker.files(new Error("chooser failed"), null);
    assert.equal(failed.controller.state().phase, "error");
    failed.controller.chooseFolder();
    failed.picker.folder(null, [source({regular: false})]);
    assert.match(failed.controller.state().message, /supported/u);

    const superseded = harness();
    superseded.controller.setAvailability(true, "ready");
    superseded.controller.chooseFiles();
    const first = superseded.picker.files;
    superseded.controller.chooseFiles();
    assert.equal(first(null, [source()]), false);
    superseded.picker.files(null, [source()]);
    assert.equal(superseded.controller.state().phase, "selected");
});

test("controller reports submission and acknowledgement boundaries", () => {
    const idle = harness();
    idle.controller.setAvailability(true, "ready");
    assert.equal(idle.controller.start(), false);

    const thrown = harness();
    thrown.controller.setAvailability(true, "ready");
    thrown.controller.chooseFiles();
    thrown.picker.files(null, [source()]);
    thrown.gateway.submit = () => { throw new Error("submit failed"); };
    assert.equal(thrown.controller.start(), true);
    assert.match(thrown.controller.state().message, /submit failed/u);

    for (const reply of [null, {status: "rejected", message: "not qualified"}, {status: "accepted"}]) {
        const refused = harness();
        refused.controller.setAvailability(true, "ready");
        refused.controller.chooseFiles();
        refused.picker.files(null, [source()]);
        refused.controller.start();
        refused.gateway.submissions[0].callback(null, reply);
        assert.equal(refused.controller.state().phase, "error");
    }

    const transport = harness();
    transport.controller.setAvailability(true, "ready");
    transport.controller.chooseFiles();
    transport.picker.files(null, [source()]);
    transport.controller.start();
    transport.gateway.submissions[0].callback(new Error("offline"), null);
    assert.match(transport.controller.state().message, /offline/u);
});

function startRunning(current) {
    current.controller.setAvailability(true, "ready");
    current.controller.chooseFiles();
    current.picker.files(null, [source()]);
    current.controller.start();
    current.gateway.submissions[0].callback(null, {
        status: "accepted", jobId: "job-1", message: "Accepted",
    });
    return current;
}

test("controller bounds polling and handles every terminal result", () => {
    const stale = startRunning(harness());
    assert.equal(stale.controller._poll(-1), false);
    assert.equal(stale.controller._result(-1, null, {}), false);
    stale.controller._state.phase = "preview";
    assert.equal(stale.controller._result(stale.controller._sequence, null, {}), false);
    stale.controller._state.phase = "running";
    stale.controller._polls = EventImport.MAX_POLLS;
    stale.timer.run();
    assert.match(stale.controller.state().message, /did not report/u);

    const thrown = startRunning(harness());
    thrown.gateway.requestResult = () => { throw new Error("poll offline"); };
    thrown.timer.run();
    assert.equal(thrown.controller.state().phase, "running");
    assert.equal(thrown.timer.callbacks.length, 1, "transport failures retry within the bound");

    const failed = startRunning(harness());
    failed.timer.run();
    failed.gateway.polls[0].callback(null, {
        state: "failed", jobId: "job-1", message: "provider failed",
    });
    assert.match(failed.controller.state().message, /provider failed/u);

    const refused = startRunning(harness());
    refused.timer.run();
    refused.gateway.polls[0].callback(null, {
        state: "succeeded", jobId: "job-1", message: "Done",
        output: result({
            outcome: "refused", code: "nothing-found", detail: "",
            confirmationState: "refused", events: [],
        }),
    });
    assert.equal(refused.controller.state().phase, "error");
    assert.equal(refused.controller.state().message, "nothing-found");

    const malformed = startRunning(harness());
    malformed.timer.run();
    malformed.gateway.polls[0].callback(null, {
        state: "succeeded", jobId: "job-1", message: "Done", output: {},
    });
    assert.match(malformed.controller.state().message, /result does not match/u);
    const nativeFailure = startRunning(harness());
    const hostileOutput = result();
    Object.defineProperty(hostileOutput, "version", {enumerable: true, get() { throw new Error("getter failed"); }});
    assert.equal(nativeFailure.controller._completedResult({jobId: "job-1", output: hostileOutput}), false);
    assert.match(nativeFailure.controller.state().message, /getter failed/u);

    const retry = startRunning(harness());
    retry.timer.run();
    retry.gateway.polls[0].callback(new Error("temporary"), null);
    assert.equal(retry.timer.callbacks.length, 1);
    retry.timer.run();
    retry.gateway.polls[1].callback(null, {
        state: "running", jobId: "job-1", message: "Still running", progress: null,
    });
    assert.equal(retry.controller.state().progress.fraction, 0);
});

test("controller cancellation reaches pre-admission and active job boundaries", () => {
    const idle = harness();
    assert.equal(idle.controller.cancel(), false);

    const submitting = harness();
    submitting.controller.setAvailability(true, "ready");
    submitting.controller.chooseFiles();
    submitting.picker.files(null, [source()]);
    submitting.controller.start();
    assert.equal(submitting.controller.cancel(), true);
    assert.equal(submitting.gateway.cancelled, 1);
    assert.equal(submitting.controller.state().phase, "selected");

    const thrown = startRunning(harness());
    thrown.gateway.cancelJob = () => { throw new Error("cancel offline"); };
    thrown.controller.cancel();
    assert.match(thrown.controller.state().message, /cancel offline/u);

    const rejected = startRunning(harness());
    rejected.controller.cancel();
    rejected.gateway.cancellations[0].callback(new Error("cancel refused"), null);
    assert.match(rejected.controller.state().message, /cancel refused/u);
    assert.equal(rejected.controller._cancelled(-1, null), false);
});

test("controller refuses invalid preview transitions and export outcomes", () => {
    const current = harness();
    assert.equal(current.controller.edit("missing", {}), false);
    assert.equal(current.controller.decide("missing", "confirmed"), false);
    assert.equal(current.controller.beginExport(), false);
    assert.equal(current.controller.backToPreview(), false);
    assert.equal(current.controller.confirmExport(), false);

    current.controller._state.phase = "preview";
    current.controller._state.candidates = [candidate()];
    assert.equal(current.controller.edit("missing", {}), false);
    assert.equal(current.controller.decide("missing", "confirmed"), false);
    assert.equal(current.controller.edit("event-1", {title: ""}), false);
    assert.equal(current.controller.state().phase, "preview");
    assert.throws(() => current.controller.decide("event-1", "invalid"), /decision-invalid/u);
    current.controller._state.candidates = [candidate(), candidate({
        candidateId: "event-2", title: "Other planning",
    })];
    assert.equal(current.controller.edit("event-2", {title: "Planning session"}), true);
    assert.equal(current.controller.state().candidates.length, 1);
    assert.match(current.controller.state().message, /duplicate/iu);

    current.controller._state.phase = "confirm-export";
    assert.equal(current.controller.confirmExport(), false);
    assert.equal(current.controller.state().phase, "preview");

    current.controller._state.phase = "confirm-export";
    current.controller._state.candidates = [EventImport.decidedCandidate(candidate(), "confirmed")];
    current.exporter.saveIcs = () => { throw new Error("save failed"); };
    assert.equal(current.controller.confirmExport(), true);
    assert.match(current.controller.state().message, /save failed/u);

    current.controller._state.phase = "exporting";
    current.controller._sequence += 1;
    const sequence = current.controller._sequence;
    assert.equal(current.controller._exported(sequence - 1, null, "/tmp/out.ics"), false);
    assert.equal(current.controller._exported(sequence, null, ""), false);
    assert.match(current.controller.state().message, /cancelled/u);
    assert.equal(current.controller._fail(""), false);
    assert.equal(current.controller.state().message, "Event import failed");
    current.controller._state.phase = "running";
    assert.equal(current.controller.reset(), false);
});

test("controller drives choose, submit, progress, preview, confirmation, and new-file export", () => {
    const {controller, exporter, gateway, picker, timer} = harness();
    const observed = [];
    controller.subscribe((state) => observed.push(state.phase));
    assert.equal(controller.chooseFiles(), false, "unavailable profiles never open a chooser");
    controller.setAvailability(true, "qualified GPU provider ready");
    assert.equal(controller.chooseFiles(), true);
    picker.files(null, [source()]);
    assert.equal(controller.state().phase, "selected");

    assert.equal(controller.start(), true);
    assert.equal(gateway.submissions.length, 1);
    gateway.submissions[0].callback(null, {
        requestId: gateway.submissions[0].submission.requestId,
        jobId: "job-1",
        status: "accepted",
        message: "Job accepted",
    });
    assert.equal(controller.state().phase, "running");
    assert.equal(timer.callbacks[0].delay, EventImport.POLL_INTERVAL_MS);

    timer.run();
    gateway.polls[0].callback(null, {
        requestId: gateway.polls[0].request.requestId,
        jobId: "job-1",
        state: "running",
        message: "Generating",
        progress: {fraction: 0.7, detail: "generate"},
    });
    assert.equal(controller.state().progress.fraction, 0.7);
    timer.run();
    gateway.polls[1].callback(null, {
        requestId: gateway.polls[1].request.requestId,
        jobId: "job-1",
        state: "succeeded",
        message: "Done",
        output: result(),
    });
    assert.equal(controller.state().phase, "preview");
    assert.equal(controller.state().candidates.length, 1);

    assert.equal(controller.edit("event-1", {title: "Edited session"}), true);
    assert.equal(controller.decide("event-1", "confirmed"), true);
    assert.equal(controller.beginExport(), true);
    assert.equal(controller.state().phase, "confirm-export");
    assert.equal(controller.confirmExport(), true);
    assert.deepEqual(exporter.calls[0].forbidden, [source().path]);
    exporter.calls[0].callback(null, "/home/tester/confirmed-events.ics");
    assert.equal(controller.state().phase, "complete");
    assert.equal(controller.state().exportedPath, "/home/tester/confirmed-events.ics");
    assert.equal(observed.includes("running"), true);
    assert.equal(controller.reset(), true);
    assert.equal(controller.state().phase, "idle");
});

test("a failing event listener cannot block later subscribers", () => {
    const {controller} = harness();
    const states = [];
    controller.subscribe((state) => {
        state.phase = "corrupted";
        throw new Error("view failed");
    });
    controller.subscribe((state) => states.push(state));

    assert.doesNotThrow(() => controller.setAvailability(true, "ready"));
    assert.equal(controller.state().phase, "idle");
    assert.deepEqual(states.map((state) => state.phase), ["idle"]);
});

test("controller preserves explicit back, cancellation, and late-callback safety", () => {
    const {controller, gateway, picker, timer} = harness();
    controller.setAvailability(true, "ready");
    controller.chooseFolder();
    picker.folder(null, [source()]);
    controller.start();
    gateway.submissions[0].callback(null, {status: "accepted", jobId: "job-1", message: "Accepted"});
    assert.equal(controller.cancel(), true);
    assert.equal(timer.cancelled.length, 1);
    assert.equal(gateway.cancellations.length, 1);
    gateway.cancellations[0].callback(null, {status: "cancelled"});
    assert.equal(controller.state().phase, "selected");

    const late = gateway.submissions[0].callback;
    controller.start();
    assert.equal(controller.cancel(), true);
    late(null, {status: "accepted", jobId: "late", message: "late"});
    assert.notEqual(controller.state().jobId, "late");
});

test("controller reports refusals and supports explicit export backtracking", () => {
    const {controller, exporter, gateway, picker, timer} = harness();
    controller.setAvailability(true, "ready");
    controller.chooseFiles();
    picker.files(null, [source()]);
    controller.start();
    gateway.submissions[0].callback(null, {status: "accepted", jobId: "job-1", message: "Accepted"});
    timer.run();
    gateway.polls[0].callback(null, {
        state: "succeeded", jobId: "job-1", output: result(), message: "Done",
    });
    assert.equal(controller.beginExport(), false, "pending candidates cannot export");
    assert.equal(controller.state().phase, "preview");
    controller.decide("event-1", "confirmed");
    controller.beginExport();
    assert.equal(controller.backToPreview(), true);
    controller.beginExport();
    controller.confirmExport();
    exporter.calls[0].callback(new Error("file exists"), null);
    assert.equal(controller.state().phase, "preview");
    assert.match(controller.state().message, /file exists/u);
});

test("controller validates ports, isolates state copies, and disposes once", () => {
    const valid = harness();
    for (const override of [
        {picker: null}, {gateway: null}, {exporter: null}, {scheduler: null}, {clock: null},
    ]) {
        assert.throws(() => new EventImport.EventImportController({
            picker: valid.picker,
            gateway: valid.gateway,
            exporter: valid.exporter,
            scheduler: valid.timer,
            clock: {now: () => 1},
            ...override,
        }), TypeError);
    }
    const portFaults = [
        ["Event source picker", {picker: {chooseFiles() {}}}],
        ["Event job gateway", {gateway: {submit() {}, requestResult() {}, cancelJob() {}}}],
        ["Event exporter", {exporter: {}}],
        ["Event scheduler", {scheduler: {schedule() {}}}],
    ];
    for (const [label, override] of portFaults) {
        assert.throws(() => new EventImport.EventImportController({
            picker: valid.picker,
            gateway: valid.gateway,
            exporter: valid.exporter,
            scheduler: valid.timer,
            clock: {now: () => 1},
            ...override,
        }), (error) => error instanceof TypeError && error.message.startsWith(label));
    }
    assert.throws(() => valid.controller.subscribe(null), TypeError);
    let notifications = 0;
    const unsubscribe = valid.controller.subscribe(() => { notifications += 1; });
    assert.equal(valid.controller.setAvailability(false, "Event provider is not ready"), false);
    assert.equal(valid.controller.setAvailability(true, "x".repeat(241)), true);
    assert.equal(valid.controller.state().availabilityDetail, "");
    assert.equal(notifications, 1);
    assert.equal(unsubscribe(), true);
    assert.equal(unsubscribe(), false);
    valid.controller.setAvailability(false, "not ready");
    assert.equal(notifications, 1);
    const state = valid.controller.state();
    state.sources.push(source());
    assert.equal(valid.controller.state().sources.length, 0);
    valid.controller._state.sources = [source()];
    valid.controller._state.progress = {fraction: 0.25, detail: "reading"};
    valid.controller._state.candidates = [candidate()];
    const copied = valid.controller.state();
    assert.notEqual(copied.sources[0], valid.controller._state.sources[0]);
    assert.deepEqual(copied.sources[0], valid.controller._state.sources[0]);
    assert.notEqual(copied.progress, valid.controller._state.progress);
    assert.deepEqual(copied.progress, valid.controller._state.progress);
    assert.notEqual(copied.candidates[0], valid.controller._state.candidates[0]);
    assert.equal(valid.controller.dispose(), true);
    assert.equal(valid.controller.dispose(), false);
    assert.throws(() => valid.controller.chooseFiles(), /disposed/u);
});

test("controller chooser and reset guards cover every active phase", () => {
    for (const phase of ["submitting", "running", "cancelling", "exporting"]) {
        const current = harness();
        current.controller.setAvailability(true, "ready");
        current.controller._state.phase = phase;
        assert.equal(current.controller.chooseFiles(), false, phase);
        assert.equal(current.controller.chooseFolder(), false, phase);
        assert.equal(current.controller.reset(), false, phase);
        assert.equal(current.picker.files, null);
        assert.equal(current.picker.folder, null);
    }
    const current = harness();
    assert.equal(current.controller._clearPoll(), false);
    const handle = {id: 1};
    current.controller._pollHandle = handle;
    assert.equal(current.controller._clearPoll(), true);
    assert.deepEqual(current.timer.cancelled, [handle]);
    assert.equal(current.controller._pollHandle, null);
    assert.equal(current.controller._nextSequence(), 1);
    assert.equal(current.controller._nextSequence(), 2);
});

test("controller internal acknowledgements and polling retain exact transition contracts", () => {
    const accepted = harness();
    assert.equal(accepted.controller._accepted(0, null, {
        status: "accepted", jobId: "job-1", message: "Queued by provider",
    }), true);
    assert.deepEqual(accepted.controller.state().progress, {fraction: 0, detail: "Queued"});
    assert.equal(accepted.controller.state().jobId, "job-1");
    assert.equal(accepted.timer.callbacks.length, 1);

    const rejected = harness();
    assert.equal(rejected.controller._accepted(0, null, {status: "rejected", message: "Denied"}), false);
    assert.equal(rejected.controller.state().message, "Denied");
    const empty = harness();
    assert.equal(empty.controller._accepted(0, null, {status: "accepted", jobId: ""}), false);
    assert.equal(empty.controller.state().message, "Runtime rejected event extraction");

    const polling = harness();
    polling.controller._state.phase = "running";
    polling.controller._state.jobId = "job-1";
    polling.controller._polls = EventImport.MAX_POLLS - 1;
    assert.equal(polling.controller._poll(0), true);
    assert.equal(polling.controller.state().phase, "running");
    assert.deepEqual(polling.gateway.polls[0].request, {
        requestId: `xpuwlm-event-poll-1700000000000-${EventImport.MAX_POLLS}`,
        jobId: "job-1",
    });
    assert.equal(polling.controller._result(0, new Error("retry"), null), false);
    assert.equal(polling.timer.callbacks.length, 1);
    assert.equal(polling.controller._result(0, null, {
        state: "running", message: "Working", progress: {fraction: 0.4, detail: "read"},
    }), true);
    assert.deepEqual(polling.controller.state().progress, {fraction: 0.4, detail: "read"});
});

test("controller edits and export calls expose every consequential value", () => {
    const current = harness();
    current.controller._state = {
        ...EventImport.initialState(),
        available: true,
        phase: "preview",
        sources: [source(), source({path: "/home/tester/events/other.txt", name: "other.txt"})],
        candidates: [candidate()],
        duplicatesDropped: 2,
    };
    assert.equal(current.controller.edit("event-1", {title: "Changed"}), true);
    assert.equal(current.controller.state().message, "Event updated");
    assert.equal(current.controller.state().duplicatesDropped, 2);
    assert.equal(current.controller.state().candidates[0].title, "Changed");
    assert.equal(current.controller.edit("event-1", {unknown: "x"}), false);
    assert.equal(current.controller.state().phase, "preview");
    assert.match(current.controller.state().message, /edit fields are invalid/u);

    current.controller._state.phase = "idle";
    current.controller._state.message = "unchanged";
    assert.equal(current.controller.edit("event-1", {title: "Should not apply"}), false);
    assert.equal(current.controller.state().message, "unchanged");
    assert.equal(current.controller.state().candidates[0].title, "Changed");
    current.controller._state.phase = "preview";
    assert.equal(current.controller.edit("missing", {title: "Should not apply"}), false);
    assert.equal(current.controller.state().message, "unchanged");

    current.controller._state.candidates = [
        candidate(), candidate({candidateId: "event-2", title: "Other"}),
    ];
    current.controller._state.duplicatesDropped = 2;
    assert.equal(current.controller.edit("event-2", {title: "Planning session"}), true);
    assert.equal(current.controller.state().duplicatesDropped, 3);

    current.controller._state.candidates = [EventImport.decidedCandidate(candidate(), "confirmed")];
    current.controller._state.phase = "confirm-export";
    assert.equal(current.controller.confirmExport(), true);
    assert.deepEqual(current.exporter.calls[0].forbidden, [
        "/home/tester/events/agenda.txt", "/home/tester/events/other.txt",
    ]);
    assert.equal(current.exporter.calls[0].calendar, EventImport.confirmedIcs(current.controller._state.candidates));
    assert.equal(current.controller.state().phase, "exporting");
    assert.equal(current.controller.state().message, "Choose a new calendar file…");

    const guarded = harness();
    guarded.controller._state.candidates = [EventImport.decidedCandidate(candidate(), "confirmed")];
    assert.equal(guarded.controller.confirmExport(), false);
    assert.equal(guarded.exporter.calls.length, 0);

    const refused = harness();
    refused.controller._state.phase = "confirm-export";
    refused.controller._state.candidates = [candidate()];
    assert.equal(refused.controller.confirmExport(), false);
    assert.equal(refused.controller.state().message,
        "Decide whether to keep or reject every candidate");
});
