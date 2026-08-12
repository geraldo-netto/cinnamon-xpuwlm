"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const Organizer = require("../../files/cinnamon-xpuwlm@geraldo-netto/lib/file-organizer.js");

const repositoryRoot = path.resolve(__dirname, "../..");

function serviceRoot() {
    const candidate = process.env.XPUWLM_OMNITENSOR_ROOT
        || path.resolve(repositoryRoot, "../omnitensor");
    return fs.existsSync(path.join(candidate, "plugin-manifests/file-organizer.json"))
        ? candidate
        : null;
}

function requireService(t) {
    const root = serviceRoot();
    if (root === null) {
        t.skip("set XPUWLM_OMNITENSOR_ROOT to run the file-organizer contract gate");
    }
    return root;
}

function readJson(root, relative) {
    return JSON.parse(fs.readFileSync(path.join(root, relative), "utf8"));
}

test("file-organizer manifest pins explicit manual files and GPU-first policy", (t) => {
    const root = requireService(t);
    if (root === null) {
        return;
    }
    const manifest = readJson(root, "plugin-manifests/file-organizer.json");
    const sources = manifest.plugin.schemas.input.properties.sources;
    assert.equal(manifest.id, Organizer.PROFILE_ID);
    assert.equal(manifest.plugin.entryPoint, Organizer.PROFILE_ID);
    assert.deepEqual(manifest.plugin.triggers, ["manual"]);
    assert.deepEqual(manifest.plugin.permissions, [
        "accelerator:gpu",
        "files:read-selected",
    ]);
    assert.equal(sources.minItems, 1);
    assert.equal(sources.maxItems, Organizer.MAX_PLAN_ITEMS);
    assert.equal(sources.uniqueItems, true);
    assert.deepEqual(manifest.plugin.schemas.output, {
        $ref: "file-organizer-result.schema.json",
    });
    assert.deepEqual(manifest.requirements.acceleratorPreference, ["gpu"]);
    assert.equal(manifest.requirements.model, null);
});

test("public schema and defensive parser agree on every plan and evidence bound", (t) => {
    const root = requireService(t);
    if (root === null) {
        return;
    }
    const schema = readJson(root, "schemas/file-organizer-result.schema.json");
    const item = schema.$defs.item.properties;
    const evidence = schema.$defs.evidence.properties;
    assert.equal(schema.properties.version.const, 1);
    assert.equal(schema.properties.plan.maxItems, Organizer.MAX_PLAN_ITEMS);
    assert.equal(item.tags.maxItems, Organizer.MAX_TAGS);
    assert.equal(item.proposedName.maxLength, 255);
    assert.equal(item.proposedFolder.maxLength, 240);
    assert.equal(item.reason.maxLength, 2048);
    assert.equal(item.evidence.maxItems, Organizer.MAX_EVIDENCE);
    assert.equal(evidence.page.maximum, 2000);
    assert.equal(evidence.span.$ref, "#/$defs/span");
    assert.equal(schema.$defs.span.properties.end.maximum, 5_000_000);
    assert.deepEqual(schema.properties.accelerator.enum, ["gpu", "npu"]);
});

test("OmniTensor computes duplicates, discards fragments, and exposes no apply capability", (t) => {
    const root = requireService(t);
    if (root === null) {
        return;
    }
    const plugin = fs.readFileSync(
        path.join(root, "src/omnitensor/plugins/file_organizer.py"), "utf8",
    );
    assert.match(plugin, /class FileOrganizerPlugin/u);
    assert.match(plugin, /_duplicate_groups\(selected\)/u);
    assert.match(plugin, /finally:\n\s+await self\._store\.discard\(request\.job_id\)/u);
    for (const forbidden of ["shutil.move(", "os.rename(", ".unlink(", "subprocess.", "os.system("]) {
        assert.equal(plugin.includes(forbidden), false, forbidden);
    }
});
