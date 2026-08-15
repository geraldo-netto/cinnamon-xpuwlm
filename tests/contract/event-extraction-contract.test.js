"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const EventImport = require("../../files/cinnamon-xpuwlm@geraldo-netto/lib/event-import.js");
const Inventory = require("../../files/cinnamon-xpuwlm@geraldo-netto/lib/plugin-inventory.js");

const repositoryRoot = path.resolve(__dirname, "../..");

function serviceRoot() {
    const configured = process.env.XPUWLM_OMNITENSOR_ROOT;
    const candidate = configured || path.resolve(repositoryRoot, "../omnitensor");
    return fs.existsSync(path.join(candidate, "schemas/plugin-inventory.schema.json"))
        ? candidate
        : null;
}

function requireService(t) {
    const root = serviceRoot();
    if (root === null) {
        t.skip(
            "the OmniTensor checkout is unavailable; "
            + "set XPUWLM_OMNITENSOR_ROOT to run the cross-repository event gate",
        );
    }
    return root;
}

function readJson(root, relativePath) {
    return JSON.parse(fs.readFileSync(path.join(root, relativePath), "utf8"));
}

test("live inventory limits match the fail-closed event client", (t) => {
    const root = requireService(t);
    if (root === null) {
        return;
    }
    const schema = readJson(root, "schemas/plugin-inventory.schema.json");
    const plugin = schema.$defs.plugin;

    assert.equal(schema.properties.version.const, Inventory.INVENTORY_VERSION);
    assert.equal(schema.properties.plugins.maxItems, Inventory.MAX_PLUGINS);
    assert.deepEqual(plugin.required.sort(), [
        "artifacts", "configurationSchema", "distribution", "id", "permissions",
        "protocol", "secretConfigurationKeys", "source", "triggers", "version", "workerState",
    ].sort());
    assert.equal(plugin.additionalProperties, false);
    assert.ok(plugin.properties.protocol.properties.capabilities.maxItems >= 1);
    assert.ok(plugin.properties.permissions.maxItems >= 1);
});

test("event provider manifest keeps execution explicit and bounded", (t) => {
    const root = requireService(t);
    if (root === null) {
        return;
    }
    const manifest = readJson(root, "plugin-manifests/event-extraction.json");
    const declaration = manifest.plugin;
    const sources = declaration.schemas.input.properties.sources;

    assert.equal(manifest.id, EventImport.EVENT_PROFILE_ID);
    assert.equal(declaration.entryPoint, EventImport.EVENT_PROFILE_ID);
    assert.ok(declaration.protocol.capabilities.includes("execute"));
    assert.deepEqual(declaration.triggers, ["manual"]);
    assert.deepEqual(declaration.permissions, [
        "accelerator:gpu",
        "files:read-selected",
    ]);
    assert.equal(sources.minItems, 1);
    assert.equal(sources.maxItems, EventImport.MAX_SOURCES);
    assert.equal(sources.uniqueItems, true);
    assert.deepEqual(manifest.requirements.acceleratorPreference, ["gpu"]);
});

test("grounded result bounds match the service schema", (t) => {
    const root = requireService(t);
    if (root === null) {
        return;
    }
    const schema = readJson(root, "schemas/event-extraction-result.schema.json");
    const event = schema.$defs.event.properties;
    const evidence = schema.$defs.evidence.properties;

    assert.equal(schema.properties.version.const, 1);
    assert.equal(schema.properties.events.maxItems, EventImport.MAX_EVENTS);
    assert.equal(event.evidence.maxItems, EventImport.MAX_EVIDENCE);
    assert.equal(evidence.sourceRef.pattern, EventImport.PRIVATE_REFERENCE.source);
    assert.equal(evidence.sourceSha256.pattern, EventImport.DIGEST.source);
    assert.equal(event.candidateId.pattern, EventImport.REQUEST_ID.source);
    assert.equal(schema.properties.code.pattern, EventImport.CODE.source);
});

test("OmniTensor exports every control method the event workflow calls", (t) => {
    const root = requireService(t);
    if (root === null) {
        return;
    }
    const source = fs.readFileSync(
        path.join(root, "src/omnitensor/socket_transport.py"), "utf8",
    );
    for (const method of ["describe-plugins", "submit-job", "get-job-result", "cancel-job"]) {
        assert.match(source, new RegExp(`"${method}": `, "u"), method);
    }
});
