"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const ICON_DIRECTORY = path.resolve(__dirname, "../../files/cinnamon-xpuwlm@geraldo-netto/icons");
const APPLET_SOURCE = fs.readFileSync(path.resolve(
    __dirname,
    "../../files/cinnamon-xpuwlm@geraldo-netto/applet.js",
), "utf8");
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

test("regression: the panel resolves custom icons through Cinnamon's symbolic theme", () => {
    // By name, never by path: a path skips the theme, so the icon stops
    // following the desktop's symbolic colours.
    assert.doesNotMatch(APPLET_SOURCE, /set_applet_icon_symbolic_path/u);
    assert.match(
        APPLET_SOURCE,
        /set_applet_icon_symbolic_name\(PanelStatus\.panelIconName\(status\)\)/u,
    );
});

test("regression: every panel icon remains caller-labelled and themeable", () => {
    const symbolicFallbacks = new Set(["#2e3436", "#33d17a", "#ff7800", "#e01b24"]);
    const names = fs.readdirSync(ICON_DIRECTORY).filter((name) => name.endsWith(".svg"));
    assert.equal(names.length > 0, true);
    for (const name of names) {
        const icon = readIcon(name);
        assert.match(icon, /^<svg[^>]*viewBox="0 0 16 16"[^>]*>[\s\S]*<\/svg>\s*$/u);
        assert.match(icon, /aria-hidden="true"/u);
        assert.match(icon, /focusable="false"/u);
        assert.doesNotMatch(icon, /<(?:script|style|text|image)\b/iu);
        for (const paint of icon.matchAll(/(?:fill|stroke)="(#[\da-f]{6})"/giu)) {
            assert.equal(symbolicFallbacks.has(paint[1].toLowerCase()), true, `${name} palette`);
        }
    }
});

test("regression: v2 panel icon preserves the compact TPU graph silhouette", () => {
    const icon = readIcon("xpuwlm-v2-symbolic.svg");
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
        assert.match(shape[0], /paint-order="stroke fill"/u);
        assert.match(icon, /<rect id="chip-body"/u);
        assert.match(icon, /<path id="chip-pins"/u);
        shapes.add(shape[0].replace(`id="status-${status}"`, "id=\"status\""));
    }
    assert.equal(shapes.size, Object.keys(STATUS_PALETTES).length);
});
