"use strict";

// Deterministic staging, packaging, and install verification for the applet
// payload. The same payload bytes always produce byte-identical staging
// trees, checksum manifests, and ustar archives, so a release can be
// reproduced and an installed copy can be audited offline.

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const {compareText} = require("./lib/compare-text.js");

const UUID = "cinnamon-xpuwlm@geraldo-netto";
const repositoryRoot = path.resolve(__dirname, "..");
const payloadRoot = path.join(repositoryRoot, "files", UUID);
const distRoot = path.join(repositoryRoot, "dist");
const SPICE_METADATA_FILES = Object.freeze(["LICENSE", "README.md", "info.json", "screenshot.png"]);
const PNG_SIGNATURE = Buffer.from("89504e470d0a1a0a", "hex");
const MIN_SCREENSHOT_DIMENSION = 400;

// Fixed archive timestamp (2000-01-01T00:00:00Z): determinism without the
// tool-compatibility problems of a zero mtime.
const ARCHIVE_MTIME = 946684800;
const BLOCK_SIZE = 512;
const REQUIRE_START = /\brequire\s*\(/gu;
const STATIC_REQUIRE = /\brequire\s*\(\s*("(?:[^"\\]|\\.)*")\s*\)/gu;
const CHECKSUM_LINE = /^([0-9a-f]{64}) {2}(.+)$/u;


// Sorted relative paths of every regular payload file. Symlinks and special
// files are rejected loudly: they must never reach a staged release.
function payloadFiles(root, prefix = "") {
    const names = [];
    for (const entry of fs.readdirSync(root, {withFileTypes: true})) {
        const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
        if (entry.isSymbolicLink() || !(entry.isFile() || entry.isDirectory())) {
            throw new Error(`Payload entries must be regular files or directories: ${relativePath}`);
        }
        if (entry.isDirectory()) {
            names.push(...payloadFiles(path.join(root, entry.name), relativePath));
        } else {
            names.push(relativePath);
        }
    }
    return names.sort(compareText);
}

// Production dependencies are deliberately static CommonJS edges. Dynamic,
// non-relative, escaping, missing, and irregular targets all fail closed so a
// release can never silently omit code that only resolves at runtime.
function sourceRequires(source, owner = "source") {
    const starts = [...String(source).matchAll(REQUIRE_START)];
    const matches = [...String(source).matchAll(STATIC_REQUIRE)];
    if (starts.length !== matches.length) {
        throw new Error(`Production require must be one static string in ${owner}`);
    }
    return matches.map((match) => JSON.parse(match[1]));
}

// One guard, asked twice about different subjects: lstat the entry, refuse a
// symlink or anything that is not a regular file, and hand back the path. The
// subject is the caller's word because a production module that is missing and
// a Spice release file that is missing are different failures to read about.
function regularEntry(root, relativePath, subject) {
    const filename = path.join(root, relativePath);
    let entry;
    try {
        entry = fs.lstatSync(filename);
    } catch (error) {
        throw new Error(`${subject} is missing: ${relativePath}`, {cause: error});
    }
    if (entry.isSymbolicLink() || !entry.isFile()) {
        throw new Error(`${subject} must be a regular file: ${relativePath}`);
    }
    return filename;
}

function regularModule(root, relativePath) {
    return regularEntry(root, relativePath, "Production module");
}

function isAppletModule(relativePath) {
    return relativePath !== ""
        && relativePath !== ".."
        && !relativePath.startsWith("../")
        && !path.isAbsolute(relativePath)
        && relativePath.endsWith(".js");
}

function resolveRequire(root, owner, request) {
    if (!request.startsWith("./") && !request.startsWith("../")) {
        throw new Error(`Production require must be relative in ${owner}: ${request}`);
    }
    const requested = request.endsWith(".js") ? request : `${request}.js`;
    const filename = path.resolve(root, path.dirname(owner), requested);
    const relativePath = path.relative(root, filename).split(path.sep).join("/");
    if (!isAppletModule(relativePath)) {
        throw new Error(`Production require escapes the applet in ${owner}: ${request}`);
    }
    regularModule(root, relativePath);
    return relativePath;
}

function requireEdges(root, owner) {
    const source = fs.readFileSync(regularModule(root, owner), "utf8");
    return sourceRequires(source, owner).map((request) => resolveRequire(root, owner, request));
}

function requireRootShim(root, owner, target) {
    if (!owner.startsWith("lib/") || !target.startsWith("lib/")) {
        return null;
    }
    if (path.posix.dirname(target) !== "lib") {
        throw new Error(`Nested production module needs an unsupported root shim: ${target}`);
    }
    const shim = path.posix.basename(target);
    const dependencies = requireEdges(root, shim);
    if (dependencies.length !== 1 || dependencies[0] !== target) {
        throw new Error(`Cinnamon root shim ${shim} must resolve only ${target}`);
    }
    return shim;
}

function productionRequireGraph(root, entry = "applet.js") {
    if (!isAppletModule(entry)) {
        throw new Error(`Production entry escapes the applet: ${entry}`);
    }
    const modules = new Set();
    const rootShims = new Set();
    const pending = [entry];
    while (pending.length > 0) {
        const owner = pending.pop();
        if (modules.has(owner)) {
            continue;
        }
        modules.add(owner);
        for (const target of requireEdges(root, owner)) {
            const shim = requireRootShim(root, owner, target);
            if (shim !== null) {
                rootShims.add(shim);
            }
            pending.push(target);
        }
    }
    return Object.freeze({
        entry,
        modules: Object.freeze([...modules].sort(compareText)),
        rootShims: Object.freeze([...rootShims].sort(compareText)),
    });
}

function appletPayloadFiles(root = payloadRoot) {
    const graph = productionRequireGraph(root);
    const productionJavaScript = new Set([...graph.modules, ...graph.rootShims]);
    return payloadFiles(root).filter((relativePath) => (
        !relativePath.endsWith(".js") || productionJavaScript.has(relativePath)
    ));
}

function sha256Hex(buffer) {
    return crypto.createHash("sha256").update(buffer).digest("hex");
}

// GNU coreutils sha256sum format so `sha256sum --check` can verify a staged
// tree without this script.
function buildChecksums(root, files = payloadFiles(root)) {
    return [...files].sort(compareText)
        .map((relativePath) => `${sha256Hex(fs.readFileSync(path.join(root, relativePath)))}  ${relativePath}\n`)
        .join("");
}

function parseChecksums(text) {
    const entries = new Map();
    for (const line of String(text).split("\n")) {
        if (line === "") {
            continue;
        }
        const match = CHECKSUM_LINE.exec(line);
        if (!match) {
            throw new Error(`Malformed checksum line: ${line}`);
        }
        entries.set(match[2], match[1]);
    }
    return entries;
}

function stagePayload(sourceRoot, targetRoot, files = payloadFiles(sourceRoot)) {
    fs.rmSync(targetRoot, {recursive: true, force: true});
    const staged = [...files].sort(compareText);
    for (const relativePath of staged) {
        const target = path.join(targetRoot, relativePath);
        fs.mkdirSync(path.dirname(target), {recursive: true});
        fs.copyFileSync(path.join(sourceRoot, relativePath), target);
    }
    return staged;
}

function regularFile(root, relativePath) {
    return regularEntry(root, relativePath, "Spice release file");
}

function pngDimensions(contents) {
    if (contents.length < 24 || !contents.subarray(0, 8).equals(PNG_SIGNATURE)
            || contents.subarray(12, 16).toString("ascii") !== "IHDR") {
        throw new Error("Spice screenshot must be a PNG with an IHDR header");
    }
    return {width: contents.readUInt32BE(16), height: contents.readUInt32BE(20)};
}

function inspectSpiceSources(projectRoot, appletRoot) {
    for (const relativePath of SPICE_METADATA_FILES) {
        regularFile(projectRoot, relativePath);
    }
    const info = JSON.parse(fs.readFileSync(path.join(projectRoot, "info.json"), "utf8"));
    if (info.author !== "geraldo-netto" || info.license !== "MIT") {
        throw new Error("Spice info.json must name GitHub author geraldo-netto and MIT license");
    }
    const screenshot = pngDimensions(fs.readFileSync(path.join(projectRoot, "screenshot.png")));
    if (screenshot.width < MIN_SCREENSHOT_DIMENSION
            || screenshot.height < MIN_SCREENSHOT_DIMENSION) {
        throw new Error(`Spice screenshot must be at least ${MIN_SCREENSHOT_DIMENSION}px per side`);
    }
    const rootLicense = fs.readFileSync(path.join(projectRoot, "LICENSE"));
    const payloadLicense = fs.readFileSync(regularFile(appletRoot, "LICENSE"));
    if (!rootLicense.equals(payloadLicense)) {
        throw new Error("Payload LICENSE must match the Spice release LICENSE");
    }
    return {info, screenshot};
}

function stageSpiceRelease(
    projectRoot,
    appletRoot,
    targetRoot,
    files = appletPayloadFiles(appletRoot),
) {
    inspectSpiceSources(projectRoot, appletRoot);
    fs.rmSync(targetRoot, {recursive: true, force: true});
    for (const relativePath of SPICE_METADATA_FILES) {
        fs.mkdirSync(targetRoot, {recursive: true});
        fs.copyFileSync(
            regularFile(projectRoot, relativePath),
            path.join(targetRoot, relativePath),
        );
    }
    stagePayload(appletRoot, path.join(targetRoot, "files", UUID), files);
    return payloadFiles(targetRoot);
}

// Compares an installed tree against the payload checksum manifest. Extra
// files are reported: a clean install contains exactly the payload.
function verifyInstall(root, checksums) {
    const expected = parseChecksums(checksums);
    const missing = [];
    const mismatched = [];
    for (const [relativePath, hash] of expected) {
        const installed = path.join(root, relativePath);
        if (!fs.existsSync(installed)) {
            missing.push(relativePath);
        } else if (sha256Hex(fs.readFileSync(installed)) !== hash) {
            mismatched.push(relativePath);
        }
    }
    const unexpected = fs.existsSync(root)
        ? payloadFiles(root).filter((relativePath) => !expected.has(relativePath))
        : [];
    return {
        ok: missing.length === 0 && mismatched.length === 0 && unexpected.length === 0,
        missing,
        mismatched,
        unexpected,
    };
}

// Uninstall verification: the applet directory must be gone entirely.
function verifyAbsent(root) {
    return {ok: !fs.existsSync(root), remaining: fs.existsSync(root) ? payloadFiles(root) : []};
}

function octal(value, width) {
    return `${value.toString(8).padStart(width - 1, "0")}\0`;
}

function tarHeader(name, size, typeflag) {
    if (name.length > 100) {
        throw new RangeError(`Archive member name exceeds 100 characters: ${name}`);
    }
    const header = Buffer.alloc(BLOCK_SIZE);
    header.write(name, 0, 100, "utf8");
    header.write(typeflag === "5" ? octal(0o755, 8) : octal(0o644, 8), 100);
    header.write(octal(0, 8), 108);
    header.write(octal(0, 8), 116);
    header.write(octal(size, 12), 124);
    header.write(octal(ARCHIVE_MTIME, 12), 136);
    header.write("        ", 148);
    header.write(typeflag, 156);
    header.write("ustar\0", 257);
    header.write("00", 263);
    let checksum = 0;
    for (const byte of header) {
        checksum += byte;
    }
    header.write(`${checksum.toString(8).padStart(6, "0")}\0 `, 148);
    return header;
}

function tarPadding(size) {
    const remainder = size % BLOCK_SIZE;
    return remainder === 0 ? Buffer.alloc(0) : Buffer.alloc(BLOCK_SIZE - remainder);
}

function memberDirectories(files) {
    const directories = new Set([""]);
    for (const relativePath of files) {
        const segments = relativePath.split("/").slice(0, -1);
        segments.reduce((parent, segment) => {
            const directory = parent ? `${parent}/${segment}` : segment;
            directories.add(directory);
            return directory;
        }, "");
    }
    directories.delete("");
    return [...directories].sort(compareText);
}

// Deterministic ustar archive: sorted directory members first, fixed mtime,
// zero ownership, no environment-dependent metadata.
function buildArchive(root, memberPrefix, files = payloadFiles(root)) {
    const sortedFiles = [...files].sort(compareText);
    const blocks = memberDirectories(sortedFiles.map((name) => `${memberPrefix}/${name}`))
        .map((directory) => tarHeader(`${directory}/`, 0, "5"));
    for (const relativePath of sortedFiles) {
        const contents = fs.readFileSync(path.join(root, relativePath));
        blocks.push(tarHeader(`${memberPrefix}/${relativePath}`, contents.length, "0"));
        blocks.push(contents, tarPadding(contents.length));
    }
    return Buffer.concat([...blocks, Buffer.alloc(BLOCK_SIZE * 2)]);
}

function commandStage(log, dist = distRoot, files = appletPayloadFiles(payloadRoot)) {
    const staged = stagePayload(payloadRoot, path.join(dist, UUID), files);
    fs.writeFileSync(path.join(dist, `${UUID}.SHA256SUMS`), buildChecksums(payloadRoot, files));
    log(`staged ${staged.length} payload files -> ${path.join(dist, UUID)}`);
    return 0;
}

// The payload inventory is a directory walk and a resolution of the whole
// production require graph, and the digest is a hash of the finished archive.
// Packing wanted each of them once and asked for the inventory three times
// over — staging, the archive, the Spice tree — and hashed the archive twice
// to write the same digest into two places.
function commandPack(log, dist = distRoot) {
    const files = appletPayloadFiles(payloadRoot);
    commandStage(log, dist, files);
    const archive = buildArchive(payloadRoot, UUID, files);
    const digest = sha256Hex(archive);
    fs.writeFileSync(path.join(dist, `${UUID}.tar`), archive);
    fs.writeFileSync(path.join(dist, `${UUID}.tar.sha256`), `${digest}  ${UUID}.tar\n`);
    log(`packed ${UUID}.tar (${archive.length} bytes, sha256 ${digest})`);
    commandSpice(log, dist, files);
    return 0;
}

function commandSpice(log, dist = distRoot, files = appletPayloadFiles(payloadRoot)) {
    const target = path.join(dist, "spices", UUID);
    const staged = stageSpiceRelease(repositoryRoot, payloadRoot, target, files);
    log(`staged ${staged.length} Spice files -> ${target}`);
    return 0;
}

function commandVerify(root, log) {
    const report = verifyInstall(
        root,
        buildChecksums(payloadRoot, appletPayloadFiles(payloadRoot)),
    );
    if (report.ok) {
        log(`install verified: ${root} matches the payload checksums`);
        return 0;
    }
    for (const [kind, entries] of Object.entries(report)) {
        if (Array.isArray(entries) && entries.length > 0) {
            log(`${kind}: ${entries.join(", ")}`);
        }
    }
    return 1;
}

function commandVerifyAbsent(root, log) {
    const report = verifyAbsent(root);
    if (report.ok) {
        log(`uninstall verified: ${root} is absent`);
        return 0;
    }
    log(`uninstall incomplete, remaining files: ${report.remaining.join(", ")}`);
    return 1;
}

function runCommand(argv, log, dist = distRoot) {
    const [command, argument] = argv;
    const distCommands = {stage: commandStage, pack: commandPack, spice: commandSpice};
    if (Object.hasOwn(distCommands, command)) {
        return distCommands[command](log, dist);
    }
    if (command === "verify" && argument) {
        return commandVerify(argument, log);
    }
    if (command === "verify-absent" && argument) {
        return commandVerifyAbsent(argument, log);
    }
    log("usage: package-applet.js stage | pack | spice | verify <root> | verify-absent <root>");
    return 2;
}

if (require.main === module) {
    process.exitCode = runCommand(process.argv.slice(2), console.log);
}

module.exports = {
    ARCHIVE_MTIME,
    BLOCK_SIZE,
    MIN_SCREENSHOT_DIMENSION,
    SPICE_METADATA_FILES,
    UUID,
    appletPayloadFiles,
    buildArchive,
    buildChecksums,
    commandPack,
    commandSpice,
    commandStage,
    commandVerify,
    commandVerifyAbsent,
    compareText,
    distRoot,
    memberDirectories,
    octal,
    parseChecksums,
    payloadFiles,
    payloadRoot,
    pngDimensions,
    productionRequireGraph,
    inspectSpiceSources,
    regularEntry,
    regularFile,
    runCommand,
    sha256Hex,
    sourceRequires,
    stagePayload,
    stageSpiceRelease,
    tarHeader,
    tarPadding,
    verifyAbsent,
    verifyInstall,
};
