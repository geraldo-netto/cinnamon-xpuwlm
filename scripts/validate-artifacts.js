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
    "clipboard-selection-port.js",
    "domain.js",
    "document-question.js",
    "document-source-port.js",
    "event-import.js",
    "event-source-port.js",
    "external-chooser-port.js",
    "file-organizer.js",
    "failure-log-backoff.js",
    "failure-reporter.js",
    "i18n.js",
    "icon.png",
    "icons",
    "job-submission.js",
    "LICENSE",
    "lib",
    "layout.js",
    "manager.js",
    "metadata.json",
    "po",
    "plugin-inventory.js",
    "profile-blockers.js",
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
    "runtime-snapshot-contract.js",
    "runtime-snapshot-schema-validator.js",
    "runtime-snapshot.schema.json",
    "selected-text.js",
    "settings-schema.json",
    "snapshot-validator.js",
    "stylesheet.css",
    "tensor-encoder.js",
    "view-model.js",
    "workload-manifest.js",
    "workload-manifest.schema.json",
    "workload-registry.js",
    "workload-reconciliation.js",
    "workloads",
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

function payloadPaths(directory = appletRoot, prefix = "") {
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

function validatePayloadStructure() {
    const filesEntries = fs.readdirSync(filesRoot, {withFileTypes: true});
    assert.deepEqual(filesEntries.map((entry) => entry.name).sort(), [UUID]);
    assert.equal(filesEntries[0].isDirectory(), true);
    assert.deepEqual(fs.readdirSync(appletRoot).sort(), [...PAYLOAD_TOP_LEVEL].sort());

    for (const relativePath of payloadPaths()) {
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

function productionJavaScriptFiles() {
    const rootModules = fs.readdirSync(appletRoot)
        .filter((name) => name.endsWith(".js"))
        .map((name) => path.join(appletRoot, name));
    const libraryDirectory = path.join(appletRoot, "lib");
    const libraries = fs.readdirSync(libraryDirectory)
        .filter((name) => name.endsWith(".js"))
        .map((name) => path.join(libraryDirectory, name));
    return [...rootModules, ...libraries];
}

function validateJsonArtifacts() {
    const metadata = readJson(appletRoot, "metadata.json");
    const settings = readJson(appletRoot, "settings-schema.json");
    const schema = readJson(appletRoot, "runtime-snapshot.schema.json");
    const workloadSchema = readJson(appletRoot, "workload-manifest.schema.json");
    const commandSchema = readJson(appletRoot, "runtime-command.schema.json");
    const acknowledgementSchema = readJson(appletRoot, "runtime-acknowledgement.schema.json");
    const refusalSchema = readJson(appletRoot, "runtime-refusal.schema.json");
    const contractSchema = readJson(appletRoot, "runtime-contract.schema.json");
    const packageJson = readJson(repositoryRoot, "package.json");
    const stryker = readJson(repositoryRoot, "stryker.config.json");
    const Domain = require(path.join(appletRoot, "lib/domain.js"));
    const Manifest = require(path.join(appletRoot, "lib/workload-manifest.js"));
    const Registry = require(path.join(appletRoot, "lib/workload-registry.js"));

    assert.equal(metadata.uuid, UUID);
    assert.equal(metadata.uuid, path.basename(appletRoot));
    assert.equal(packageJson.version, metadata.version);
    assert.equal(metadata["max-instances"], 1);
    assert.ok(metadata["cinnamon-version"].includes("6.6"));
    assert.equal(schema.properties.version.const, Domain.SNAPSHOT_VERSION);
    assert.equal(schema.properties.generatedAt.minimum, Domain.MIN_GENERATED_AT);
    assert.doesNotThrow(() => new Ajv2020({strict: true}).compile(schema));
    assert.doesNotThrow(() => new Ajv2020({strict: true}).compile(workloadSchema));
    assert.doesNotThrow(() => new Ajv2020({strict: true}).compile(commandSchema));
    assert.doesNotThrow(() => new Ajv2020({strict: true}).compile(acknowledgementSchema));
    assert.doesNotThrow(() => new Ajv2020({strict: true}).compile(refusalSchema));
    assert.doesNotThrow(() => new Ajv2020({strict: true}).compile(contractSchema));
    // The predicate and the mirrored schema must agree on the bounds, or a
    // document one accepts is a document the other rejects.
    const Contract = require(path.join(appletRoot, "lib/runtime-contract.js"));
    assert.equal(contractSchema.properties.version.const, Contract.CONTRACT_DOCUMENT_VERSION);
    assert.equal(contractSchema.properties.methods.maxItems, Contract.MAX_METHODS);
    assert.equal(contractSchema.properties.schemas.maxProperties, Contract.MAX_CONTRACTS);
    assert.equal(
        contractSchema.properties.schemas.additionalProperties.maximum,
        Contract.MAX_CONTRACT_VERSION,
    );
    assert.deepEqual(
        refusalSchema.properties.code.enum,
        [...require(path.join(appletRoot, "lib/runtime-refusal-contract.js")).REFUSAL_CODES],
    );
    assert.equal(settings["show-panel-label"].default, false);
    assert.deepEqual(settings["profile-state"].default.profiles, {});
    assert.equal(schema.properties.metrics.properties.runningProfiles.maximum, Registry.MAX_WORKLOADS);
    const workloadDirectories = fs.readdirSync(path.join(appletRoot, "workloads"), {withFileTypes: true});
    assert.equal(workloadDirectories.length > 0, true);
    for (const entry of workloadDirectories) {
        assert.equal(entry.isDirectory(), true, `Workload must be a directory: ${entry.name}`);
        const manifest = readJson(appletRoot, `workloads/${entry.name}/manifest.json`);
        assert.equal(new Manifest.WorkloadDescriptor(manifest).id, entry.name);
    }
    const potFile = fs.readFileSync(path.join(appletRoot, "po", `${UUID}.pot`), "utf8");
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

function readWorkflow(name) {
    return fs.readFileSync(path.join(repositoryRoot, ".github/workflows", name), "utf8");
}

function validateWorkflows() {
    const quality = readWorkflow("applet-quality.yml");
    const audit = readWorkflow("dependency-audit.yml");

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

function validateJavaScriptSyntax() {
    for (const filename of productionJavaScriptFiles()) {
        childProcess.execFileSync(process.execPath, ["--check", filename], {stdio: "pipe"});
        const source = fs.readFileSync(filename, "utf8");
        assert.equal(/require\(["'](?:node:)?(?:fs|child_process|path)["']\)/.test(source), false);
        assert.equal(/\bBuffer\b/.test(source), false);
        assert.equal(
            controlCharacterLine(source),
            0,
            `${filename} carries a control character Cinnamon's parser refuses`,
        );
    }
}

function validateStaticAssets() {
    const iconNames = [
        "xpuwlm-symbolic.svg",
        "xpuwlm-symbolic-v2.svg",
        "xpuwlm-device-symbolic.svg",
        "xpuwlm-sliders-symbolic.svg",
        "xpuwlm-status-online-symbolic.svg",
        "xpuwlm-status-detected-symbolic.svg",
        "xpuwlm-status-attention-symbolic.svg",
        "xpuwlm-status-paused-symbolic.svg",
        "xpuwlm-status-unavailable-symbolic.svg",
    ];
    const css = fs.readFileSync(path.join(appletRoot, "stylesheet.css"), "utf8");
    const png = fs.readFileSync(path.join(appletRoot, "icon.png"));
    assert.deepEqual(png.subarray(0, 8), Buffer.from("89504e470d0a1a0a", "hex"));
    assert.equal(png.subarray(12, 16).toString("ascii"), "IHDR");
    assert.equal(png.readUInt32BE(16), png.readUInt32BE(20));
    for (const iconName of iconNames) {
        const svg = fs.readFileSync(path.join(appletRoot, "icons", iconName), "utf8");
        assert.match(svg, /^<svg[^>]*viewBox="0 0 16 16"[^>]*>[\s\S]*<\/svg>\s*$/);
        assert.doesNotMatch(svg, /<(?:script|style|text|image)\b/i);
    }
    assert.equal((css.match(/{/g) || []).length, (css.match(/}/g) || []).length);
    assert.equal(css.includes("outline: none"), false);
    const spice = require("./package-applet.js").inspectSpiceSources(repositoryRoot, appletRoot);
    assert.equal(spice.info.author, "geraldo-netto");
    assert.equal(spice.info.license, "MIT");
}

validatePayloadStructure();
validateJsonArtifacts();
validateWorkflows();
validateJavaScriptSyntax();
validateStaticAssets();
console.log("artifact validation: pass");
