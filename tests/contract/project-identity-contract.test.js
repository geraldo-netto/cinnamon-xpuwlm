"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const ROOT = path.resolve(__dirname, "../..");
const APPLET_UUID = "cinnamon-xpuwlm@geraldo-netto";
const LEGACY_IDENTITY_ADAPTER = path.join(
    ROOT,
    "files",
    APPLET_UUID,
    "lib",
    "cinnamon-state-adapter.js",
);
const STALE_IDENTIFIERS = Object.freeze([
    "cinnamon-tpuwlm",
    "cinnamon-tpuwm",
    "TPU Workload Manager",
    "tpu-workload-manager",
    "TPUWM_",
    "tpuwm",
]);

function filesUnder(root) {
    const found = [];
    for (const entry of fs.readdirSync(root, {withFileTypes: true})) {
        const candidate = path.join(root, entry.name);
        if (entry.isDirectory()) {
            found.push(...filesUnder(candidate));
        } else if (entry.isFile()) {
            found.push(candidate);
        }
    }
    return found;
}

function isExplicitLegacyConstant(filename, line) {
    return filename === LEGACY_IDENTITY_ADAPTER
        && /^const (?:LEGACY_|OLD_)/u.test(line.trim());
}

test("project and applet identities use the canonical XPU name", () => {
    const packageJson = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
    const metadata = JSON.parse(fs.readFileSync(
        path.join(ROOT, "files", APPLET_UUID, "metadata.json"),
        "utf8",
    ));
    assert.equal(packageJson.name, "cinnamon-xpuwlm");
    assert.equal(metadata.uuid, APPLET_UUID);
    assert.equal(metadata.name, "XPU Workload Manager");
    assert.deepEqual(
        fs.readdirSync(path.join(ROOT, "files"), {withFileTypes: true})
            .filter((entry) => entry.isDirectory())
            .map((entry) => entry.name),
        [APPLET_UUID],
    );
});

test("production sources contain no accidental legacy identity references", () => {
    const roots = [
        path.join(ROOT, ".github"),
        path.join(ROOT, "files"),
        path.join(ROOT, "scripts"),
    ];
    const filenames = [
        path.join(ROOT, "package.json"),
        path.join(ROOT, "package-lock.json"),
        path.join(ROOT, "stryker.config.json"),
        ...roots.flatMap(filesUnder),
    ];
    const stale = [];
    for (const filename of filenames) {
        const contents = fs.readFileSync(filename, "utf8");
        for (const [index, line] of contents.split("\n").entries()) {
            if (STALE_IDENTIFIERS.some((identifier) => line.includes(identifier))
                    && !isExplicitLegacyConstant(filename, line)) {
                stale.push(`${path.relative(ROOT, filename)}:${index + 1}`);
            }
        }
    }
    assert.deepEqual(stale, []);
});
