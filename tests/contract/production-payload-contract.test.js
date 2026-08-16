"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const Package = require("../../scripts/package-applet.js");

// The helper's whole production surface. This list is the point of the gate:
// a module that is present but unreachable is a module nobody ships and
// nobody notices, which is how fourteen unwired libraries once accumulated
// here. Adding a file to lib/ without wiring it now fails.
const HELPER_MODULES = Object.freeze([
    "applet.js",
    "lib/i18n.js",
    "lib/panel-status.js",
    "lib/snapshot-reader.js",
    "lib/xpuwlm-launcher.js",
]);

test("applet payload JavaScript is exactly the production graph and its Cinnamon shims", () => {
    const graph = Package.productionRequireGraph(Package.payloadRoot);
    const payload = Package.appletPayloadFiles(Package.payloadRoot);
    const javascript = payload.filter((relativePath) => relativePath.endsWith(".js"));
    assert.deepEqual(
        javascript,
        [...graph.modules, ...graph.rootShims].sort(Package.compareText),
    );
    assert.equal(Object.isFrozen(graph), true);
    assert.equal(Object.isFrozen(graph.modules), true);
    assert.equal(Object.isFrozen(graph.rootShims), true);
});

test("the helper ships the panel, the reader, and the launcher — and nothing else", () => {
    const graph = Package.productionRequireGraph(Package.payloadRoot);
    assert.deepEqual([...graph.modules].sort(Package.compareText), [...HELPER_MODULES]);
    assert.deepEqual([...graph.rootShims], ["i18n.js"]);
});

test("every JavaScript file present in the payload is reachable from the applet", () => {
    const graph = Package.productionRequireGraph(Package.payloadRoot);
    const reachable = new Set([...graph.modules, ...graph.rootShims]);
    const present = Package.payloadFiles(Package.payloadRoot)
        .filter((relativePath) => relativePath.endsWith(".js"));
    assert.deepEqual(present.filter((relativePath) => !reachable.has(relativePath)), []);
});

test("the staged payload carries the assets a panel presence needs", () => {
    const payload = Package.appletPayloadFiles(Package.payloadRoot);
    for (const relativePath of [
        "metadata.json",
        "settings-schema.json",
        "stylesheet.css",
        "icon.png",
    ]) {
        assert.equal(payload.includes(relativePath), true, relativePath);
    }
    assert.equal(
        payload.some((relativePath) => relativePath.startsWith("icons/")),
        true,
        "panel status icons",
    );
});

test("the helper ships no mirrored contract schemas", () => {
    // The client validates the runtime's documents against the canonical
    // schemas. A copy here would be a second reader to keep in parity, which
    // is exactly what the split removed.
    assert.deepEqual(
        Package.payloadFiles(Package.payloadRoot)
            .filter((relativePath) => relativePath.endsWith(".schema.json")),
        [],
    );
});
