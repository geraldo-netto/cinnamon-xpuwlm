"use strict";

const assert = require("node:assert/strict");
const childProcess = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const ROOT = path.resolve(__dirname, "../../files/cinnamon-tpuwm@geraldo-netto");
const stylesheetPath = path.join(ROOT, "stylesheet.css");
const stylesheet = fs.readFileSync(stylesheetPath, "utf8");
const RGB_COLOR = /rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)(?:\s*,\s*(?:0|1|0?\.\d+))?\s*\)/giu;

const ST_MATRIX_SCRIPT = String.raw`
const St = imports.gi.St;
const GObject = imports.gi.GObject;
const [appletStylesheet, themeStylesheet, defaultStylesheet] = ARGV;
const theme = St.Theme.new(appletStylesheet, themeStylesheet, defaultStylesheet);
const context = St.ThemeContext.new();
context.set_theme(theme);

function node(parent, type, classes, pseudoClass = null, id = null) {
    return St.ThemeNode.new(context, parent, parent ? null : theme, type, id, classes, pseudoClass, " ", false);
}

function color(value) {
    return [value.red, value.green, value.blue, value.alpha];
}

function geometry(value) {
    return [St.Side.TOP, St.Side.RIGHT, St.Side.BOTTOM, St.Side.LEFT]
        .map((side) => [value.get_border_width(side), value.get_padding(side)]);
}

const stage = node(null, GObject.TYPE_NONE, null);
const menu = node(stage, St.Widget.$gtype, "menu");
const content = node(menu, St.BoxLayout.$gtype, "popup-menu-content");
const appletRoot = node(content, St.BoxLayout.$gtype, "tpuwm-root");

function cue(classes, pseudoClass, side, type = St.Button.$gtype) {
    const value = node(appletRoot, type, classes, pseudoClass);
    return {
        foreground: color(value.get_foreground_color()),
        background: color(value.get_background_color()),
        border: color(value.get_border_color(side)),
        width: value.get_border_width(side),
    };
}

const panel = node(stage, St.Widget.$gtype, "panel-top", null, "panel");
const normalApplet = node(panel, St.BoxLayout.$gtype, "applet-box tpuwm-panel-online");
const attentionApplet = node(panel, St.BoxLayout.$gtype, "applet-box tpuwm-panel-attention");

print(JSON.stringify({
    surfaces: [menu, content, appletRoot].map((value) => color(value.get_background_color())),
    cues: {
        focus: cue("tpuwm-secondary-button", "focus", St.Side.TOP),
        tab: cue("tpuwm-tab tpuwm-tab-active", null, St.Side.BOTTOM),
        toggle: cue("tpuwm-toggle tpuwm-toggle-on", null, St.Side.LEFT),
        alert: cue("tpuwm-alert-card", null, St.Side.LEFT, St.BoxLayout.$gtype),
    },
    panel: {
        normalGeometry: geometry(normalApplet),
        attentionGeometry: geometry(attentionApplet),
    },
}));
`;

