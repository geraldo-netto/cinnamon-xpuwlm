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

// Not written out again: the packaging module already declares the payload's
// UUID, and a validator holding its own copy is a gate that agrees with itself
// while the release it checks disagrees.
const {UUID} = Package;
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
// Nothing the repository keeps for itself may appear inside the payload. This
// used to be two lists someone typed — thirteen directory names and five
// filenames — which is a rule that only knows the names it was told about: a
// repository-only directory added tomorrow leaked into the payload past a
// green gate, and so did any dot-directory but the two that were listed.
//
// Read off the repository root instead, minus the names the payload is
// declared to carry. `LICENSE` is the only one they genuinely share, and it is
// in the declared top level, so it excuses itself without the rule having to
// name it. `expectedTopLevel` is the payload's declaration rather than its
// contents — the contents are held to it a few lines below — so a leaked
// `scripts/` cannot excuse itself by being present.
function repositoryOnlyNames(targetRepositoryRoot, expectedTopLevel) {
    const shipped = new Set(expectedTopLevel);
    return new Set(fs.readdirSync(targetRepositoryRoot)
        .filter((name) => name !== "files" && !shipped.has(name)));
}

// The names no payload entry may take, whatever the repository root happens to
// hold today: a cache, a tool's scratch directory, a Python bytecode
// directory. Stated as a shape rather than as a list of the ones that exist.
function isPrivateName(name) {
    return name.startsWith(".") || name.startsWith("__");
}

function readJson(root, relativePath) {
    return JSON.parse(fs.readFileSync(path.join(root, relativePath), "utf8"));
}

function defaultRoots() {
    return {appletRoot, filesRoot, repositoryRoot};
}

// The same descent the packaging script makes, with this gate's own policy: an
// assertion rather than a throw, and directories named as well as files, since
// a repository-only directory leaking into the payload is exactly what the
// caller below looks for.
function payloadPaths(directory) {
    return Package.walkTree(directory, (entry, relativePath) => {
        assert.equal(entry.isSymbolicLink(), false, `Payload symlink is forbidden: ${relativePath}`);
        assert.equal(
            entry.isDirectory() || entry.isFile(),
            true,
            `Payload entry must be a regular file or directory: ${relativePath}`,
        );
    }, {directories: true});
}

function validatePayloadStructure({
    appletRoot: targetAppletRoot,
    expectedTopLevel = PAYLOAD_TOP_LEVEL,
    filesRoot: targetFilesRoot,
    repositoryRoot: targetRepositoryRoot,
}) {
    const filesEntries = fs.readdirSync(targetFilesRoot, {withFileTypes: true});
    assert.deepEqual(filesEntries.map((entry) => entry.name).sort(compareText), [UUID]);
    assert.equal(filesEntries[0].isDirectory(), true);
    assert.deepEqual(
        fs.readdirSync(targetAppletRoot).sort(compareText),
        [...expectedTopLevel].sort(compareText),
    );

    const repositoryOnly = repositoryOnlyNames(targetRepositoryRoot, expectedTopLevel);
    for (const relativePath of payloadPaths(targetAppletRoot)) {
        const segments = relativePath.split("/");
        for (const segment of segments) {
            assert.equal(
                repositoryOnly.has(segment),
                false,
                `Repository-only entry leaked into payload: ${relativePath}`,
            );
            assert.equal(
                isPrivateName(segment),
                false,
                `Private entry leaked into payload: ${relativePath}`,
            );
        }
        assert.equal(/\.(?:log|pyc|temp|tmp)$/u.test(relativePath), false);
    }
}

