"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const stylesheet = fs.readFileSync(
    path.resolve(__dirname, "../../files/cinnamon-tpuwm@geraldo-netto/stylesheet.css"),
    "utf8",
);

function luminance(color) {
    const channels = color.map((channel) => {
        const value = channel / 255;
        return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
    });
    return (0.2126 * channels[0]) + (0.7152 * channels[1]) + (0.0722 * channels[2]);
}

function contrast(first, second) {
    const values = [luminance(first), luminance(second)].sort((left, right) => right - left);
    return (values[0] + 0.05) / (values[1] + 0.05);
}

function compositeNeutral(background, channel, alpha) {
    return background.map((value) => (channel * alpha) + (value * (1 - alpha)));
}

test("fuzz: neutral surfaces preserve readable light, dark, and high-contrast palettes", () => {
    const surfaces = [...stylesheet.matchAll(
        /background-color:\s*rgba\(\s*(\d+)\s*,\s*\1\s*,\s*\1\s*,\s*(0|1|0?\.\d+)\s*\)/giu,
    )].map((match) => ({channel: Number(match[1]), alpha: Number(match[2])}));
    assert.ok(surfaces.length > 0);

    const anchors = [
        {foreground: [32, 32, 32], background: [255, 255, 255]},
        {foreground: [240, 240, 240], background: [24, 24, 24]},
        {foreground: [255, 255, 255], background: [0, 0, 0]},
    ];
    let seed = 0x58545055;
    const randomByte = () => {
        seed = (Math.imul(seed, 1_664_525) + 1_013_904_223) >>> 0;
        return seed & 0xff;
    };
    const perturb = (color) => color.map((channel) => (
        Math.max(0, Math.min(255, channel + ((randomByte() % 25) - 12)))
    ));

    for (let iteration = 0; iteration < 4_096; iteration += 1) {
        const anchor = anchors[iteration % anchors.length];
        const foreground = perturb(anchor.foreground);
        let background = perturb(anchor.background);
        assert.ok(contrast(foreground, background) >= 7, "generated theme must begin at AAA contrast");

        const depth = 1 + (randomByte() % 4);
        for (let layer = 0; layer < depth; layer += 1) {
            const surface = surfaces[randomByte() % surfaces.length];
            background = compositeNeutral(background, surface.channel, surface.alpha);
        }
        assert.ok(
            contrast(foreground, background) >= 4.5,
            `theme contrast fell below 4.5 at iteration ${iteration}`,
        );
    }
});
