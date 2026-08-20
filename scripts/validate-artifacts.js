"use strict";

const assert = require("node:assert/strict");
const childProcess = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const {compareText} = require("./lib/compare-text.js");
// The packaging module owns the payload's release rules, and the two the
// validator needs are its own: what a PNG header has to be, and what a Spice
// release has to carry. Written out again here they were two rules with one
// subject — one of them accepting a header the other refused.
const Package = require("./package-applet.js");

const UUID = "cinnamon-xpuwlm@geraldo-netto";
const repositoryRoot = path.resolve(__dirname, "..");
const filesRoot = path.join(repositoryRoot, "files");
const appletRoot = path.join(filesRoot, UUID);

const PAYLOAD_TOP_LEVEL = Object.freeze([
    "applet.js",
    "icon.png",
    "icons",
    "lib",
    "LICENSE",
    "metadata.json",
    "settings-schema.json",
    "stylesheet.css",
]);
const FORBIDDEN_PAYLOAD_SEGMENTS = new Set([
    ".cache",
    ".stryker-tmp",
    "__pycache__",
    "build",
    "coverage",
    "design",
    "dist",
    "mutation-report",
    "node_modules",
    "prototype",
    "prototypes",
    "scripts",
    "tests",
]);
const FORBIDDEN_PAYLOAD_FILES = new Set([
    ".gitignore",
    "eslint.config.cjs",
    "package-lock.json",
    "package.json",
    "stryker.config.cjs",
]);

function readJson(root, relativePath) {
    return JSON.parse(fs.readFileSync(path.join(root, relativePath), "utf8"));
}

function defaultRoots() {
    return {appletRoot, filesRoot, repositoryRoot};
}

function payloadPaths(directory, prefix = "") {
    const paths = [];
    for (const entry of fs.readdirSync(directory, {withFileTypes: true})) {
        const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
        assert.equal(entry.isSymbolicLink(), false, `Payload symlink is forbidden: ${relativePath}`);
        assert.equal(
            entry.isDirectory() || entry.isFile(),
            true,
            `Payload entry must be a regular file or directory: ${relativePath}`,
        );
        paths.push(relativePath);
        if (entry.isDirectory()) {
            paths.push(...payloadPaths(path.join(directory, entry.name), relativePath));
        }
    }
    return paths;
}

function validatePayloadStructure({
    appletRoot: targetAppletRoot,
    expectedTopLevel = PAYLOAD_TOP_LEVEL,
    filesRoot: targetFilesRoot,
}) {
    const filesEntries = fs.readdirSync(targetFilesRoot, {withFileTypes: true});
    assert.deepEqual(filesEntries.map((entry) => entry.name).sort(compareText), [UUID]);
    assert.equal(filesEntries[0].isDirectory(), true);
    assert.deepEqual(
        fs.readdirSync(targetAppletRoot).sort(compareText),
        [...expectedTopLevel].sort(compareText),
    );

    for (const relativePath of payloadPaths(targetAppletRoot)) {
        const segments = relativePath.split("/");
        assert.equal(
            segments.some((segment) => FORBIDDEN_PAYLOAD_SEGMENTS.has(segment)),
            false,
            `Repository-only directory leaked into payload: ${relativePath}`,
        );
        assert.equal(
            FORBIDDEN_PAYLOAD_FILES.has(segments.at(-1)),
            false,
            `Repository-only file leaked into payload: ${relativePath}`,
        );
        assert.equal(/\.(?:log|pyc|temp|tmp)$/u.test(relativePath), false);
    }
}

function productionJavaScriptFiles(targetAppletRoot) {
    const rootModules = fs.readdirSync(targetAppletRoot)
        .filter((name) => name.endsWith(".js"))
        .map((name) => path.join(targetAppletRoot, name));
    const libraryDirectory = path.join(targetAppletRoot, "lib");
    const libraries = fs.readdirSync(libraryDirectory)
        .filter((name) => name.endsWith(".js"))
        .map((name) => path.join(libraryDirectory, name));
    return [...rootModules, ...libraries];
}

// Four contracts used to be asserted by one function called "JSON
// validation", which named the file it read rather than the promise it broke.
// Each is now its own validator, so a failure says which agreement was
// abandoned: the payload's identity, the settings default, the shipped
// catalogue, or the repository's own scripts.
function validatePayloadMetadata({
    appletRoot: targetAppletRoot,
    repositoryRoot: targetRepositoryRoot,
}) {
    const metadata = readJson(targetAppletRoot, "metadata.json");
    const packageJson = readJson(targetRepositoryRoot, "package.json");

    assert.equal(metadata.uuid, UUID);
    assert.equal(metadata.uuid, path.basename(targetAppletRoot));
    assert.equal(packageJson.version, metadata.version);
    assert.equal(metadata["max-instances"], 1);
    assert.ok(metadata["cinnamon-version"].includes("6.6"));
    // The helper ships no schema copies. It reads six fields out of the
    // published snapshot to draw an icon; the client validates the document
    // against the canonical schemas, and mirroring them here is exactly the
    // drift this split removed.
    assert.equal(
        fs.readdirSync(targetAppletRoot).some((name) => name.endsWith(".schema.json")),
        false,
        "The helper must not ship mirrored contract schemas",
    );
    return true;
}

