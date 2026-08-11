"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const ICON_DIRECTORY = path.resolve(__dirname, "../../files/cinnamon-xpuwlm@geraldo-netto/icons");
const STATUS_PALETTES = Object.freeze({
    online: "success",
    detected: "warning",
    attention: "warning",
    paused: "warning",
    unavailable: "error",
});

function readIcon(name) {
    return fs.readFileSync(path.join(ICON_DIRECTORY, name), "utf8");
}

test("regression: every panel icon remains caller-labelled and themeable", () => {
    const symbolicFallbacks = new Set(["#2e3436", "#33d17a", "#ff7800", "#e01b24"]);
    const names = [
        "xpuwlm-symbolic.svg",
        "xpuwlm-symbolic-v2.svg",
        ...Object.keys(STATUS_PALETTES).map((status) => `xpuwlm-status-${status}-symbolic.svg`),
    ];
    for (const name of names) {
        const icon = readIcon(name);
        assert.match(icon, /^<svg[^>]*viewBox="0 0 16 16"[^>]*>[\s\S]*<\/svg>\s*$/u);
        assert.match(icon, /aria-hidden="true"/u);
        assert.match(icon, /focusable="false"/u);
        assert.doesNotMatch(icon, /<(?:script|style|text|image)\b/iu);
        for (const paint of icon.matchAll(/(?:fill|stroke)="(#[\da-f]{6})"/giu)) {
            assert.equal(symbolicFallbacks.has(paint[1].toLowerCase()), true, `${name} palette`);
        }
        assert.match(icon, /#2e3436/iu);
    }
});

test("regression: v2 panel icon preserves the compact TPU graph silhouette", () => {
    const icon = readIcon("xpuwlm-symbolic-v2.svg");
    assert.match(icon, /<rect id="chip-body"/u);
    assert.match(icon, /<path id="chip-pins"/u);
    assert.match(icon, /<path id="graph-links"/u);
    assert.match(icon, /<path id="graph-core"/u);
    assert.equal((icon.match(/<circle id="graph-node-/gu) || []).length, 4);
});

test("regression: status icons pair semantic palette with unique non-color glyphs", () => {
    const shapes = new Set();
    for (const [status, palette] of Object.entries(STATUS_PALETTES)) {
        const icon = readIcon(`xpuwlm-status-${status}-symbolic.svg`);
        const shape = icon.match(new RegExp(`<[^>]+id="status-${status}"[^>]*>`, "u"));
        assert.ok(shape, `${status} glyph is required`);
        assert.match(shape[0], new RegExp(`class="${palette}"`, "u"));
        assert.match(shape[0], /stroke="#2e3436"/u);
        assert.match(shape[0], /paint-order="stroke fill"/u);
        assert.match(icon, /<rect id="chip-body"/u);
        assert.match(icon, /<path id="chip-pins"/u);
        shapes.add(shape[0].replace(`id="status-${status}"`, "id=\"status\""));
    }
    assert.equal(shapes.size, Object.keys(STATUS_PALETTES).length);
});
