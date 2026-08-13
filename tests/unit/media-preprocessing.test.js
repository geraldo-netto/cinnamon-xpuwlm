"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const Fixture = require("../helpers/media-preprocessing-fixture.js");
const Media = require("../../files/cinnamon-xpuwlm@geraldo-netto/lib/media-preprocessing.js");

test("format catalog covers every supported complex media suffix once", () => {
    assert.equal(Media.SOURCE_SUFFIXES.length, 22);
    assert.equal(new Set(Media.SOURCE_SUFFIXES).size, Media.SOURCE_SUFFIXES.length);
    assert.deepEqual(Media.AUDIO_SUFFIXES, [".flac", ".m4a", ".mp3", ".ogg", ".opus", ".wav"]);
    assert.deepEqual(Media.DOCUMENT_SUFFIXES, [".pdf", ".tif", ".tiff"]);
    assert.deepEqual(Media.IMAGE_SUFFIXES, [".jpeg", ".jpg", ".png", ".svg", ".webp"]);
    assert.deepEqual(Media.PRESENTATION_SUFFIXES, [".odp", ".pptx"]);
    assert.deepEqual(Media.VIDEO_SUFFIXES, [".avi", ".m4v", ".mkv", ".mov", ".mp4", ".webm"]);
    for (const suffix of Media.SOURCE_SUFFIXES) {
        const selected = Fixture.source(suffix.toUpperCase());
        assert.notEqual(Media.sourceFormat(selected.path), "", suffix);
        assert.notEqual(Media.mediaFamily(selected.path), "", suffix);
        assert.equal(Media.validSource(selected), true, suffix);
    }
    assert.equal(Media.sourceFormat("/tmp/unknown.bin"), "");
    assert.equal(Media.mediaFamily(null), "");
    assert.equal(Object.isFrozen(Media.FORMAT_DEFINITIONS), true);
});

test("source boundary rejects hidden, relative, unsafe, oversized, and extra records", () => {
    const invalid = [
        null,
        Fixture.source(".png", {path: "relative.png"}),
        Fixture.source(".png", {path: `/${"a".repeat(4096)}.png`}),
        Fixture.source(".png", {name: ".hidden.png"}),
        Fixture.source(".png", {name: "directory/item.png"}),
        Fixture.source(".png", {name: "directory\\item.png"}),
        Fixture.source(".png", {name: "x".repeat(256)}),
        Fixture.source(".png", {size: 0}),
        Fixture.source(".png", {size: Media.MAX_SOURCE_BYTES + 1}),
        Fixture.source(".png", {regular: false}),
        Fixture.source(".png", {symlink: true}),
        Fixture.source(".bin"),
        {...Fixture.source(".png"), extra: true},
    ];
    for (const candidate of invalid) {
        assert.equal(Media.validSource(candidate), false);
        assert.throws(() => Media.ownedSource(candidate), /media source is invalid/u);
    }
    const selected = Media.ownedSource(Fixture.source(".png"));
    assert.equal(Object.isFrozen(selected), true);
});

test("plans unify lossless visual and decoded audio policy for every family", () => {
    const cases = [
        [".mp3", ["decode-audio", "resample-mono-float32"]],
        [".pdf", ["render-pdf-pages", "apply-orientation", "convert-srgb", "resize-contain", "encode-lossless-png"]],
        [".tiff", ["decode-tiff-pages", "apply-orientation", "convert-srgb", "resize-contain", "encode-lossless-png"]],
        [".jpg", ["decode-raster-image", "apply-orientation", "convert-srgb", "resize-contain", "encode-lossless-png"]],
        [".svg", ["render-svg", "apply-orientation", "convert-srgb", "resize-contain", "encode-lossless-png"]],
        [".pptx", ["inspect-presentation-archive", "extract-slide-text", "apply-orientation", "convert-srgb", "resize-contain", "encode-lossless-png"]],
        [".mp4", ["decode-video-frames", "apply-orientation", "convert-srgb", "resize-contain", "encode-lossless-png", "resample-mono-float32"]],
    ];
    for (const [suffix, operations] of cases) {
        const selected = Fixture.source(suffix);
        const inspected = Fixture.probe(selected);
        const plan = Media.preprocessingPlan(selected, inspected);
        assert.deepEqual(plan.operations, operations, suffix);
        assert.equal(plan.image.mimeType, "image/png");
        assert.equal(plan.image.colorSpace, "srgb");
        assert.equal(plan.image.orientation, "apply-metadata");
        assert.equal(plan.image.renderMaxDimension, 1600);
        assert.equal(plan.image.inferenceMaxDimension, 768);
        assert.equal(plan.image.resizeFilter, "lanczos");
        assert.equal(plan.audio.sampleRateHz, 16_000);
        assert.equal(plan.audio.channels, 1);
        assert.equal(plan.audio.sampleFormat, "float32-planar");
        assert.equal(plan.audio.intermediate, "memory");
        assert.equal(Object.isFrozen(plan), true);
        assert.equal(Object.isFrozen(plan.operations), true);
        assert.equal(Object.isFrozen(plan.limits), true);
    }
    const silent = Fixture.source(".webm");
    assert.equal(
        Media.preprocessingPlan(silent, Fixture.probe(silent, {hasAudio: false}))
            .operations.includes("resample-mono-float32"),
        false,
    );
});

