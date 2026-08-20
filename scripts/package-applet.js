"use strict";

// Deterministic staging, packaging, and install verification for the applet
// payload. The same payload bytes always produce byte-identical staging
// trees, checksum manifests, and ustar archives, so a release can be
// reproduced and an installed copy can be audited offline.

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const {compareText} = require("./lib/compare-text.js");
const {walkTree} = require("./lib/walk-tree.js");

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
// What a payload entry's mode is, said once for every tree this script makes.
// The archive hard-coded these two numbers while staging copied whatever the
// working tree happened to hold — 0664 on an umask-002 desk — so the same
// payload bytes produced a staged tree whose modes depended on who ran the
// pack, against a promise of trees that are identical. A mode is part of what
// is released, so it is decided here rather than inherited.
const PAYLOAD_FILE_MODE = 0o644;
const PAYLOAD_DIRECTORY_MODE = 0o755;
const BLOCK_SIZE = 512;
const REQUIRE_START = /\brequire\s*\(/gu;
const STATIC_REQUIRE = /\brequire\s*\(\s*("(?:[^"\\]|\\.)*")\s*\)/gu;
const CHECKSUM_LINE = /^([0-9a-f]{64}) {2}(.+)$/u;


// Sorted relative paths of every regular payload file. Symlinks and special
// files are rejected loudly: they must never reach a staged release.
function refuseIrregularPayloadEntry(entry, relativePath) {
    if (entry.isSymbolicLink() || !(entry.isFile() || entry.isDirectory())) {
        throw new Error(`Payload entries must be regular files or directories: ${relativePath}`);
    }
}

function payloadFiles(root) {
    return walkTree(root, refuseIrregularPayloadEntry);
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
        // Last-wins would let a manifest promise one path two different hashes
        // and still verify: the file matches whichever line survived, and the
        // other promise is never checked at all.
        if (entries.has(match[2])) {
            throw new Error(`Duplicate checksum entry: ${match[2]}`);
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
        fs.mkdirSync(path.dirname(target), {recursive: true, mode: PAYLOAD_DIRECTORY_MODE});
        fs.copyFileSync(path.join(sourceRoot, relativePath), target);
        // `copyFileSync` carries the source mode, and the source is a working
        // tree rather than a release.
        fs.chmodSync(target, PAYLOAD_FILE_MODE);
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

// What it found, not just that it was happy. The staging step used to run the
// same `regularFile` guard over the same four names immediately after calling
// this — the inspection's first statement — because the paths it resolved were
// thrown away. They are handed back instead, so the file that is copied is the
// file that was checked.
function inspectSpiceSources(projectRoot, appletRoot) {
    const metadataFiles = new Map(SPICE_METADATA_FILES.map(
        (relativePath) => [relativePath, regularFile(projectRoot, relativePath)],
    ));
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
    return {info, screenshot, metadataFiles};
}

function stageSpiceRelease(
    projectRoot,
    appletRoot,
    targetRoot,
    files = appletPayloadFiles(appletRoot),
) {
    const {metadataFiles} = inspectSpiceSources(projectRoot, appletRoot);
    fs.rmSync(targetRoot, {recursive: true, force: true});
    fs.mkdirSync(targetRoot, {recursive: true, mode: PAYLOAD_DIRECTORY_MODE});
    for (const [relativePath, filename] of metadataFiles) {
        const target = path.join(targetRoot, relativePath);
        fs.copyFileSync(filename, target);
        fs.chmodSync(target, PAYLOAD_FILE_MODE);
    }
    stagePayload(appletRoot, path.join(targetRoot, "files", UUID), files);
    return payloadFiles(targetRoot);
}

// The tree being inspected is not the tree being staged. `payloadFiles` is the
// staging guard: it refuses a symlink or a device node by throwing, which is
// right for a payload about to be released and wrong for an installed copy,
// where such an entry is the finding rather than an error — verifying a
// tampered install died with "Payload entries must be regular files or
// directories" instead of naming the entry. An inspection lists what it finds.
function installedFiles(root) {
    return walkTree(root, () => {});
}

// Never through a symlink: `existsSync` and `readFileSync` follow one, so a
// payload file replaced by a link to an identical file elsewhere verified
// clean. What the manifest promises is the file itself.
//
// The mode is inspected beside the bytes because the bytes are only half of
// what an installed tree promises: `applet.js` is executed by the session at
// every login, and a copy anyone can write is a finding whatever it hashes to
// today. World-writable only — an umask-002 desktop installs 0664 under a
// user-private group, and calling that a finding would make the audit noise.
function isWorldWritable(entry) {
    return (entry.mode & 0o002) !== 0;
}

function installedState(root, relativePath, hash) {
    let entry;
    try {
        entry = fs.lstatSync(path.join(root, relativePath));
    } catch {
        return {state: "missing", worldWritable: false};
    }
    if (!entry.isFile()) {
        return {state: "mismatched", worldWritable: false};
    }
    const bytes = fs.readFileSync(path.join(root, relativePath));
    return {
        state: sha256Hex(bytes) === hash ? "ok" : "mismatched",
        worldWritable: isWorldWritable(entry),
    };
}

// Every entry the manifest promises, sorted into the buckets the report names.
// An entry can land in two of them at once — a file that is both replaced and
// left world-writable is both findings — so the mode is asked separately from
// the bytes rather than as one more state.
function auditExpected(root, expected) {
    const missing = [];
    const mismatched = [];
    const worldWritable = [];
    const buckets = {missing, mismatched};
    for (const [relativePath, hash] of expected) {
        const found = installedState(root, relativePath, hash);
        buckets[found.state]?.push(relativePath);
        if (found.worldWritable) {
            worldWritable.push(relativePath);
        }
    }
    return {missing, mismatched, worldWritable};
}

// Compares an installed tree against the payload checksum manifest. Extra
// files are reported: a clean install contains exactly the payload.
function verifyInstall(root, checksums) {
    const expected = parseChecksums(checksums);
    const audited = auditExpected(root, expected);
    const unexpected = fs.existsSync(root)
        ? installedFiles(root).filter((relativePath) => !expected.has(relativePath))
        : [];
    const report = {...audited, unexpected};
    return {
        ok: Object.values(report).every((entries) => entries.length === 0),
        ...report,
    };
}

// Uninstall verification: the applet directory must be gone entirely.
function verifyAbsent(root) {
    const present = fs.existsSync(root);
    return {ok: !present, remaining: present ? installedFiles(root) : []};
}

// A ustar field is a fixed width, and both of the ways a value can fail to fit
// one used to be silent: `padStart` widens a short value and leaves a long one
// alone, so an out-of-range size or mode wrote a field that meant something
// else, and the archive still matched its own checksum manifest.
function octal(value, width) {
    const digits = value.toString(8);
    if (digits.length > width - 1) {
        throw new RangeError(
            `Archive header field needs ${digits.length} octal digits, not ${width - 1}: ${value}`,
        );
    }
    return `${digits.padStart(width - 1, "0")}\0`;
}

function tarHeader(name, size, typeflag) {
    // Bytes, not characters: the name field is 100 bytes, and a name counted
    // in characters passed this guard and was then silently truncated by
    // `Buffer.write` — a member the archive names as something it is not.
    if (Buffer.byteLength(name, "utf8") > 100) {
        throw new RangeError(`Archive member name exceeds 100 bytes: ${name}`);
    }
    const header = Buffer.alloc(BLOCK_SIZE);
    header.write(name, 0, 100, "utf8");
    header.write(
        octal(typeflag === "5" ? PAYLOAD_DIRECTORY_MODE : PAYLOAD_FILE_MODE, 8),
        100,
    );
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
    // The previous run's outputs go before this one's are written, digest
    // first. A pack that dies partway used to leave the new checksum manifest
    // beside the *previous* archive and the previous digest — a pair that
    // verifies against each other and against nothing that was staged. Cleared
    // in this order, the sidecar never names an archive it did not measure:
    // either it is absent or the archive beside it is the one it describes.
    const archivePath = path.join(dist, `${UUID}.tar`);
    fs.rmSync(`${archivePath}.sha256`, {force: true});
    fs.rmSync(archivePath, {force: true});
    commandStage(log, dist, files);
    const archive = buildArchive(payloadRoot, UUID, files);
    const digest = sha256Hex(archive);
    fs.writeFileSync(archivePath, archive);
    fs.writeFileSync(`${archivePath}.sha256`, `${digest}  ${UUID}.tar\n`);
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
    PAYLOAD_DIRECTORY_MODE,
    PAYLOAD_FILE_MODE,
    SPICE_METADATA_FILES,
    UUID,
    appletPayloadFiles,
    auditExpected,
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
    refuseIrregularPayloadEntry,
    productionRequireGraph,
    inspectSpiceSources,
    installedFiles,
    installedState,
    isWorldWritable,
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
    walkTree,
};
