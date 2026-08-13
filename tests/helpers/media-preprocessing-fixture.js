"use strict";

const Media = require("../../files/cinnamon-xpuwlm@geraldo-netto/lib/media-preprocessing.js");

function source(suffix = ".mp4", overrides = {}) {
    return {
        path: `/private/sample${suffix}`,
        name: `sample${suffix}`,
        size: 4096,
        regular: true,
        symlink: false,
        ...overrides,
    };
}

function probe(selected, overrides = {}) {
    const family = Media.mediaFamily(selected.path);
    const values = {
        audio: {
            durationMs: 1000, width: null, height: null, pageCount: null,
            hasAudio: true, archiveEntries: null, archiveExpandedBytes: null,
        },
        document: {
            durationMs: null, width: null, height: null, pageCount: 2,
            hasAudio: false, archiveEntries: null, archiveExpandedBytes: null,
        },
        image: {
            durationMs: null, width: 1200, height: 800, pageCount: null,
            hasAudio: false, archiveEntries: null, archiveExpandedBytes: null,
        },
        presentation: {
            durationMs: null, width: null, height: null, pageCount: 2,
            hasAudio: false, archiveEntries: 20, archiveExpandedBytes: 8192,
        },
        video: {
            durationMs: 30_000, width: 1920, height: 1080, pageCount: null,
            hasAudio: true, archiveEntries: null, archiveExpandedBytes: null,
        },
    }[family];
    return {format: Media.sourceFormat(selected.path), ...values, ...overrides};
}

function image(plan, index) {
    const family = plan.source.family;
    return {
        name: `visual-${index + 1}.png`,
        width: 768,
        height: 512,
        timestampMs: family === "video" ? plan.frameTimestampsMs[index] : null,
        pageNumber: family === "document" ? index + 1 : null,
        slideNumber: family === "presentation" ? index + 1 : null,
        mimeType: "image/png",
        colorSpace: "srgb",
        orientation: "applied",
    };
}

function decoded(plan, inspected, overrides = {}) {
    const count = {
        audio: 0,
        document: inspected.pageCount,
        image: 1,
        presentation: inspected.pageCount,
        video: plan.frameTimestampsMs.length,
    }[plan.source.family];
    const hasAudio = plan.source.family === "audio"
        || (plan.source.family === "video" && inspected.hasAudio);
    return {
        images: Array.from({length: count}, (_value, index) => image(plan, index)),
        audio: hasAudio ? {
            name: "audio.f32",
            durationMs: inspected.durationMs,
            sampleRateHz: 16_000,
            channels: 1,
            sampleFormat: "float32-planar",
        } : null,
        ...overrides,
    };
}

module.exports = {decoded, image, probe, source};
