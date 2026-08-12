"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const Selected = require("../../files/cinnamon-xpuwlm@geraldo-netto/lib/selected-text.js");

const repositoryRoot = path.resolve(__dirname, "../..");

function serviceRoot() {
    const candidate = process.env.XPUWLM_OMNITENSOR_ROOT
        || path.resolve(repositoryRoot, "../omnitensor");
    return fs.existsSync(path.join(candidate, "plugin-manifests/selected-text-tools.json"))
        ? candidate
        : null;
}

function requireService(t) {
    const root = serviceRoot();
    if (root === null) {
        t.skip("set XPUWLM_OMNITENSOR_ROOT to run the selected-text contract gate");
    }
    return root;
}

function readJson(root, relative) {
    return JSON.parse(fs.readFileSync(path.join(root, relative), "utf8"));
}

test("selected-text manifest pins manual one-shot access, bounds, and accelerator policy", (t) => {
    const root = requireService(t);
    if (root === null) {
        return;
    }
    const manifest = readJson(root, "plugin-manifests/selected-text-tools.json");
    const input = manifest.plugin.schemas.input.properties;
    assert.equal(manifest.id, Selected.PROFILE_ID);
    assert.equal(manifest.plugin.entryPoint, Selected.PROFILE_ID);
    assert.deepEqual(manifest.plugin.triggers, ["manual"]);
    assert.deepEqual(manifest.plugin.permissions, [
        "accelerator:gpu",
        "clipboard:read-once",
    ]);
    assert.equal(input.selection.maxLength, Selected.MAX_SELECTION_CHARACTERS);
    assert.equal(input.language.maxLength, Selected.MAX_LANGUAGE_CHARACTERS);
    assert.deepEqual(input.operation.enum, Selected.OPERATIONS);
    assert.deepEqual(manifest.requirements.acceleratorPreference, ["gpu"]);
    assert.equal(manifest.requirements.model, null);
});

test("public result schema and applet parser agree on every result bound", (t) => {
    const root = requireService(t);
    if (root === null) {
        return;
    }
    const schema = readJson(root, "schemas/selected-text-result.schema.json");
    const properties = schema.properties;
    assert.equal(properties.version.const, 1);
    assert.deepEqual(properties.operation.enum, Selected.OPERATIONS);
    assert.equal(properties.result.maxLength, Selected.MAX_RESULT_CHARACTERS);
    assert.equal(properties.tasks.maxItems, Selected.MAX_TASKS);
    assert.deepEqual(properties.accelerator.enum, ["gpu", "npu"]);
    assert.equal(
        properties.evidence.properties.span.properties.end.maximum,
        Selected.MAX_SELECTION_CHARACTERS,
    );
    assert.equal(properties.evidence.properties.span.properties.start.const, 0);
});

test("OmniTensor owns private fragments while the applet owns the explicit clipboard click", (t) => {
    const root = requireService(t);
    if (root === null) {
        return;
    }
    const plugin = fs.readFileSync(
        path.join(root, "src/omnitensor/plugins/selected_text.py"), "utf8",
    );
    const service = fs.readFileSync(path.join(root, "src/omnitensor/service.py"), "utf8");
    assert.match(plugin, /class SelectedTextPlugin/u);
    assert.match(plugin, /finally:\n\s+await self\._store\.discard\(request\.job_id\)/u);
    assert.doesNotMatch(plugin, /Gtk|Clipboard|clipboard watcher|connect\(/u);
    for (const method of ["DescribePlugins", "SubmitJob", "GetJobResult", "CancelJob"]) {
        assert.match(service, new RegExp(`def ${method}\\(`, "u"));
    }
});
