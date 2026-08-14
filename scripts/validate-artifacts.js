"use strict";

const assert = require("node:assert/strict");
const Ajv2020 = require("ajv/dist/2020").default;
const childProcess = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const UUID = "cinnamon-xpuwlm@geraldo-netto";
const repositoryRoot = path.resolve(__dirname, "..");
const filesRoot = path.join(repositoryRoot, "files");
const appletRoot = path.join(filesRoot, UUID);
const PAYLOAD_TOP_LEVEL = Object.freeze([
    "applet.js",
    "artifact-qualification.js",
    "artifact-qualification.schema.json",
    "background-execution.js",
    "caption-export.js",
    "cinnamon-dbus-adapter.js",
    "cinnamon-host-adapter.js",
    "cinnamon-image-adapter.js",
    "cinnamon-platform-adapter.js",
    "cinnamon-runtime.js",
    "cinnamon-state-adapter.js",
    "cinnamon-workload-adapter.js",
    "clipboard-selection-port.js",
    "domain.js",
    "document-question.js",
    "document-source-port.js",
    "deterministic-action-port.js",
    "diagnostics-view-model.js",
    "event-import-error.js",
    "event-import.js",
    "event-source-port.js",
    "external-chooser-port.js",
    "file-auto-tagging.js",
    "file-categorization.js",
    "file-organizer.js",
    "generic-workflow-menu-view.js",
    "generic-workflow-surface.js",
    "failure-log-backoff.js",
    "failure-reporter.js",
    "image-duplicate-benchmark.js",
    "i18n.js",
    "ics-export.js",
    "icon.png",
    "icons",
    "job-submission.js",
    "LICENSE",
    "lib",
    "layout.js",
    "manager.js",
    "media-source-port.js",
    "media-preprocessing.js",
    "media-transcription.js",
    "menu-actor-utils.js",
    "menu-focus.js",
    "menu-render-host.js",
    "metadata.json",
    "panel-view-model.js",
    "path-port.js",
    "platform-guidance.js",
    "platform-ports.js",
    "po",
    "plugin-inventory.js",
    "popup-placement.js",
    "presentation-planning.js",
    "presentation-review.js",
    "rehearsal-briefing.js",
    "readiness-acceptance.js",
    "profile-blockers.js",
    "gio-file-adapter.js",
    "runtime-gateway.js",
    "runtime-job-contract.js",
    "runtime-job-gateway.js",
    "runtime-control-contract.js",
    "runtime-control-gateway.js",
    "runtime-control-service.js",
    "runtime-contract.js",
    "runtime-contract-gateway.js",
    "runtime-contract.schema.json",
    "runtime-command.schema.json",
    "runtime-acknowledgement.schema.json",
    "runtime-refusal-contract.js",
    "runtime-refusal.schema.json",
    "routine-recognition.js",
    "runtime-snapshot-contract.js",
    "runtime-snapshot-schema-validator.js",
    "runtime-snapshot.schema.json",
    "selected-text.js",
    "screenshot-assistant.js",
    "settings-schema.json",
    "snapshot-validator.js",
    "setup-view-model.js",
    "stylesheet.css",
    "tensor-encoder.js",
    "telemetry-window.js",
    "ui-preferences-repository.js",
    "validation.js",
    "view-model.js",
    "workflow-controller.js",
    "workflow-document-question-menu-view.js",
    "workflow-event-import-menu-view.js",
    "workflow-file-organizer-menu-view.js",
    "workflow-media-menu-view.js",
    "workflow-menu-view.js",
    "workflow-selected-text-menu-view.js",
    "workflow-shared-menu-view.js",
    "workflow-view-model.js",
    "workflow-wiring.js",
    "workload-manifest.js",
    "workload-manifest.schema.json",
    "workload-provenance.js",
    "workload-benchmark.js",
    "workload-registry.js",
    "workload-reconciliation.js",
    "workload-result.js",
    "workload-result.schema.json",
    "workload-runtime-controller.js",
    "workload-tensor-contract.js",
    "workloads",
    "linux-device-adapter.js",
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
    "stryker.config.json",
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
    assert.deepEqual(filesEntries.map((entry) => entry.name).sort(), [UUID]);
    assert.equal(filesEntries[0].isDirectory(), true);
    assert.deepEqual(fs.readdirSync(targetAppletRoot).sort(), [...expectedTopLevel].sort());

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

function validateJsonArtifacts({
    appletRoot: targetAppletRoot,
    repositoryRoot: targetRepositoryRoot,
}) {
    const metadata = readJson(targetAppletRoot, "metadata.json");
    const qualificationSchema = readJson(targetAppletRoot, "artifact-qualification.schema.json");
    const resultSchema = readJson(targetAppletRoot, "workload-result.schema.json");
    const settings = readJson(targetAppletRoot, "settings-schema.json");
    const schema = readJson(targetAppletRoot, "runtime-snapshot.schema.json");
    const workloadSchema = readJson(targetAppletRoot, "workload-manifest.schema.json");
    const commandSchema = readJson(targetAppletRoot, "runtime-command.schema.json");
    const acknowledgementSchema = readJson(targetAppletRoot, "runtime-acknowledgement.schema.json");
    const refusalSchema = readJson(targetAppletRoot, "runtime-refusal.schema.json");
    const contractSchema = readJson(targetAppletRoot, "runtime-contract.schema.json");
    const packageJson = readJson(targetRepositoryRoot, "package.json");
    const stryker = readJson(targetRepositoryRoot, "stryker.config.json");
    const Domain = require(path.join(targetAppletRoot, "lib/domain.js"));
    const Manifest = require(path.join(targetAppletRoot, "lib/workload-manifest.js"));
    const Registry = require(path.join(targetAppletRoot, "lib/workload-registry.js"));

    assert.equal(metadata.uuid, UUID);
    assert.equal(metadata.uuid, path.basename(targetAppletRoot));
    assert.equal(packageJson.version, metadata.version);
    assert.equal(metadata["max-instances"], 1);
    assert.ok(metadata["cinnamon-version"].includes("6.6"));
    assert.equal(schema.properties.version.const, Domain.SNAPSHOT_VERSION);
    assert.equal(schema.properties.generatedAt.minimum, Domain.MIN_GENERATED_AT);
    assert.doesNotThrow(() => new Ajv2020({strict: true}).compile(schema));
    assert.doesNotThrow(() => new Ajv2020({strict: true}).compile(qualificationSchema));
    assert.doesNotThrow(() => new Ajv2020({strict: true}).compile(resultSchema));
    assert.doesNotThrow(() => new Ajv2020({strict: true}).compile(workloadSchema));
    assert.doesNotThrow(() => new Ajv2020({strict: true}).compile(commandSchema));
    assert.doesNotThrow(() => new Ajv2020({strict: true}).compile(acknowledgementSchema));
    assert.doesNotThrow(() => new Ajv2020({strict: true}).compile(refusalSchema));
    assert.doesNotThrow(() => new Ajv2020({strict: true}).compile(contractSchema));
    // The predicate and the mirrored schema must agree on the bounds, or a
    // document one accepts is a document the other rejects.
    const Contract = require(path.join(targetAppletRoot, "lib/runtime-contract.js"));
    assert.equal(contractSchema.properties.version.const, Contract.CONTRACT_DOCUMENT_VERSION);
    assert.equal(contractSchema.properties.methods.maxItems, Contract.MAX_METHODS);
    assert.equal(contractSchema.properties.schemas.maxProperties, Contract.MAX_CONTRACTS);
    assert.equal(
        contractSchema.properties.schemas.additionalProperties.maximum,
        Contract.MAX_CONTRACT_VERSION,
    );
    assert.deepEqual(
        refusalSchema.properties.code.enum,
        [...require(path.join(targetAppletRoot, "lib/runtime-refusal-contract.js")).REFUSAL_CODES],
    );
    assert.equal(settings["show-panel-label"].default, false);
    assert.deepEqual(settings["profile-state"].default.profiles, {});
    assert.equal(schema.properties.metrics.properties.runningProfiles.maximum, Registry.MAX_WORKLOADS);
    const workloadDirectories = fs.readdirSync(path.join(targetAppletRoot, "workloads"), {
        withFileTypes: true,
    });
    assert.equal(workloadDirectories.length > 0, true);
    for (const entry of workloadDirectories) {
        assert.equal(entry.isDirectory(), true, `Workload must be a directory: ${entry.name}`);
        const manifest = readJson(targetAppletRoot, `workloads/${entry.name}/manifest.json`);
        assert.equal(new Manifest.WorkloadDescriptor(manifest).id, entry.name);
    }
    const potFile = fs.readFileSync(path.join(targetAppletRoot, "po", `${UUID}.pot`), "utf8");
    assert.match(potFile, /"Content-Type: text\/plain; charset=UTF-8\\n"/u);
    assert.equal(potFile.includes(`Project-Id-Version: ${UUID}`), true);
    assert.equal(packageJson.scripts.test.includes("test:mutation"), true);
    assert.equal(packageJson.scripts["test:ci"], [
        "npm run lint",
        "npm run test:syntax",
        // The validator's vocabulary is generated from the shipped schema, so
        // a stale derived file has to fail before anything runs against it.
        "npm run check:contract",
        "npm run check:workloads",
        "npm run test:coverage",
        "npm run test:fuzz",
        "npm run test:visual",
    ].join(" && "));
    assert.equal(packageJson.scripts["test:ci"].includes("test:mutation"), false);
    assert.equal(packageJson.scripts.test.includes("test:visual"), true);
    assert.equal(packageJson.scripts.test.includes("check:workloads"), true);
    assert.equal(packageJson.scripts["test:contract"], "node --test tests/contract/*.test.js");
    assert.equal(packageJson.devDependencies.ajv, "8.18.0");
    assert.equal(packageJson.scripts["test:visual"], "node --test tests/visual/*.test.js");
    assert.equal(packageJson.scripts["test:mutation-target"].includes("tests/visual"), false);
    assert.equal(packageJson.scripts["test:local"], "XPUWLM_SKIP_HOST_GATES=1 npm test");
    assert.equal(stryker.thresholds.break >= 80, true);
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

    assert.match(audit, /^ {2}schedule:$/mu);
    assert.match(audit, /^ {2}workflow_dispatch:$/mu);
    assert.match(audit, /run: npm audit --audit-level=low$/mu);
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

function validatePngIcon(png) {
    assert.deepEqual(png.subarray(0, 8), Buffer.from("89504e470d0a1a0a", "hex"));
    assert.equal(png.subarray(12, 16).toString("ascii"), "IHDR");
    assert.equal(png.readUInt32BE(16), png.readUInt32BE(20));
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

function validateStaticAssets({
    appletRoot: targetAppletRoot,
    repositoryRoot: targetRepositoryRoot,
}) {
    const iconNames = [
        "xpuwlm-symbolic.svg",
        "xpuwlm-v2-symbolic.svg",
        "xpuwlm-device-symbolic.svg",
        "xpuwlm-sliders-symbolic.svg",
        "xpuwlm-status-online-symbolic.svg",
        "xpuwlm-status-detected-symbolic.svg",
        "xpuwlm-status-attention-symbolic.svg",
        "xpuwlm-status-paused-symbolic.svg",
        "xpuwlm-status-unavailable-symbolic.svg",
    ];
    const css = fs.readFileSync(path.join(targetAppletRoot, "stylesheet.css"), "utf8");
    const png = fs.readFileSync(path.join(targetAppletRoot, "icon.png"));
    validatePngIcon(png);
    for (const iconName of iconNames) {
        const svg = fs.readFileSync(path.join(targetAppletRoot, "icons", iconName), "utf8");
        validateSvgIcon(svg);
    }
    validateStylesheet(css);
    const spice = require("./package-applet.js").inspectSpiceSources(
        targetRepositoryRoot,
        targetAppletRoot,
    );
    assert.equal(spice.info.author, "geraldo-netto");
    assert.equal(spice.info.license, "MIT");
}

function validateArtifacts(roots) {
    validatePayloadStructure(roots);
    validateJsonArtifacts(roots);
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
    controlCharacterLine,
    defaultRoots,
    main,
    payloadPaths,
    productionJavaScriptFiles,
    readJson,
    readWorkflow,
    validateArtifacts,
    validateJavaScriptSyntax,
    validateJsonArtifacts,
    validatePayloadStructure,
    validatePngIcon,
    validateSourceControls,
    validateStaticAssets,
    validateStylesheet,
    validateSvgIcon,
    validateWorkflows,
};