test("probe validation enforces family-specific metadata and exact bounds", () => {
    const valid = [".wav", ".pdf", ".png", ".odp", ".mkv"];
    for (const suffix of valid) {
        const selected = Fixture.source(suffix);
        assert.equal(Media.validProbe(selected, Fixture.probe(selected)), true, suffix);
    }
    const faults = [
        [".wav", {durationMs: 0}],
        [".wav", {durationMs: Media.MAX_DURATION_MS + 1}],
        [".wav", {width: 1}],
        [".wav", {hasAudio: false}],
        [".pdf", {pageCount: 0}],
        [".pdf", {pageCount: Media.MAX_PAGES + 1}],
        [".png", {width: 0}],
        [".png", {height: 65_536}],
        [".odp", {archiveEntries: 0}],
        [".odp", {archiveEntries: Media.MAX_ARCHIVE_ENTRIES + 1}],
        [".odp", {archiveExpandedBytes: Media.MAX_ARCHIVE_EXPANDED_BYTES + 1}],
        [".mp4", {durationMs: Media.MAX_VIDEO_DURATION_MS + 1}],
        [".mp4", {hasAudio: null}],
        [".mp4", {pageCount: 1}],
    ];
    for (const [suffix, override] of faults) {
        const selected = Fixture.source(suffix);
        const inspected = Fixture.probe(selected, override);
        assert.equal(Media.validProbe(selected, inspected), false, `${suffix}:${JSON.stringify(override)}`);
        assert.throws(() => Media.preprocessingPlan(selected, inspected), /media probe is invalid/u);
    }
    const selected = Fixture.source(".png");
    assert.equal(Media.validProbe(selected, {...Fixture.probe(selected), extra: true}), false);
    assert.equal(Media.validProbe(selected, {...Fixture.probe(selected), format: "jpeg"}), false);
});

test("frame timestamps are deterministic, ordered, bounded, and include the final frame", () => {
    assert.deepEqual(Media.sampleTimestamps(1), [0]);
    assert.deepEqual(Media.sampleTimestamps(15_000), [0]);
    assert.deepEqual(Media.sampleTimestamps(30_000), [0, 29_999]);
    const maximum = Media.sampleTimestamps(Media.MAX_VIDEO_DURATION_MS);
    assert.equal(maximum.length, Media.MAX_VISUALS);
    assert.equal(maximum[0], 0);
    assert.equal(maximum.at(-1), Media.MAX_VIDEO_DURATION_MS - 1);
    assert.equal(Object.isFrozen(maximum), true);
    for (const invalid of [0, -1, 1.5, Media.MAX_VIDEO_DURATION_MS + 1]) {
        assert.throws(() => Media.sampleTimestamps(invalid), /video duration is invalid/u);
    }
});

test("normalized output validates exact lossless media for all families", () => {
    for (const suffix of [".wav", ".pdf", ".png", ".pptx", ".mp4"]) {
        const selected = Fixture.source(suffix);
        const inspected = Fixture.probe(selected);
        const plan = Media.preprocessingPlan(selected, inspected);
        const output = Media.normalizedOutput(Fixture.decoded(plan, inspected), plan, inspected);
        assert.equal(output.version, 1);
        assert.equal(Object.isFrozen(output), true);
        assert.equal(Object.isFrozen(output.images), true);
        if (output.images.length > 0) {
            assert.equal(Object.isFrozen(output.images[0]), true);
        }
        if (output.audio !== null) {
            assert.equal(Object.isFrozen(output.audio), true);
        }
    }
    const silent = Fixture.source(".webm");
    const inspected = Fixture.probe(silent, {hasAudio: false});
    const plan = Media.preprocessingPlan(silent, inspected);
    assert.equal(Media.normalizedOutput(Fixture.decoded(plan, inspected), plan, inspected).audio, null);
});