function ruleBody(selector) {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
    const match = stylesheet.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`, "u"));
    assert.ok(match, `${selector} rule must exist`);
    return match[1];
}

function composite(top, bottom) {
    const alpha = top[3] / 255;
    return [
        Math.round((top[0] * alpha) + (bottom[0] * (1 - alpha))),
        Math.round((top[1] * alpha) + (bottom[1] * (1 - alpha))),
        Math.round((top[2] * alpha) + (bottom[2] * (1 - alpha))),
        255,
    ];
}

function luminance(color) {
    const channels = color.slice(0, 3).map((channel) => {
        const value = channel / 255;
        return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
    });
    return (0.2126 * channels[0]) + (0.7152 * channels[1]) + (0.0722 * channels[2]);
}

function contrast(first, second) {
    const values = [luminance(first), luminance(second)].sort((left, right) => right - left);
    return (values[0] + 0.05) / (values[1] + 0.05);
}

function isExecutable(candidate) {
    try {
        fs.accessSync(candidate, fs.constants.X_OK);
        return true;
    } catch {
        return false;
    }
}

function findCjsExecutable() {
    const explicitCandidates = [
        process.env.TPUWM_CJS,
        "/usr/bin/cjs",
        "/usr/local/bin/cjs",
    ].filter(Boolean);
    const pathCandidates = (process.env.PATH ?? "")
        .split(path.delimiter)
        .filter(Boolean)
        .map((directory) => path.join(directory, "cjs"));
    const executable = [...new Set([...explicitCandidates, ...pathCandidates])]
        .find(isExecutable);
    assert.ok(executable, "Cinnamon cjs executable is required for the theme regression test");
    return executable;
}

function findCinnamonLibraries() {
    const configuredDirectories = [process.env.GI_TYPELIB_PATH, process.env.LD_LIBRARY_PATH]
        .filter(Boolean)
        .flatMap((value) => value.split(path.delimiter))
        .filter(Boolean);
    const libraryRoots = ["/usr/lib", "/usr/lib64", "/usr/local/lib", "/usr/local/lib64"];
    const candidates = new Set(configuredDirectories);

    for (const root of libraryRoots) {
        candidates.add(path.join(root, "cinnamon"));
        candidates.add(path.join(root, "muffin"));
        if (!fs.existsSync(root)) {
            continue;
        }
        for (const entry of fs.readdirSync(root, {withFileTypes: true})) {
            if (entry.isDirectory() || entry.isSymbolicLink()) {
                candidates.add(path.join(root, entry.name, "cinnamon"));
                candidates.add(path.join(root, entry.name, "muffin"));
            }
        }
    }

    const existingDirectories = [...candidates].filter((candidate) => {
        try {
            return fs.statSync(candidate).isDirectory();
        } catch {
            return false;
        }
    });
    assert.ok(
        existingDirectories.some((directory) => fs.existsSync(path.join(directory, "St-1.0.typelib"))),
        "Cinnamon St-1.0.typelib is required for the theme regression test",
    );
    return existingDirectories;
}

function findCinnamonRuntime() {
    return {
        executable: findCjsExecutable(),
        libraries: findCinnamonLibraries(),
    };
}

function renderThemeMatrix(themeStylesheet) {
    const runtime = findCinnamonRuntime();
    const output = childProcess.execFileSync(
        runtime.executable,
        ["-c", ST_MATRIX_SCRIPT, stylesheetPath, themeStylesheet, "/dev/null"],
        {
            encoding: "utf8",
            env: {
                ...process.env,
                GI_TYPELIB_PATH: [...runtime.libraries, process.env.GI_TYPELIB_PATH]
                    .filter(Boolean).join(path.delimiter),
                LD_LIBRARY_PATH: [...runtime.libraries, process.env.LD_LIBRARY_PATH]
                    .filter(Boolean).join(path.delimiter),
            },
        },
    );
    return JSON.parse(output);
}

test("regression: theme harness finds the mandatory Cinnamon runtime without host architecture tools", () => {
    const runtime = findCinnamonRuntime();
    assert.ok(isExecutable(runtime.executable));
    assert.ok(
        runtime.libraries.some((directory) => fs.existsSync(path.join(directory, "St-1.0.typelib"))),
    );
});

test("regression: applet colors remain neutral and use Cinnamon symbolic foregrounds", () => {
    assert.doesNotMatch(stylesheet, /[;{]\s*color\s*:/u);
    assert.doesNotMatch(stylesheet, /#[\da-f]{3,8}\b/iu);
    assert.doesNotMatch(stylesheet, /\b(?:hsl|hsla|lab|lch|oklab|oklch|color|color-mix)\s*\(/iu);

    const colors = [...stylesheet.matchAll(RGB_COLOR)];
    assert.ok(colors.length > 0, "neutral surfaces must remain explicit");
    for (const [, red, green, blue] of colors) {
        assert.equal(red, green, "explicit colors must have equal red and green channels");
        assert.equal(green, blue, "explicit colors must have equal green and blue channels");
    }

    const paintDeclarations = stylesheet.matchAll(
        /[;{]\s*(background(?:-color)?|border(?:-(?:top|right|bottom|left))?(?:-color|-width)?|outline(?:-color|-width)?|box-shadow|text-shadow)\s*:\s*([^;}]+)/giu,
    );
    for (const [, property, value] of paintDeclarations) {
        const unexplained = value
            .replace(RGB_COLOR, "")
            .replace(/\bsymbolic(?:-(?:warning|error|success))?\b/giu, "")
            .replace(/\b(?:solid|none|hidden|inset|outset|dashed|dotted|double)\b/giu, "")
            .replace(/[-+]?(?:\d*\.)?\d+(?:px|em|rem|%)?/giu, "")
            .replace(/[,/\s]/gu, "");
        assert.equal(unexplained, "", `${property} must not contain a hard-coded color`);
    }
});

test("regression: semantic and interaction states explicitly use the symbolic foreground", () => {
    assert.match(ruleBody(".tpuwm-status"), /font-weight:\s*bold/u);
    assert.match(ruleBody(".tpuwm-primary-button"), /font-weight:\s*bold/u);
    assert.match(ruleBody(".tpuwm-tab-active"), /border-bottom-width:\s*2px/u);
    assert.match(ruleBody(".tpuwm-tab-active"), /border-bottom-color:\s*symbolic/u);
    assert.match(ruleBody(".tpuwm-toggle-on"), /border-color:\s*symbolic/u);
    assert.match(ruleBody(".tpuwm-toggle-on"), /font-weight:\s*bold/u);
    assert.match(ruleBody(".tpuwm-alert-card"), /border-left-width:\s*3px/u);
    assert.match(ruleBody(".tpuwm-alert-card"), /border-left-color:\s*symbolic/u);
    assert.match(ruleBody(".tpuwm-history-mark"), /font-weight:\s*bold/u);
    assert.doesNotMatch(stylesheet, /\.tpuwm-panel-/u);
});

test("regression: St resolves visible cues in light, dark, and high-contrast palettes", () => {
    const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "tpuwm-theme-"));
    const palettes = [
        ["light", "#202020", "#ffffff"],
        ["dark", "#f0f0f0", "#181818"],
        ["high contrast", "#ffffff", "#000000"],
    ];
    try {
        for (const [name, foreground, background] of palettes) {
            const themePath = path.join(temporaryDirectory, `${name.replace(" ", "-")}.css`);
            fs.writeFileSync(themePath, [
                `stage { color: ${foreground}; }`,
                `.menu, .popup-menu-content, .panel-top { color: ${foreground}; background-color: ${background}; }`,
                `.applet-box { color: ${foreground}; }`,
            ].join("\n"));
            const matrix = renderThemeMatrix(themePath);
            let surface = [0, 0, 0, 255];
            for (const layer of matrix.surfaces) {
                surface = composite(layer, surface);
            }
            for (const [cueName, cue] of Object.entries(matrix.cues)) {
                const cueSurface = composite(cue.background, surface);
                assert.deepEqual(cue.border, cue.foreground, `${name} ${cueName} border must use foreground`);
                assert.ok(contrast(cue.border, cueSurface) >= 3, `${name} ${cueName} cue must reach 3:1`);
                assert.ok(contrast(cue.foreground, cueSurface) >= 4.5, `${name} ${cueName} text must reach 4.5:1`);
            }
            assert.deepEqual(
                matrix.panel.attentionGeometry,
                matrix.panel.normalGeometry,
                `${name} icon status must not change panel geometry`,
            );
        }
    } finally {
        fs.rmSync(temporaryDirectory, {recursive: true, force: true});
    }
});
