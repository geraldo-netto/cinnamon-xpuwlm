"use strict";

// Developer tooling for third-party workload plug-ins. The repository gates
// (`npm run check:workloads`) only ever see the bundled catalog, so an
// out-of-tree author has no way to learn that a directory will be rejected,
// silently shadowed, or partly ignored until the applet already refused it on
// a user's desktop. This tool answers the same questions the applet asks at
// discovery time, and packs the verified directory into the same deterministic
// ustar archive the applet release uses.
//
// It deliberately does not apply the built-in-only rules from
// check-workload-manifests.js: `acceleratorPreference` is optional for a
// third-party plug-in, and display order only has to be unique within the
// merged catalog, which this tool checks against the bundled workloads.

const fs = require("node:fs");
const path = require("node:path");

const Checker = require("./check-workload-manifests.js");
const Package = require("./package-applet.js");
const Manifest = require("../files/cinnamon-tpuwm@geraldo-netto/lib/workload-manifest.js");
const Registry = require("../files/cinnamon-tpuwm@geraldo-netto/lib/workload-registry.js");

const MANIFEST_NAME = "manifest.json";
const bundledRoot = path.join(Package.payloadRoot, "workloads");
const pluginDistRoot = path.join(Package.distRoot, "plugins");

function bundledManifests(root = bundledRoot) {
    return Checker.manifestDirectories(root).map((identifier) => JSON.parse(
        fs.readFileSync(path.join(root, identifier, MANIFEST_NAME), "utf8"),
    ));
}

// The applet reads exactly one file per plug-in directory and executes
// nothing. Anything else is reported rather than shipped as payload the
// author believes is installed, and a symlink fails loudly here for the same
// reason discovery refuses to follow one.
function structureProblems(root) {
    let entries;
    try {
        entries = Package.payloadFiles(root);
    } catch (error) {
        return [`${root} is not a plain plug-in directory: ${error.message}`];
    }
    if (!entries.includes(MANIFEST_NAME)) {
        return [`${MANIFEST_NAME} is missing from ${root}`];
    }
    return entries
        .filter((name) => name !== MANIFEST_NAME)
        .map((name) => `the applet reads only ${MANIFEST_NAME}; remove ${name}`);
}

function readManifest(root, problems) {
    const contents = fs.readFileSync(path.join(root, MANIFEST_NAME));
    if (contents.length > Registry.MAX_MANIFEST_BYTES) {
        problems.push(`${MANIFEST_NAME} exceeds the ${Registry.MAX_MANIFEST_BYTES} byte discovery bound`);
        return null;
    }
    try {
        return JSON.parse(contents.toString("utf8"));
    } catch (error) {
        problems.push(`${MANIFEST_NAME} contains invalid JSON: ${error.message}`);
        return null;
    }
}

// Discovery builds the manifest path from the directory name and rejects a
// manifest whose identity disagrees with it, so both must be checked before a
// plug-in is shipped.
function identityProblems(directoryName, manifest) {
    const problems = [];
    if (!Manifest.identifier(directoryName)) {
        problems.push(`the directory name ${directoryName} is not a valid workload identifier`);
    }
    if (manifest.id !== directoryName) {
        problems.push(`manifest id ${manifest.id} does not match the directory name ${directoryName}`);
    }
    return problems;
}

// Bundled-wins merging means a colliding identifier is dropped and a colliding
// display order lands the plug-in in an unpredictable place. Neither is
// visible from inside a third-party directory.
function catalogProblems(manifest, bundled) {
    const problems = [];
    if (bundled.some((candidate) => candidate.id === manifest.id)) {
        problems.push(`${manifest.id} is a bundled workload id; bundled-wins merging would ignore this plug-in`);
    }
    const collision = bundled.find((candidate) => candidate.ui.order === manifest.ui.order);
    if (collision) {
        problems.push(`ui.order ${manifest.ui.order} is already used by the bundled workload ${collision.id}`);
    }
    return problems;
}

// The schema is authoritative, but the applet loads plug-ins through the
// descriptor, so a directory the descriptor refuses would never appear no
// matter what the schema says. Both verdicts are reported.
function contractProblems(manifest) {
    const schemaReport = Checker.schemaErrors(manifest);
    if (schemaReport !== "") {
        return [`${MANIFEST_NAME} fails the version 1 schema: ${schemaReport}`];
    }
    try {
        new Manifest.WorkloadDescriptor(manifest);
    } catch (error) {
        return [`${MANIFEST_NAME} is rejected by the applet descriptor: ${error.message}`];
    }
    return [];
}

function validatePlugin(root, bundled = bundledManifests()) {
    const directoryName = path.basename(path.resolve(root));
    const problems = structureProblems(root);
    if (!fs.existsSync(path.join(root, MANIFEST_NAME))) {
        return {ok: false, id: directoryName, version: null, problems};
    }
    const manifest = readManifest(root, problems);
    if (manifest === null) {
        return {ok: false, id: directoryName, version: null, problems};
    }
    // A manifest that fails the contract has no trustworthy identity or
    // ordering to compare against the catalog, so reporting stops here.
    const contract = contractProblems(manifest);
    if (contract.length > 0) {
        return {ok: false, id: directoryName, version: null, problems: [...problems, ...contract]};
    }
    problems.push(...identityProblems(directoryName, manifest), ...catalogProblems(manifest, bundled));
    return {
        ok: problems.length === 0,
        id: manifest.id,
        version: manifest.version,
        problems,
    };
}

function reportProblems(report, log) {
    for (const problem of report.problems) {
        log(`plug-in problem: ${problem}`);
    }
    return 1;
}

function commandValidate(root, log, bundled = bundledManifests()) {
    const report = validatePlugin(root, bundled);
    if (!report.ok) {
        return reportProblems(report, log);
    }
    log(`plug-in verified: ${report.id} ${report.version} installs as <XDG_DATA_HOME>/${Package.UUID}/workloads/${report.id}`);
    return 0;
}

// The archive members are prefixed with the workload id, so extracting it in
// the user workloads root produces exactly the directory discovery expects.
function commandPack(root, log, dist = pluginDistRoot, bundled = bundledManifests()) {
    const report = validatePlugin(root, bundled);
    if (!report.ok) {
        return reportProblems(report, log);
    }
    const base = `${report.id}-${report.version}`;
    fs.mkdirSync(dist, {recursive: true});
    const archive = Package.buildArchive(root, report.id);
    fs.writeFileSync(path.join(dist, `${base}.tar`), archive);
    fs.writeFileSync(path.join(dist, `${base}.tar.sha256`), `${Package.sha256Hex(archive)}  ${base}.tar\n`);
    log(`packed ${base}.tar (${archive.length} bytes, sha256 ${Package.sha256Hex(archive)})`);
    return 0;
}

function runCommand(argv, log, dist = pluginDistRoot) {
    const [command, root] = argv;
    if (command === "validate" && root) {
        return commandValidate(root, log);
    }
    if (command === "pack" && root) {
        return commandPack(root, log, dist);
    }
    log("usage: package-workload-plugin.js validate <plugin-directory> | pack <plugin-directory>");
    return 2;
}

if (require.main === module) {
    process.exitCode = runCommand(process.argv.slice(2), console.log);
}

module.exports = {
    MANIFEST_NAME,
    bundledManifests,
    bundledRoot,
    catalogProblems,
    commandPack,
    commandValidate,
    contractProblems,
    identityProblems,
    pluginDistRoot,
    readManifest,
    reportProblems,
    runCommand,
    structureProblems,
    validatePlugin,
};