// Every JavaScript file the payload carries, at any depth, read off the tree.
// This used to be two directory listings — the root and `lib/`, one level each
// — while the packager ships via a recursive walk. A module one directory down
// was therefore syntax-checked by nothing, control-character-checked by
// nothing, loaded by no engine, and shipped to every desktop anyway. A walk
// checks the files that exist; a listing checks the level someone had in mind.
function productionJavaScriptFiles(targetAppletRoot) {
    return Package.payloadFiles(targetAppletRoot)
        .filter((relativePath) => relativePath.endsWith(".js"))
        .map((relativePath) => path.join(targetAppletRoot, relativePath));
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
    // The applet's own copy, which nothing else could reach: it is what names
    // the settings instance and prefixes every warning the helper logs, and it
    // cannot import the packaging module because Cinnamon loads it, so the
    // literal is read out of the source and held to the same name.
    assert.equal(
        appletUuid(appletSource(targetAppletRoot)),
        metadata.uuid,
        "applet.js names a UUID the payload does not carry",
    );
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

function appletUuid(source) {
    const match = /^const UUID = "([^"]+)";$/mu.exec(source);
    assert.ok(match, "applet.js no longer declares UUID");
    return match[1];
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
    // The measured set, not the thresholds. A threshold only applies to the
    // files the include list names, and that list named four of the twelve
    // JavaScript sources this repository owns — the other five, the coverage
    // gate's own script among them, were unmeasured and nothing said so. Named
    // by glob so a new module under either root is measured the day it lands.
    for (const included of [
        "--include='files/cinnamon-xpuwlm@geraldo-netto/applet.js'",
        "--include='files/cinnamon-xpuwlm@geraldo-netto/lib/**/*.js'",
        "--include='scripts/**/*.js'",
    ]) {
        assert.equal(
            packageJson.scripts["test:coverage"].includes(included),
            true,
            `The coverage gate no longer measures ${included}`,
        );
    }
    assert.equal(packageJson.scripts["test:contract"], "node --test tests/contract/*.test.js");
    assert.equal(packageJson.scripts["test:visual"], "node --test tests/visual/*.test.js");
    // The smoke is handed the payload root and descends it. It used to be
    // handed `applet.js` and `lib/*.js` — one level of a tree the packager
    // walks — so a module one directory down was named by no glob and compiled
    // by no engine. A glob here is the finding, not an implementation detail:
    // it means the command is naming a level again.
    const cjsCommand = packageJson.scripts["test:cjs"];
    for (const fragment of ["tests/cjs/production-smoke.js", `files/${UUID}`]) {
        assert.equal(
            cjsCommand.includes(fragment),
            true,
            `The CJS smoke command no longer names ${fragment}`,
        );
    }
    assert.equal(
        cjsCommand.includes("*"),
        false,
        "The CJS smoke command globs a directory level instead of naming the payload root",
    );
    assert.equal(packageJson.scripts["test:local"], "XPUWLM_SKIP_HOST_GATES=1 npm test");
    return true;
}

// A gate only reports on the files it is handed, and every runner here is
// handed a glob written by hand. Nothing derived that the two agree, so a new
// `tests/<kind>/` directory was executed by no script and reported by nothing:
// its tests neither passed nor failed, they simply did not run.
//
// So the tree is walked and the globs are expanded, and the two sets have to be
// the same one. Both directions: a test file no runner names never runs, and a
// glob that matches nothing is a stage that reports success over an empty set.
const TEST_SUFFIX = ".test.js";

function globPattern(glob) {
    const source = glob.split("**")
        .map((part) => part.replace(/[.+^${}()|[\]\\]/gu, "\\$&").replace(/\*/gu, "[^/]*"))
        .join(".*");
    return new RegExp(`^${source}$`, "u");
}

function testFiles(targetRepositoryRoot) {
    return Package.walkTree(path.join(targetRepositoryRoot, "tests"), () => {})
        .filter((relativePath) => relativePath.endsWith(TEST_SUFFIX))
        .map((relativePath) => `tests/${relativePath}`);
}

function testGlobs(packageJson) {
    const globs = new Set();
    for (const command of Object.values(packageJson.scripts)) {
        for (const match of command.matchAll(/node --test ([^&|]+)/gu)) {
            for (const glob of match[1].trim().split(/\s+/u)) {
                globs.add(glob);
            }
        }
    }
    return [...globs].sort(compareText);
}

function validateTestWiring({repositoryRoot: targetRepositoryRoot}) {
    const globs = testGlobs(readJson(targetRepositoryRoot, "package.json"));
    assert.equal(globs.length > 0, true, "No repository script runs any test at all");
    const files = testFiles(targetRepositoryRoot);
    const patterns = globs.map((glob) => [glob, globPattern(glob)]);

    for (const relativePath of files) {
        assert.equal(
            patterns.some(([, pattern]) => pattern.test(relativePath)),
            true,
            `No repository script runs ${relativePath}`,
        );
    }
    for (const [glob, pattern] of patterns) {
        assert.equal(
            files.some((relativePath) => pattern.test(relativePath)),
            true,
            `A repository script reports success over an empty set: ${glob}`,
        );
    }
    return true;
}

