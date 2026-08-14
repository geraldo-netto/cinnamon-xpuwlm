"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const Media = require("../../files/cinnamon-xpuwlm@geraldo-netto/lib/media-transcription.js");

const DIGEST = "a".repeat(64);

function source(overrides = {}) {
    return {
        path: "/home/tester/media/clip.mp4",
        name: "clip.mp4",
        size: 1024,
        regular: true,
        symlink: false,
        ...overrides,
    };
}

function result(overrides = {}) {
    return {
        version: 1,
        requestId: "job-1",
        providerId: "media-transcription-vulkan",
        accelerator: "gpu",
        source: {
            fileName: "clip.mp4",
            sourceSha256: DIGEST,
            modality: "video",
            durationMs: 30_000,
        },
        speech: {
            language: "he",
            segments: [
                {startMs: 0, endMs: 1000, text: "שלום"},
                {startMs: 1000, endMs: 2500, text: "Привет — KOI8-R decoded"},
            ],
        },
        visuals: [
            {
                timestampMs: 0, slideNumber: null, pageNumber: null,
                visibleText: "שלום עולם", description: "A title card.",
            },
            {
                timestampMs: 29_999, slideNumber: null, pageNumber: null,
                visibleText: "", description: "A blue closing frame.",
            },
        ],
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
    const controller = new Media.MediaTranscriptionController({
        picker, gateway, scheduler: timer, clock: {now: () => 1_700_000_000_000},
    });
    return {controller, gateway, picker, timer};
}

test("media selection admits only one bounded explicit supported file", () => {
    assert.equal(Media.PROFILE_ID, "media-transcription");
    assert.equal(Media.MAX_SOURCE_BYTES, 128 * 1024 * 1024);
    assert.equal(Media.MAX_VIDEO_DURATION_MS, 300_000);
    assert.equal(Media.SOURCE_SUFFIXES.length, 22);
    for (const suffix of Media.SOURCE_SUFFIXES) {
        const candidate = source({path: `/private/item${suffix}`, name: `item${suffix}`});
        assert.equal(Media.supportedSource(candidate), true, suffix);
        assert.equal(Media.selectedSource([candidate]).path, candidate.path);
    }
    assert.equal(Media.modalityOf("A.WAV"), "audio");
    assert.equal(Media.modalityOf("A.PNG"), "image");
    assert.equal(Media.modalityOf("A.WEBM"), "video");
    assert.equal(Media.modalityOf("A.PPTX"), "presentation");
    assert.equal(Media.modalityOf("A.ODP"), "presentation");
    assert.equal(Media.modalityOf("A.PDF"), "document");
    assert.equal(Media.modalityOf("A.TIFF"), "document");
    assert.equal(Media.modalityOf("A.SVG"), "image");
    assert.equal(Media.modalityOf("A.TXT"), "");
    for (const candidate of [
        null,
        source({path: "relative.mp4"}),
        source({path: "/private/a.txt", name: "a.txt"}),
        source({name: ".hidden.mp4"}),
        source({name: "dir/a.mp4"}),
        source({name: "dir\\a.mp4"}),
        source({regular: false}),
        source({symlink: true}),
        source({size: 0}),
        source({size: Media.MAX_SOURCE_BYTES + 1}),
    ]) {
        assert.equal(Media.supportedSource(candidate), false);
    }
    for (const candidates of [null, [], [source(), source()]]) {
        assert.throws(() => Media.selectedSource(candidates), /exactly one/u);
    }
    assert.throws(() => Media.selectedSource([source({name: ".hidden.mp4"})]), /supported/u);
});

test("result parser accepts video, image, audio, and presentations and freezes text", () => {
    const parsed = Media.transcriptionResult(result(), "job-1", source());
    assert.equal(parsed.speech.segments[0].text, "שלום");
    assert.equal(parsed.speech.segments[1].text, "Привет — KOI8-R decoded");
    assert.equal(Object.isFrozen(parsed), true);
    assert.equal(Object.isFrozen(parsed.source), true);
    assert.equal(Object.isFrozen(parsed.speech.segments[0]), true);
    assert.equal(Object.isFrozen(parsed.visuals), true);

    const imageSource = source({path: "/private/scan.png", name: "scan.png"});
    const image = result({
        source: {...result().source, fileName: "scan.png", modality: "image", durationMs: null},
        speech: {language: null, segments: []},
        visuals: [{
            timestampMs: null, slideNumber: null, pageNumber: null,
            visibleText: "עברית", description: "Printed page.",
        }],
    });
    assert.equal(Media.transcriptionResult(image, "job-1", imageSource).visuals.length, 1);

    const audioSource = source({path: "/private/voice.ogg", name: "voice.ogg"});
    const audio = result({
        source: {...result().source, fileName: "voice.ogg", modality: "audio", durationMs: 2500},
        visuals: [],
    });
    assert.equal(Media.transcriptionResult(audio, "job-1", audioSource).visuals.length, 0);

    const presentationSource = source({path: "/private/slides.odp", name: "slides.odp"});
    const presentation = result({
        source: {
            ...result().source,
            fileName: "slides.odp",
            modality: "presentation",
            durationMs: null,
        },
        speech: {language: null, segments: []},
        visuals: [
            {
                timestampMs: null, slideNumber: 1, pageNumber: null,
                visibleText: "שלום", description: "Title slide.",
            },
            {
                timestampMs: null, slideNumber: 2, pageNumber: null,
                visibleText: "Привет", description: "Diagram slide.",
            },
        ],
    });
    const parsedPresentation = Media.transcriptionResult(
        presentation, "job-1", presentationSource,
    );
    assert.deepEqual(parsedPresentation.visuals.map((item) => item.slideNumber), [1, 2]);
    assert.match(Media.transcriptText(presentation), /Slide 2/u);

    const documentSource = source({path: "/private/report.pdf", name: "report.pdf"});
    const document = result({
        source: {
            ...result().source,
            fileName: "report.pdf",
            modality: "document",
            durationMs: null,
        },
        speech: {language: null, segments: []},
        visuals: [{
            timestampMs: null, slideNumber: null, pageNumber: 1,
            visibleText: "שלום Привет", description: "Chart page.",
        }],
    });
    assert.equal(Media.transcriptionResult(document, "job-1", documentSource).visuals.length, 1);
    assert.match(Media.transcriptText(document), /Page 1/u);
});

test("result parser rejects identity, timing, modality, and text drift", () => {
    const faults = [
        result({version: 2}), result({requestId: "other"}), result({requestId: "bad!id"}),
        result({providerId: "Bad Provider"}), result({accelerator: "cpu"}),
        {...result(), extra: true},
        result({source: {...result().source, fileName: "other.mp4"}}),
        result({source: {...result().source, sourceSha256: "bad"}}),
        result({source: {...result().source, modality: "audio"}}),
        result({source: {...result().source, durationMs: 0}}),
        result({source: {...result().source, durationMs: Media.MAX_VIDEO_DURATION_MS + 1}}),
        result({speech: {language: "bad_language", segments: []}}),
        result({speech: {language: "he", segments: [{startMs: 1, endMs: 1, text: "x"}]}}),
        result({speech: {language: "he", segments: [{startMs: 0, endMs: 30_001, text: "x"}]}}),
        result({speech: {language: "he", segments: [
            {startMs: 10, endMs: 20, text: "x"}, {startMs: 0, endMs: 5, text: "y"},
        ]}}),
        result({speech: {language: "he", segments: [{startMs: 0, endMs: 1, text: ""}]}}),
        result({visuals: []}),
        result({visuals: [{
            timestampMs: -1, slideNumber: null, pageNumber: null,
            visibleText: "", description: "x",
        }]}),
        result({visuals: [{
            timestampMs: 0, slideNumber: null, pageNumber: null,
            visibleText: "", description: "",
        }]}),
        result({visuals: [{
            timestampMs: 0, slideNumber: null, pageNumber: null,
            visibleText: "x\0", description: "x",
        }]}),
        result({visuals: Array.from({length: Media.MAX_VISUALS + 1}, (_value, index) => ({
            timestampMs: index, slideNumber: null, pageNumber: null,
            visibleText: "", description: "x",
        }))}),
    ];
    for (const fault of faults) {
        assert.throws(
            () => Media.transcriptionResult(fault, "job-1", source()),
            /result-invalid/u,
        );
    }
    const imageSource = source({path: "/private/scan.png", name: "scan.png"});
    const invalidImage = result({
        source: {...result().source, fileName: "scan.png", modality: "image", durationMs: null},
        speech: {language: "he", segments: []},
        visuals: [{
            timestampMs: 0, slideNumber: null, pageNumber: null,
            visibleText: "x", description: "x",
        }],
    });
    assert.throws(
        () => Media.transcriptionResult(invalidImage, "job-1", imageSource),
        /result-invalid/u,
    );
});

test("submission and copy text preserve multilingual transcript with timestamps", () => {
    assert.deepEqual(Media.submission("request-1", source()), {
        version: 1,
        requestId: "request-1",
        workloadId: "media-transcription",
        payload: {sources: [source().path]},
    });
    assert.throws(() => Media.submission("bad!request", source()), /request-invalid/u);
    assert.equal(Media.timestampText(3_661_007), "01:01:01.007");
    assert.equal(Media.timestampText(-1), "00:00:00.000");
    const text = Media.transcriptText(result());
    assert.match(text, /שלום/u);
    assert.match(text, /Привет — KOI8-R decoded/u);
    assert.match(text, /Frame 00:00:29\.999/u);
    assert.match(text, /Visible text: שלום עולם/u);
    assert.equal(Media.transcriptText(null), "");
});

test("controller selects, submits, polls, validates, clones, and resets", () => {
    const {controller, gateway, picker, timer} = harness();
    const phases = [];
    const unsubscribe = controller.subscribe((state) => phases.push(state.phase));
    assert.deepEqual(controller.state(), Media.initialState());
    assert.equal(controller.setAvailability(true), true);
    assert.equal(controller.setAvailability(true), false);
    assert.equal(controller.chooseFiles(), true);
    picker.callback(null, [source()]);
    assert.equal(controller.state().phase, "selected");
    assert.equal(controller.state().message, "Media selected for local transcription");
    assert.equal(controller.start(), true);
    assert.equal(controller.state().phase, "submitting");
    assert.equal(controller.state().message, "Submitting selected media…");
    assert.equal(controller.state().progress, null);
    gateway.submissions[0].callback(null, {
        jobId: "job-1", status: "accepted", message: "queued",
    });
    assert.equal(controller.state().phase, "running");
    assert.deepEqual(controller.state().progress, {fraction: 0, detail: "Queued"});
    assert.equal(timer.pending[0].delay, Media.POLL_INTERVAL_MS);
    timer.run();
    gateway.polls[0].callback(null, {
        jobId: "job-1", state: "running", message: "speech",
        progress: {fraction: 0.5, detail: "speech"},
    });
    timer.run();
    gateway.polls[1].callback(null, {
        jobId: "job-1", state: "succeeded", output: result(),
    });
    assert.equal(controller.state().phase, "complete");
    assert.equal(controller.state().message, "Media transcription ready");
    assert.deepEqual(controller.state().progress, {
        fraction: 1, detail: "Transcription ready",
    });
    assert.equal(controller.state().result.speech.segments[0].text, "שלום");
    const clone = controller.state();
    clone.result.speech.segments[0].text = "changed";
    clone.result.visuals[0].description = "changed";
    clone.sources[0].name = "changed";
    assert.equal(controller.state().result.speech.segments[0].text, "שלום");
    assert.equal(controller.reset(), true);
    assert.equal(controller.state().available, true);
    assert.equal(unsubscribe(), true);
    assert.ok(phases.includes("complete"));
});

test("controller contains selection, transport, cancellation, and stale branches", () => {
    const {controller, gateway, picker, timer} = harness();
    assert.throws(() => new Media.MediaTranscriptionController({}), /picker/u);
    assert.throws(() => new Media.MediaTranscriptionController({
        picker: {chooseFiles() {}}, gateway: {}, scheduler: {}, clock: Date,
    }), /gateway/u);
    assert.throws(() => controller.subscribe(null), /listener/u);
    assert.equal(controller.chooseFiles(), false);
    controller.setAvailability(true, "x".repeat(241));
    controller.chooseFiles();
    picker.callback(null, []);
    assert.equal(controller.state().message, "Selection cancelled");
    controller.chooseFiles();
    picker.callback(new Error("pick failed"));
    assert.match(controller.state().message, /pick failed/u);
    controller.reset();
    controller.chooseFiles();
    picker.callback(null, [source()]);
    controller.start();
    assert.equal(controller._accepted(controller._sequence - 1, null, {}), false);
    gateway.submissions[0].callback(null, {jobId: "job-1", status: "accepted", message: "q"});
    timer.run();
    gateway.polls[0].callback(new Error("retry"));
    timer.run();
    gateway.polls[1].callback(null, {
        jobId: "job-1", state: "succeeded", output: result({requestId: "wrong"}),
    });
    assert.equal(controller.state().phase, "error");
    controller.reset();
    controller.chooseFiles();
    picker.callback(null, [source()]);
    controller.start();
    gateway.submissions[1].callback(null, {jobId: "job-2", status: "accepted", message: "q"});
    assert.equal(controller.cancel(), true);
    assert.equal(controller.state().phase, "cancelling");
    assert.equal(controller.state().message, "Cancelling media transcription…");
    gateway.cancellations[0].callback(null);
    assert.equal(controller.state().phase, "selected");
    assert.equal(controller.cancel(), false);
    controller._state.phase = "running";
    controller._polls = Media.MAX_POLLS;
    assert.equal(controller._poll(controller._sequence), false);
    assert.match(controller.state().message, /did not report/u);
    controller._state.phase = "running";
    assert.equal(controller.reset(), false);
    assert.equal(controller._clearPoll(), false);
    assert.equal(controller.dispose(), true);
    assert.equal(controller.dispose(), false);
    assert.equal(gateway.cancelled, 1);
    assert.throws(() => controller.chooseFiles(), /disposed/u);
});

test("controller covers every constructor, selection, terminal, and fallback branch", () => {
    const validPicker = {chooseFiles() {}};
    const validGateway = {
        submit() {}, requestResult() {}, cancelJob() {}, cancel() {},
    };
    const validScheduler = {schedule() {}, cancel() {}};
    assert.throws(() => new Media.MediaTranscriptionController({
        picker: validPicker, gateway: validGateway, scheduler: {}, clock: Date,
    }), /scheduler/u);
    assert.throws(() => new Media.MediaTranscriptionController({
        picker: validPicker, gateway: validGateway, scheduler: validScheduler, clock: null,
    }), /clock/u);

    const {controller, picker, timer} = harness();
    assert.equal(controller.start(), false, "unavailable cannot start");
    controller.setAvailability(true);
    assert.equal(controller._selected(controller._sequence - 1, null, []), false);
    assert.equal(controller.start(), false, "idle cannot start");
    controller.chooseFiles();
    picker.callback(null, null);
    assert.equal(controller.state().phase, "error");
    controller.reset();
    controller.chooseFiles();
    picker.callback(null, [source({size: 0})]);
    assert.equal(controller.state().phase, "error");

    controller._state.phase = "selected";
    controller._state.sources = [source({size: 0})];
    assert.equal(controller.start(), false);
    assert.equal(controller.state().phase, "selected");
    controller._state.phase = "running";
    controller._state.progress = {fraction: 0.25, detail: "Existing"};
    assert.equal(controller._result(controller._sequence - 1, null, {}), false);
    controller._state.phase = "selected";
    assert.equal(controller._result(controller._sequence, null, {}), false);
    controller._state.phase = "running";
    assert.equal(controller._result(controller._sequence, null, {
        state: "running", progress: null, message: "Still running",
    }), true);
    assert.deepEqual(controller.state().progress, {fraction: 0.25, detail: "Existing"});
    assert.equal(timer.pending.length, 1);

    controller._clearPoll();
    controller._state.phase = "running";
    assert.equal(controller._terminalResult({state: "failed", message: "Decoder refused"}), false);
    assert.equal(controller.state().message, "Decoder refused");
    controller._state.phase = "running";
    assert.equal(controller._terminalResult({state: "cancelled", message: ""}), false);
    assert.equal(controller.state().message, "Media transcription cancelled");
    assert.equal(controller._cancelled(controller._sequence - 1, null), false);
    controller._fail("");
    assert.equal(controller.state().message, "Media transcription failed");

    const rejected = harness();
    rejected.controller.setAvailability(true);
    rejected.controller.chooseFiles();
    rejected.picker.callback(null, [source()]);
    rejected.controller.start();
    rejected.gateway.submissions[0].callback(null, null);
    assert.equal(rejected.controller.state().phase, "error");
    assert.equal(
        rejected.controller.state().message,
        "Runtime rejected media transcription",
    );
});

test("synchronous port failures and pre-acknowledgement cancellation are contained", () => {
    const timer = scheduler();
    const gateway = {
        cancelled: 0,
        submit() { throw new Error("submit failed"); },
        requestResult() { throw new Error("poll failed"); },
        cancelJob() { throw new Error("cancel failed"); },
        cancel() { this.cancelled += 1; },
    };
    const controller = new Media.MediaTranscriptionController({
        picker: {chooseFiles() { throw new Error("pick failed"); }},
        gateway, scheduler: timer, clock: {now: () => 1},
    });
    controller.setAvailability(true);
    controller.chooseFiles();
    assert.match(controller.state().message, /pick failed/u);
    controller._state.phase = "selected";
    controller._state.sources = [source()];
    controller.start();
    assert.match(controller.state().message, /submit failed/u);
    controller._state.phase = "submitting";
    controller._state.jobId = "";
    assert.equal(controller.cancel(), true);
    assert.equal(gateway.cancelled, 1);
    controller._state.phase = "running";
    controller._state.jobId = "job-1";
    assert.equal(controller.cancel(), true);
    assert.match(controller.state().message, /cancel failed/u);
    controller._state.phase = "running";
    assert.equal(controller._poll(controller._sequence), true);
    assert.equal(timer.pending.length, 1);
});