// The applet cannot be required here — it reads Cinnamon's `imports` at load
// — so the two facts this gate needs from it are read out of the source: the
// bounds it clamps a refresh to, and the keys it binds.
function appletSource(targetAppletRoot) {
    return fs.readFileSync(path.join(targetAppletRoot, "applet.js"), "utf8");
}

function appletConstant(source, name) {
    const match = new RegExp(`^const ${name} = (\\d+);$`, "mu").exec(source);
    assert.ok(match, `applet.js no longer declares ${name}`);
    return Number(match[1]);
}

function boundSettingsKeys(source) {
    const keys = [...source.matchAll(/this\.settings\.bind\(\s*"([^"]+)"/gu)]
        .map((match) => match[1]);
    assert.equal(keys.length > 0, true, "The applet binds no settings key at all");
    return keys.sort(compareText);
}

// Cinnamon's display-only widgets: they draw, they store nothing, and no xlet
// binds them. Every other type carries a value the applet has to read for the
// control to do anything.
const DISPLAY_SETTING_TYPES = new Set(["button", "label", "separator"]);

// The shipped default and the reader's constant are one fact in two files: a
// panel whose default names a path the reader would not have read draws an
// idle desk on a working runtime. The refresh bounds are the same shape of
// fact — a schema maximum above the applet's clamp is a slider that stops
// having an effect partway along.
function validateSettingsAgreement({appletRoot: targetAppletRoot}) {
    const settings = readJson(targetAppletRoot, "settings-schema.json");
    const source = appletSource(targetAppletRoot);

    // No panel text at all: a setting that could put a word back in the tray
    // would be a setting to keep working for a surface that no longer exists.
    assert.equal(Object.hasOwn(settings, "show-panel-label"), false);
    assert.equal(
        settings["runtime-state-path"].default,
        require(path.join(targetAppletRoot, "lib/snapshot-reader.js")).RUNTIME_STATE_PATH,
    );

    const refresh = settings["refresh-interval"];
    assert.equal(refresh.min, appletConstant(source, "MIN_REFRESH_SECONDS"));
    assert.equal(refresh.max, appletConstant(source, "MAX_REFRESH_SECONDS"));
    assert.equal(refresh.default, appletConstant(source, "DEFAULT_REFRESH_SECONDS"));

    const bound = new Set(boundSettingsKeys(source));
    for (const key of bound) {
        assert.equal(
            Object.hasOwn(settings, key),
            true,
            `The applet binds a key the schema does not declare: ${key}`,
        );
    }
    // And the other direction, which nothing asked about: a key that ships,
    // shows a control and is bound by nothing is a setting the person moves
    // while the panel goes on reading the value it was built with.
    for (const [key, definition] of Object.entries(settings)) {
        if (key === "layout" || DISPLAY_SETTING_TYPES.has(definition.type)) {
            continue;
        }
        assert.equal(
            bound.has(key),
            true,
            `The schema declares a value key the applet never binds: ${key}`,
        );
    }
    return true;
}

// The other half of the round trip. Cinnamon resolves the layout by name, and
// a page, section or key that does not resolve is not an error it reports — it
// is a settings window drawn empty.
function validateSettingsLayout({appletRoot: targetAppletRoot}) {
    const settings = readJson(targetAppletRoot, "settings-schema.json");
    const {layout} = settings;
    const listed = new Set();

    assert.equal(Array.isArray(layout.pages) && layout.pages.length > 0, true);
    for (const pageName of layout.pages) {
        const page = layout[pageName];
        assert.ok(page, `The layout names a page it does not declare: ${pageName}`);
        assert.equal(page.type, "page");
        for (const sectionName of page.sections) {
            const section = layout[sectionName];
            assert.ok(section, `The layout names a section it does not declare: ${sectionName}`);
            assert.equal(section.type, "section");
            for (const key of section.keys) {
                assert.equal(
                    Object.hasOwn(settings, key),
                    true,
                    `The layout names a key the schema does not declare: ${key}`,
                );
                listed.add(key);
            }
        }
    }

    // And nothing shipped that no page shows: a key outside the layout is a
    // setting the person cannot reach and the applet still reads.
    for (const key of Object.keys(settings)) {
        assert.equal(
            key === "layout" || listed.has(key),
            true,
            `The schema declares a key no page shows: ${key}`,
        );
    }
    return true;
}

// The gates only run if the scripts that run them are wired, so the wiring is
// itself an artifact: a stage silently dropped from `test:ci` is a gate that
// stops reporting rather than a gate that fails.
function validateRepositoryScripts({repositoryRoot: targetRepositoryRoot}) {
    const packageJson = readJson(targetRepositoryRoot, "package.json");

    assert.equal(packageJson.scripts["test:ci"], [
        "npm run lint",
        "npm run test:syntax",
        "npm run test:coverage",
        "npm run test:fuzz",
        "npm run test:visual",
    ].join(" && "));
    assert.equal(packageJson.scripts.test.includes("test:visual"), true);
    assert.equal(packageJson.scripts["test:contract"], "node --test tests/contract/*.test.js");
    assert.equal(packageJson.scripts["test:visual"], "node --test tests/visual/*.test.js");
    assert.equal(packageJson.scripts["test:local"], "XPUWLM_SKIP_HOST_GATES=1 npm test");
    return true;
}

function readWorkflow(root, name) {
    return fs.readFileSync(path.join(root, ".github/workflows", name), "utf8");
}

function validateWorkflows({repositoryRoot: targetRepositoryRoot}) {
    const quality = readWorkflow(targetRepositoryRoot, "applet-quality.yml");
    const audit = readWorkflow(targetRepositoryRoot, "dependency-audit.yml");

    assert.match(quality, /npm audit --omit=dev --audit-level=low/);
    assert.doesNotMatch(
        quality,
        /npm audit(?! --omit=dev)/,
        "Development-only advisories must not gate the applet build",
    );
    assert.match(quality, /run: npm run test:ci/);
    assert.doesNotMatch(quality, /run: npm test(?:\s|$)/mu);
    assert.doesNotMatch(quality, /XPUWLM_SKIP_HOST_GATES/);
    assert.equal(
        [...quality.matchAll(/curl --fail --location --proto '=https' --proto-redir '=https'/gu)].length,
        2,
    );
    assert.match(quality, /run: npm ci --ignore-scripts$/mu);

    assert.match(audit, /^ {2}schedule:$/mu);
    assert.match(audit, /^ {2}workflow_dispatch:$/mu);
    assert.match(audit, /run: npm audit --audit-level=low$/mu);
    assert.match(audit, /run: npm ci --ignore-scripts$/mu);
    assert.doesNotMatch(audit, /run: npm test/);
}

// A control character inside a string literal is invisible in a diff, accepted
// by Node, and refused by the SpiderMonkey parser Cinnamon actually runs — so
// it ships a module the desktop cannot load while every Node test passes. One
// reached a shipped source this way; the cjs smoke caught it, but that gate is
// not part of `test:ci` and needs cjs installed, so the cheap check runs here.
// Tab, newline, and carriage return are the only control characters a source
// file may contain; everything else below 0x20 is invisible in a diff and
// refused by the parser Cinnamon runs.
const PERMITTED_CONTROL_CODES = new Set([9, 10, 13]);

function controlCharacterLine(source) {
    let line = 1;
    for (const character of source) {
        const code = character.codePointAt(0);
        if (code === 10) {
            line += 1;
        } else if (code < 0x20 && !PERMITTED_CONTROL_CODES.has(code)) {
            return line;
        }
    }
    return 0;
}

function validateSourceControls(source, filename) {
    const line = controlCharacterLine(source);
    assert.equal(
        line,
        0,
        `${filename}:${line} carries a control character Cinnamon's parser refuses`,
    );
    return true;
}

function validateJavaScriptSyntax({appletRoot: targetAppletRoot}) {
    for (const filename of productionJavaScriptFiles(targetAppletRoot)) {
        childProcess.execFileSync(process.execPath, ["--check", filename], {stdio: "pipe"});
        const source = fs.readFileSync(filename, "utf8");
        assert.equal(/require\(["'](?:node:)?(?:fs|child_process|path)["']\)/.test(source), false);
        assert.equal(/\bBuffer\b/.test(source), false);
        validateSourceControls(source, filename);
    }
}

// Square, because it is drawn as one: Cinnamon scales the applet icon to a
// box, and a non-square source is scaled unevenly or letterboxed. The header
// itself is read by the packaging module's parser.
function validatePngIcon(png) {
    const {width, height} = Package.pngDimensions(png);
    assert.equal(width, height, "The payload icon must be square");
    return true;
}

function validateSvgIcon(svg) {
    assert.match(svg, /^<svg[^>]*viewBox="0 0 16 16"[^>]*>[\s\S]*<\/svg>\s*$/);
    assert.doesNotMatch(svg, /<(?:script|style|text|image)\b/i);
    return true;
}

function validateStylesheet(css) {
    assert.equal((css.match(/{/g) || []).length, (css.match(/}/g) || []).length);
    assert.equal(css.includes("outline: none"), false);
    return true;
}

// The icons the payload actually carries, rather than a list written out
// beside them: a list only holds the icons someone remembered to add to it, so
// a new icon shipped to every user unvalidated and a renamed one failed as a
// bare ENOENT rather than as the correspondence it broke.
function payloadIconNames(targetAppletRoot) {
    return fs.readdirSync(path.join(targetAppletRoot, "icons")).sort(compareText);
}

function panelStatusModule(targetAppletRoot) {
    return require(path.join(targetAppletRoot, "lib/panel-status.js"));
}

// The one correspondence the panel cannot draw without: every status
// `panelIconName` can return has to name a file the payload ships. Asked of
// the module itself, so a status added there is a status this gate demands.
function requiredIconNames(targetAppletRoot) {
    const panelStatus = panelStatusModule(targetAppletRoot);
    return panelStatus.PANEL_STATUSES
        .map((status) => `${panelStatus.panelIconName(status)}.svg`)
        .sort(compareText);
}

// The other half of that correspondence, and the half nothing asked about.
// The applet puts `xpuwlm-panel-<status>` on its panel actor and the
// stylesheet is the only thing that colours it, so a status shipping without
// a rule draws in the symbolic fallback grey the stylesheet's own comment
// describes — nearly the panel background on a dark theme. Asked in both
// directions, because a rule for a status the panel can no longer ask for is a
// declaration nobody can see is dead.
const PANEL_STATUS_CLASS = /\.xpuwlm-panel-([a-z][a-z-]*)\b/gu;

function styledStatuses(css) {
    const styled = [...String(css).matchAll(PANEL_STATUS_CLASS)].map((match) => match[1]);
    return [...new Set(styled)].sort(compareText);
}

function validateStatusColours(css, statuses) {
    assert.deepEqual(
        styledStatuses(css),
        [...statuses].sort(compareText),
        "Every panel status needs its own colour rule, and every rule a status",
    );
    return true;
}

function validateStaticAssets({
    appletRoot: targetAppletRoot,
    repositoryRoot: targetRepositoryRoot,
}) {
    const iconNames = payloadIconNames(targetAppletRoot);
    assert.equal(iconNames.length > 0, true, "The payload must ship its status icons");
    for (const required of requiredIconNames(targetAppletRoot)) {
        assert.equal(
            iconNames.includes(required),
            true,
            `The panel can ask for an icon the payload does not ship: ${required}`,
        );
    }
    const css = fs.readFileSync(path.join(targetAppletRoot, "stylesheet.css"), "utf8");
    const png = fs.readFileSync(path.join(targetAppletRoot, "icon.png"));
    validatePngIcon(png);
    for (const iconName of iconNames) {
        assert.equal(
            iconName.endsWith(".svg"),
            true,
            `The payload's icon directory carries a file that is not an icon: ${iconName}`,
        );
        const svg = fs.readFileSync(path.join(targetAppletRoot, "icons", iconName), "utf8");
        validateSvgIcon(svg);
    }
    validateStylesheet(css);
    validateStatusColours(css, panelStatusModule(targetAppletRoot).PANEL_STATUSES);
    const spice = Package.inspectSpiceSources(targetRepositoryRoot, targetAppletRoot);
    assert.equal(spice.info.author, "geraldo-netto");
    assert.equal(spice.info.license, "MIT");
}

function validateArtifacts(roots) {
    validatePayloadStructure(roots);
    validatePayloadMetadata(roots);
    validateSettingsAgreement(roots);
    validateSettingsLayout(roots);
    validateRepositoryScripts(roots);
    validateWorkflows(roots);
    validateJavaScriptSyntax(roots);
    validateStaticAssets(roots);
    return true;
}

function main(roots = defaultRoots(), logger = console) {
    validateArtifacts(roots);
    logger.log("artifact validation: pass");
    return true;
}

if (require.main === module) {
    main();
}

module.exports = {
    boundSettingsKeys,
    compareText,
    controlCharacterLine,
    defaultRoots,
    main,
    payloadIconNames,
    payloadPaths,
    productionJavaScriptFiles,
    requiredIconNames,
    readJson,
    styledStatuses,
    readWorkflow,
    validateArtifacts,
    validateJavaScriptSyntax,
    validatePayloadMetadata,
    validatePayloadStructure,
    validateRepositoryScripts,
    validateSettingsAgreement,
    validateSettingsLayout,
    validatePngIcon,
    validateSourceControls,
    validateStaticAssets,
    validateStatusColours,
    validateStylesheet,
    validateSvgIcon,
    validateWorkflows,
};