function readWorkflow(root, name) {
    return fs.readFileSync(path.join(root, ".github/workflows", name), "utf8");
}

function workflowNames(root) {
    return fs.readdirSync(path.join(root, ".github/workflows")).sort(compareText);
}

// The rules that hold for every workflow in the directory, whichever ones are
// there. This gate used to open two files by name: a third workflow was read by
// nothing, so it could run `npm test`, set the host-gate escape hatch, fetch
// over plain HTTP or float an unpinned action with every gate here still green.
// The directory is enumerated instead, each file is held to these, and the two
// with rules of their own are named after that.
// Whole lines, comments dropped: a `uses:` key and a `curl` invocation are
// each written both as a step of their own and inside a run block, and a rule
// anchored to one indentation reads only the spelling its author had in mind.
function workflowLines(source) {
    return String(source).split("\n").filter((line) => !/^\s*#/u.test(line));
}

function validateWorkflowCommon(name, source) {
    assert.match(source, /^ {2}contents: read$/mu, `${name} does not drop write permissions`);
    assert.match(source, /run: npm ci --ignore-scripts$/mu, `${name} installs with scripts`);
    assert.doesNotMatch(
        source,
        /XPUWLM_SKIP_HOST_GATES/u,
        `${name} skips the host gates it exists to run`,
    );
    for (const line of workflowLines(source)) {
        const uses = /\buses:\s*(?<action>\S+)\s*$/u.exec(line);
        if (uses) {
            assert.match(
                uses.groups.action,
                /@[0-9a-f]{40}$/u,
                `${name} floats an unpinned action: ${uses.groups.action}`,
            );
        }
        if (/\bcurl\s/u.test(line)) {
            assert.match(
                line,
                /--proto '=https' --proto-redir '=https'/u,
                `${name} fetches without pinning the protocol: ${line.trim()}`,
            );
        }
    }
    return true;
}

// The workflows this gate has rules of its own for. A file appearing beside
// them is the finding: it is a job nobody wrote a rule for, and silence about
// it is what this list exists to prevent.
const KNOWN_WORKFLOWS = Object.freeze(["applet-quality.yml", "dependency-audit.yml"]);

function validateWorkflows({repositoryRoot: targetRepositoryRoot}) {
    const names = workflowNames(targetRepositoryRoot);
    assert.deepEqual(
        names,
        [...KNOWN_WORKFLOWS],
        "A workflow runs in CI that this gate has no rules for",
    );
    for (const name of names) {
        validateWorkflowCommon(name, readWorkflow(targetRepositoryRoot, name));
    }

    const quality = readWorkflow(targetRepositoryRoot, "applet-quality.yml");
    const audit = readWorkflow(targetRepositoryRoot, "dependency-audit.yml");

    assert.match(quality, /npm audit --omit=dev --audit-level=low/);
    assert.doesNotMatch(
        quality,
        /npm audit(?! --omit=dev)/,
        "Development-only advisories must not gate the applet build",
    );
    assert.match(quality, /run: npm run test:ci/);
    // The one gate `test:ci` cannot carry: it needs cjs, and the workflow
    // installs two pinned ones to run it. So the workflow is the only thing
    // that runs the check that loads production sources under Cinnamon's own
    // engine, and a step dropped from it takes that check with it silently.
    assert.match(quality, /run: npm run test:cjs$/mu);
    assert.doesNotMatch(quality, /run: npm test(?:\s|$)/mu);
    assert.doesNotMatch(quality, /XPUWLM_SKIP_HOST_GATES/);
    // The count this used to pin — two — is now the shared rule's business:
    // every `curl` line in every workflow is held to the pinned protocol,
    // however many of them there are.
    // A job installs what its gates use. The quality job's `test:ci` shells
    // out to `rsvg-convert` and `convert` for the icon raster gate and loads
    // no engine at all, so an apt line here naming `cjs` or `cinnamon` is a
    // step whose name claims the job exercises something it does not — the
    // engine check belongs to the job above, with its own pinned runtime.
    // Every apt line that is not the pinned engine install belongs to the
    // quality job, and there is one: the two renderers the icon raster gate
    // shells out to. It used to name `cinnamon` and `cjs` as well, under a
    // step called "Install Cinnamon theme test runtime", for a job whose gates
    // load neither.
    assert.deepEqual(
        [...quality.matchAll(/^ *sudo apt-get install (?<packages>.*)$/gmu)]
            .map((match) => match.groups.packages)
            .filter((packages) => !packages.includes("cjs") && !packages.endsWith("\\")),
        ["--yes --no-install-recommends imagemagick librsvg2-bin"],
    );

    assert.match(audit, /^ {2}schedule:$/mu);
    assert.match(audit, /^ {2}workflow_dispatch:$/mu);
    assert.match(audit, /run: npm audit --audit-level=low$/mu);
    assert.doesNotMatch(audit, /run: npm test/);
}

// A control character inside a string literal is invisible in a diff and
// accepted by every parser in this repository's reach, which is what makes it
// worth a gate of its own: nothing else is looking. This comment used to say
// SpiderMonkey refused it and that the cjs smoke had caught one, and neither
// is true of the engine Cinnamon ships today — fed a real BEL in a shipped
// `lib/` source, `cjs 115.1` compiles and loads the payload and `npm run
// test:cjs` exits 0. So this is not a cheap stand-in for a stronger check
// downstream; it is the only check. A byte the author cannot see, the diff
// does not show and the reviewer cannot review has no business in a source
// file that ships to desktops, whatever the parser tolerates.
//
// Tab, newline, and carriage return are the only control characters a source
// file may contain.
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
        `${filename}:${line} carries a control character no reviewer can see`,
    );
    return true;
}

