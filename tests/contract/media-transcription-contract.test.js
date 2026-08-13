"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const Media = require("../../files/cinnamon-xpuwlm@geraldo-netto/lib/media-transcription.js");

const repositoryRoot = path.resolve(__dirname, "../..");

function serviceRoot() {
    const candidate = process.env.XPUWLM_OMNITENSOR_ROOT
        || path.resolve(repositoryRoot, "../omnitensor");
    return fs.existsSync(path.join(candidate, "plugin-manifests/media-transcription.json"))
        ? candidate
        : null;
}

function requireService(t) {
    const root = serviceRoot();
    if (root === null) {
        t.skip("set XPUWLM_OMNITENSOR_ROOT to run the media-transcription contract gate");
    }
    return root;
}

function readJson(root, relative) {
    return JSON.parse(fs.readFileSync(path.join(root, relative), "utf8"));
}

test("media manifest pins one manual file, exact grants, artifacts, and accelerator", (t) => {
    const root = requireService(t);
    if (root === null) {
        return;
    }
    const manifest = readJson(root, "plugin-manifests/media-transcription.json");
    const sources = manifest.plugin.schemas.input.properties.sources;
    assert.equal(manifest.id, Media.PROFILE_ID);
    assert.equal(manifest.plugin.entryPoint, Media.PROFILE_ID);
    assert.deepEqual(manifest.plugin.triggers, ["manual"]);
    assert.deepEqual(manifest.plugin.permissions, [
        "accelerator:gpu", "files:read-selected",
    ]);
    assert.equal(sources.minItems, 1);
    assert.equal(sources.maxItems, 1);
    assert.deepEqual(manifest.plugin.schemas.output, {
        $ref: "media-transcription-result.schema.json",
    });
    assert.deepEqual(manifest.requirements.acceleratorPreference, ["gpu"]);
    assert.deepEqual(manifest.plugin.artifacts.map((item) => item.id), [
        "qwen2-5-vl-7b-instruct", "whisper-small-multilingual",
    ]);
});

test("media result schema and defensive parser share every public bound", (t) => {
    const root = requireService(t);
    if (root === null) {
        return;
    }
    const schema = readJson(root, "schemas/media-transcription-result.schema.json");
    assert.equal(schema.properties.version.const, 1);
    assert.deepEqual(schema.properties.accelerator.enum, ["gpu", "npu"]);
    assert.equal(schema.properties.visuals.maxItems, Media.MAX_PRESENTATION_SLIDES);
    assert.equal(schema.$defs.source.properties.durationMs.maximum, Media.MAX_DURATION_MS);
    assert.equal(schema.$defs.speech.properties.segments.maxItems, Media.MAX_SEGMENTS);
    assert.equal(
        schema.$defs.speechSegment.properties.text.maxLength,
        Media.MAX_SPEECH_TEXT_CHARACTERS,
    );
    assert.equal(
        schema.$defs.visual.properties.timestampMs.maximum,
        Media.MAX_VIDEO_DURATION_MS,
    );
    assert.equal(
        schema.$defs.visual.properties.pageNumber.maximum,
        Media.MAX_PRESENTATION_SLIDES,
    );
    assert.equal(
        schema.$defs.visual.properties.visibleText.maxLength,
        Media.MAX_TEXT_CHARACTERS,
    );
});

test("OmniTensor composes speech plus sampled visuals and always discards frames", (t) => {
    const root = requireService(t);
    if (root === null) {
        return;
    }
    const plugin = fs.readFileSync(
        path.join(root, "src/omnitensor/plugins/media_transcription.py"), "utf8",
    );
    const providerRoot = path.join(
        root,
        "providers/media-transcription/src/omnitensor_media_transcription",
    );
    const provider = fs.readFileSync(path.join(providerRoot, "provider.py"), "utf8");
    const models = fs.readFileSync(path.join(providerRoot, "models.py"), "utf8");
    assert.match(plugin, /class MediaTranscriptionPlugin/u);
    assert.match(plugin, /await self\._speech\.transcribe/u);
    assert.match(plugin, /await self\._vision\.transcribe/u);
    assert.match(plugin, /await self\._documents\.transcribe/u);
    assert.match(plugin, /await self\._frames\.discard\(frames\)/u);
    assert.match(models, /context_params=\{"use_gpu": true/iu);
    assert.match(models, /n_gpu_layers=-1/u);
    for (const forbidden of ["subprocess.", "os.system(", "Gtk.", "Gdk."]) {
        assert.equal(`${provider}\n${models}`.includes(forbidden), false, forbidden);
    }
});