test("normalized output rejects wrong counts, positions, geometry, codecs, and names", () => {
    const selected = Fixture.source(".mp4");
    const inspected = Fixture.probe(selected);
    const plan = Media.preprocessingPlan(selected, inspected);
    const valid = Fixture.decoded(plan, inspected);
    const first = valid.images[0];
    const faults = [
        null,
        {...valid, extra: true},
        {...valid, images: []},
        {...valid, images: [first, first]},
        {...valid, images: [{...first, name: "../escape.png"}, ...valid.images.slice(1)]},
        {...valid, images: [{...first, width: 769}, ...valid.images.slice(1)]},
        {...valid, images: [{...first, height: 0}, ...valid.images.slice(1)]},
        {...valid, images: [{...first, timestampMs: 1}, ...valid.images.slice(1)]},
        {...valid, images: [{...first, pageNumber: 1}, ...valid.images.slice(1)]},
        {...valid, images: [{...first, mimeType: "image/jpeg"}, ...valid.images.slice(1)]},
        {...valid, images: [{...first, colorSpace: "display-p3"}, ...valid.images.slice(1)]},
        {...valid, images: [{...first, orientation: "ignored"}, ...valid.images.slice(1)]},
        {...valid, audio: {...valid.audio, name: first.name}},
        {...valid, audio: {...valid.audio, durationMs: 999}},
        {...valid, audio: {...valid.audio, sampleRateHz: 44_100}},
        {...valid, audio: {...valid.audio, channels: 2}},
        {...valid, audio: {...valid.audio, sampleFormat: "mp3"}},
    ];
    for (const fault of faults) {
        assert.throws(() => Media.normalizedOutput(fault, plan, inspected), Media.MediaPreprocessingError);
    }

    for (const suffix of [".pdf", ".pptx", ".png"]) {
        const staticSource = Fixture.source(suffix);
        const staticProbe = Fixture.probe(staticSource);
        const staticPlan = Media.preprocessingPlan(staticSource, staticProbe);
        const decoded = Fixture.decoded(staticPlan, staticProbe);
        const key = suffix === ".pdf" ? "pageNumber" : (suffix === ".pptx" ? "slideNumber" : "timestampMs");
        decoded.images[0] = {...decoded.images[0], [key]: 9};
        assert.equal(Media.validImages(decoded.images, staticPlan, staticProbe), false, suffix);
        assert.equal(Media.validAudio(decoded.audio, staticPlan, staticProbe), true, suffix);
    }
});

test("preprocessing executes one scoped adapter lifecycle and freezes consumer input", async () => {
    const events = [];
    const selected = Fixture.source(".mp4");
    const inspected = Fixture.probe(selected);
    const signal = {throwIfCancelled() { events.push("check"); }};
    const scope = {id: "scope-1"};
    const adapter = {
        async inspect(candidate, observedSignal) {
            events.push("inspect");
            assert.equal(Object.isFrozen(candidate), true);
            assert.equal(observedSignal, signal);
            return inspected;
        },
        async decode(plan, observedScope, observedSignal) {
            events.push("decode");
            assert.equal(observedScope, scope);
            assert.equal(observedSignal, signal);
            return Fixture.decoded(plan, inspected);
        },
    };
    const temporary = {
        async open(plan) { events.push("open"); assert.equal(Object.isFrozen(plan), true); return scope; },
        async cleanup(observed) { events.push("cleanup"); assert.equal(observed, scope); },
    };
    const result = await Media.preprocessMedia({
        source: selected,
        adapter,
        temporary,
        signal,
        async consume(output, observedSignal) {
            events.push("consume");
            assert.equal(Object.isFrozen(output), true);
            assert.equal(observedSignal, signal);
            return output.images.length;
        },
    });
    assert.equal(result, 2);
    assert.deepEqual(events, [
        "check", "inspect", "check", "open", "check", "decode", "check", "consume", "cleanup",
    ]);
});

test("preprocessing rejects invalid ports before work starts", async () => {
    const base = {
        source: Fixture.source(".png"),
        adapter: {inspect() {}, decode() {}},
        temporary: {open() {}, cleanup() {}},
        signal: {throwIfCancelled() {}},
        consume() {},
    };
    for (const override of [
        {adapter: null},
        {adapter: {inspect() {}}},
        {temporary: null},
        {temporary: {open() {}}},
        {signal: null},
        {signal: {}},
        {consume: null},
    ]) {
        await assert.rejects(Media.preprocessMedia({...base, ...override}), Media.MediaPreprocessingError);
    }
});
