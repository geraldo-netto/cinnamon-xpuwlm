"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const Package = require("../../scripts/package-applet.js");
const Plugin = require("../../scripts/package-workload-plugin.js");
const Registry = require("../../files/cinnamon-xpuwlm@geraldo-netto/lib/workload-registry.js");

const templatePath = path.resolve(__dirname, "../../templates/workload-plugin/manifest.json");

function temporaryDirectory() {
    return fs.mkdtempSync(path.join(os.tmpdir(), "xpuwlm-plugin-tooling-"));
}

// Minimal ustar reader: enough to prove the packed archive extracts to the
// directory layout discovery expects, without trusting a system tar.
function extractArchive(archive, target) {
    const extracted = [];
    for (let offset = 0; offset < archive.length; ) {
        const header = archive.subarray(offset, offset + Package.BLOCK_SIZE);
        if (header.every((byte) => byte === 0)) {
            break;
        }
        const name = header.subarray(0, 100).toString("utf8").replace(/\0+$/u, "");
        const size = parseInt(header.subarray(124, 135).toString("ascii"), 8);
        offset += Package.BLOCK_SIZE;
        if (String.fromCharCode(header[156]) === "5") {
            fs.mkdirSync(path.join(target, name), {recursive: true});
        } else {
            fs.mkdirSync(path.dirname(path.join(target, name)), {recursive: true});
            fs.writeFileSync(path.join(target, name), archive.subarray(offset, offset + size));
            extracted.push(name);
        }
        offset += Math.ceil(size / Package.BLOCK_SIZE) * Package.BLOCK_SIZE;
    }
    return extracted;
}

// End-to-end against the real author template and the real bundled catalog:
// an out-of-tree directory is validated, packed, extracted into a user
// workloads root, and then discovered by the same registry port the applet
// uses. This is the path a third-party author has no repository gate for.
test("an out-of-tree plug-in validates, packs, and is discovered after extraction", () => {
    const source = temporaryDirectory();
    const dist = temporaryDirectory();
    const userRoot = temporaryDirectory();
    const root = path.join(source, "third-party-workload");
    fs.mkdirSync(root);
    const template = JSON.parse(fs.readFileSync(templatePath, "utf8"));
    fs.writeFileSync(path.join(root, "manifest.json"), JSON.stringify({
        ...template,
        id: "third-party-workload",
        version: "2.3.4",
        ui: {...template.ui, order: 950},
    }, null, 2));

    const lines = [];
    const log = (line) => lines.push(line);
    assert.equal(Plugin.runCommand(["validate", root], log), 0);
    assert.match(lines[0], /third-party-workload 2\.3\.4/u);
    assert.equal(Plugin.runCommand(["pack", root], log, dist), 0);

    const archive = fs.readFileSync(path.join(dist, "third-party-workload-2.3.4.tar"));
    assert.deepEqual(archive, Package.buildArchive(root, "third-party-workload"));
    assert.deepEqual(extractArchive(archive, userRoot), ["third-party-workload/manifest.json"]);

    const registry = new Registry.ManifestDirectoryRegistry({
        root: userRoot,
        listDirectories: (candidate) => fs.readdirSync(candidate, {withFileTypes: true})
            .filter((entry) => entry.isDirectory())
            .map((entry) => entry.name),
        readText: (source_) => fs.readFileSync(source_, "utf8"),
    });
    const descriptors = registry.descriptors();
    assert.deepEqual(descriptors.map((descriptor) => descriptor.id), ["third-party-workload"]);
    assert.equal(descriptors[0].version, "2.3.4");

    fs.rmSync(source, {recursive: true, force: true});
    fs.rmSync(dist, {recursive: true, force: true});
    fs.rmSync(userRoot, {recursive: true, force: true});
});

// The bundled catalog is the authority the tool checks against, so its real
// identifiers and display orders must be rejected for a third-party plug-in.
test("the real bundled catalog rejects shadowed identifiers and reused display orders", () => {
    const source = temporaryDirectory();
    const template = JSON.parse(fs.readFileSync(templatePath, "utf8"));
    const bundled = Plugin.bundledManifests();
    const shadowRoot = path.join(source, bundled[0].id);
    fs.mkdirSync(shadowRoot);
    fs.writeFileSync(path.join(shadowRoot, "manifest.json"), JSON.stringify({
        ...template,
        id: bundled[0].id,
        ui: {...template.ui, order: bundled[0].ui.order},
    }));
    const report = Plugin.validatePlugin(shadowRoot);
    assert.equal(report.ok, false);
    assert.deepEqual(report.problems, [
        `${bundled[0].id} is a bundled workload id; bundled-wins merging would ignore this plug-in`,
        `ui.order ${bundled[0].ui.order} is already used by the bundled workload ${bundled[0].id}`,
    ]);
    fs.rmSync(source, {recursive: true, force: true});
});
