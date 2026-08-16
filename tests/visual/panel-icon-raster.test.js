"use strict";

const assert = require("node:assert/strict");
const childProcess = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const ICON_DIRECTORY = path.resolve(__dirname, "../../files/cinnamon-xpuwlm@geraldo-netto/icons");
const STATUSES = Object.freeze(["online", "detected", "attention", "paused", "unavailable"]);
const SIZES = Object.freeze([16, 20, 24, 32]);
const SKIP_HOST_GATES = process.env.XPUWLM_SKIP_HOST_GATES === "1" && !process.env.CI;
const HOST_GATE_OPTIONS = SKIP_HOST_GATES
    ? {skip: "XPUWLM_SKIP_HOST_GATES=1: icon raster gate skipped locally"}
    : {};
const THEMES = Object.freeze([
    {
        name: "light",
        background: [250, 250, 250],
        foreground: "#202124",
        success: "#137a3f",
        warning: "#925400",
        error: "#b3261e",
    },
    {
        name: "dark",
        background: [30, 30, 30],
        foreground: "#f2f2f2",
        success: "#63d99b",
        warning: "#ffc857",
        error: "#ff716c",
    },
    {
        // The status ink is the glyph's own semantic colour, not the theme's
        // foreground: GTK's symbolic recolouring rewrites `fill` and leaves
        // `stroke` alone, so a stroked chip painted in the foreground
        // placeholder stayed the placeholder — #2e3436, a shade off a dark
        // panel, leaving only the small status mark visible beside 32-pixel
        // neighbours. This theme washes the foreground out to prove the icon
        // no longer depends on it.
        name: "low-contrast-foreground",
        background: [250, 250, 250],
        foreground: "#fafafa",
        success: "#137a3f",
        warning: "#925400",
        error: "#b3261e",
    },
]);

function executable(candidates, required = true) {
    const pathCandidates = (process.env.PATH || "")
        .split(path.delimiter)
        .filter(Boolean)
        .flatMap((directory) => candidates.map((candidate) => path.join(directory, candidate)));
    const resolved = [...new Set([...candidates, ...pathCandidates])].find((candidate) => {
        try {
            fs.accessSync(candidate, fs.constants.X_OK);
            return true;
        } catch {
            return false;
        }
    });
    if (required) {
        assert.ok(resolved, `${candidates[0]} executable is required for icon raster tests`);
    }
    return resolved;
}

function themedSvg(status, theme) {
    return fs.readFileSync(path.join(ICON_DIRECTORY, `xpuwlm-status-${status}-symbolic.svg`), "utf8")
        .replaceAll("#2e3436", theme.foreground)
        .replaceAll("#33d17a", theme.success)
        .replaceAll("#ff7800", theme.warning)
        .replaceAll("#e01b24", theme.error);
}

function svgRenderer() {
    const rsvg = executable([process.env.XPUWLM_RSVG_CONVERT, "rsvg-convert"].filter(Boolean), false);
    return rsvg
        ? {command: rsvg, kind: "rsvg"}
        : {command: executable([process.env.XPUWLM_INKSCAPE, "inkscape"].filter(Boolean)), kind: "inkscape"};
}

function renderIcon(renderer, convert, directory, status, size, theme) {
    const svgPath = path.join(directory, `${status}-${size}-${theme.name}.svg`);
    const pngPath = path.join(directory, `${status}-${size}-${theme.name}.png`);
    fs.writeFileSync(svgPath, themedSvg(status, theme));
    const background = `rgb(${theme.background.join(",")})`;
    const arguments_ = renderer.kind === "rsvg"
        ? ["--width", `${size}`, "--height", `${size}`, "--background-color", background, "--output", pngPath, svgPath]
        : [
            svgPath,
            "--export-type=png",
            `--export-filename=${pngPath}`,
            `--export-width=${size}`,
            `--export-height=${size}`,
            `--export-background=${background}`,
            "--export-background-opacity=255",
        ];
    childProcess.execFileSync(renderer.command, arguments_, {stdio: "pipe"});
    const pixels = childProcess.execFileSync(convert, [pngPath, "rgba:-"]);
    assert.equal(pixels.length, size * size * 4);
    return pixels;
}

function inkMask(pixels, size, background) {
    const mask = [];
    for (let offset = 0; offset < pixels.length; offset += 4) {
        const distance = Math.abs(pixels[offset] - background[0])
            + Math.abs(pixels[offset + 1] - background[1])
            + Math.abs(pixels[offset + 2] - background[2]);
        mask.push(distance >= 48);
    }
    assert.equal(mask.length, size * size);
    return mask;
}

function hasInkNear(mask, size, xRatio, yRatio) {
    const centerX = Math.round(xRatio * (size - 1));
    const centerY = Math.round(yRatio * (size - 1));
    const radius = Math.max(1, Math.round(size / 16));
    for (let y = Math.max(0, centerY - radius); y <= Math.min(size - 1, centerY + radius); y += 1) {
        for (let x = Math.max(0, centerX - radius); x <= Math.min(size - 1, centerX + radius); x += 1) {
            if (mask[(y * size) + x]) {
                return true;
            }
        }
    }
    return false;
}

function maskDifference(first, second) {
    let difference = 0;
    for (let index = 0; index < first.length; index += 1) {
        if (first[index] !== second[index]) {
            difference += 1;
        }
    }
    return difference;
}

test("regression: real 16, 20, and 24 pixel renders retain bounds and distinct landmarks", HOST_GATE_OPTIONS, () => {
    const renderer = svgRenderer();
    const convert = executable([process.env.XPUWLM_CONVERT, "convert"].filter(Boolean));
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "xpuwlm-icon-raster-"));
    try {
        for (const theme of THEMES) {
            for (const size of SIZES) {
                const masks = new Map();
                for (const status of STATUSES) {
                    const mask = inkMask(renderIcon(renderer, convert, directory, status, size, theme), size, theme.background);
                    masks.set(status, mask);
                    assert.equal(mask.some(Boolean), true, `${theme.name} ${status} ${size}px is visible`);
                    for (const corner of [0, size - 1, size * (size - 1), (size * size) - 1]) {
                        assert.equal(mask[corner], false, `${theme.name} ${status} ${size}px keeps corner clearance`);
                    }
                    for (const [x, y] of [[0.5, 0], [0.5, 1], [0, 0.5], [1, 0.5], [0.5, 0.5]]) {
                        assert.equal(hasInkNear(mask, size, x, y), true, `${theme.name} ${status} ${size}px landmark ${x},${y}`);
                    }
                }
                for (let left = 0; left < STATUSES.length; left += 1) {
                    for (let right = left + 1; right < STATUSES.length; right += 1) {
                        const difference = maskDifference(masks.get(STATUSES[left]), masks.get(STATUSES[right]));
                        assert.ok(
                            difference >= Math.round(size / 4),
                            `${theme.name} ${size}px ${STATUSES[left]} and ${STATUSES[right]} remain distinct (${difference} mask pixels differ)`,
                        );
                    }
                }
            }
        }
    } finally {
        fs.rmSync(directory, {recursive: true, force: true});
    }
});