// The host modules the payload must never reach for, asked of the module's
// own require edges rather than of its text. The rule used to be one regular
// expression naming three modules in one spelling: `require("node:fs")` was
// refused and `require( "node:fs" )` was not, and any module beyond those three
// was never named at all. The packaging script already resolves every static
// require in the payload and refuses a dynamic one, so the rule is asked of
// that resolution: nothing outside the applet, however it is spelled.
//
// `Buffer` is an ESLint rule now (`no-restricted-globals` over `files/**`),
// where it reads an identifier reference instead of a word: `\bBuffer\b`
// matched the word in a comment and missed nothing else.
function validateJavaScriptSyntax({appletRoot: targetAppletRoot}) {
    for (const filename of productionJavaScriptFiles(targetAppletRoot)) {
        childProcess.execFileSync(process.execPath, ["--check", filename], {stdio: "pipe"});
        const source = fs.readFileSync(filename, "utf8");
        const relativePath = path.relative(targetAppletRoot, filename).split(path.sep).join("/");
        for (const request of Package.sourceRequires(source, relativePath)) {
            assert.equal(
                request.startsWith("./") || request.startsWith("../"),
                true,
                `${relativePath} reaches outside the applet: ${request}`,
            );
        }
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

// The rules, without the prose around them. Both stylesheet gates used to read
// the whole file: the balance check counted a brace written into a comment as
// a rule that opened, and the status-colour check would have read a class name
// mentioned in one as a rule that exists. The shipped sheet opens with an
// eight-line comment, so this is one sentence away at any time.
const CSS_COMMENT = /\/\*[\s\S]*?\*\//gu;

function stylesheetDeclarations(css) {
    return String(css).replace(CSS_COMMENT, "");
}

function validateStylesheet(css) {
    const declarations = stylesheetDeclarations(css);
    assert.equal(
        (declarations.match(/\{/gu) || []).length,
        (declarations.match(/\}/gu) || []).length,
        "The stylesheet's rules do not balance",
    );
    assert.equal(declarations.includes("outline: none"), false);
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
    const styled = [...stylesheetDeclarations(css).matchAll(PANEL_STATUS_CLASS)]
        .map((match) => match[1]);
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
    validateTestWiring(roots);
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
    appletUuid,
    globPattern,
    testFiles,
    testGlobs,
    validateTestWiring,
    validateWorkflowCommon,
    workflowNames,
    isPrivateName,
    repositoryOnlyNames,
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
    stylesheetDeclarations,
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
