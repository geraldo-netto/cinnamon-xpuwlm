"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const fs = require("node:fs");
const path = require("node:path");

const Package = require("../../scripts/package-applet.js");
const PanelStatus = require("../../files/cinnamon-xpuwlm@geraldo-netto/lib/panel-status.js");

// The helper's whole production surface. This list is the point of the gate:
// a module that is present but unreachable is a module nobody ships and
// nobody notices, which is how fourteen unwired libraries once accumulated
// here. Adding a file to lib/ without wiring it now fails.
const HELPER_MODULES = Object.freeze([
    "applet.js",
    "lib/panel-status.js",
    "lib/settings-window-placer.js",
    "lib/snapshot-reader.js",
    "lib/window-placement.js",
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

test("the helper ships the panel, the reader, the launcher and the placer — nothing else", () => {
    const graph = Package.productionRequireGraph(Package.payloadRoot);
    assert.deepEqual([...graph.modules].sort(Package.compareText), [...HELPER_MODULES]);
    assert.deepEqual([...graph.rootShims], []);
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

// A rule for a surface the helper no longer draws is dead payload nobody can
// see is dead: the sheet kept `.xpuwlm-panel-label` and a comment about the
// text beside the icon long after the panel stopped writing any.
test("the stylesheet styles exactly the statuses the panel can draw", () => {
    const css = fs.readFileSync(
        path.join(Package.payloadRoot, "stylesheet.css"),
        "utf8",
    );
    const classes = [...css.matchAll(/\.(xpuwlm-[a-z-]+)/gu)].map((match) => match[1]);

    assert.deepEqual(
        [...new Set(classes)].sort(Package.compareText),
        PanelStatus.PANEL_STATUSES
            .map((status) => `xpuwlm-panel-${status}`)
            .sort(Package.compareText),
    );
});
