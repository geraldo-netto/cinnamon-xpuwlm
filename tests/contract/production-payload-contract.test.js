"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const Package = require("../../scripts/package-applet.js");

const UNREACHABLE_LIBRARIES = Object.freeze([
    "artifact-qualification.js",
    "background-execution.js",
    "caption-export.js",
    "deterministic-action-port.js",
    "file-auto-tagging.js",
    "file-categorization.js",
    "generic-workflow-menu-view.js",
    "generic-workflow-surface.js",
    "image-duplicate-benchmark.js",
    "presentation-planning.js",
    "presentation-review.js",
    "readiness-acceptance.js",
    "rehearsal-briefing.js",
    "routine-recognition.js",
    "runtime-control-service.js",
    "screenshot-assistant.js",
    "telemetry-window.js",
    "workload-benchmark.js",
    "workload-result.js",
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

test("staged sources remain testable while unreachable module and shim pairs stay unshipped", () => {
    const sources = Package.payloadFiles(Package.payloadRoot);
    const payload = Package.appletPayloadFiles(Package.payloadRoot);
    for (const basename of UNREACHABLE_LIBRARIES) {
        for (const relativePath of [basename, `lib/${basename}`]) {
            assert.equal(sources.includes(relativePath), true, relativePath);
            assert.equal(payload.includes(relativePath), false, relativePath);
        }
    }
});

test("workflow wiring ships root shims for its injected path and chooser ports", () => {
    const graph = Package.productionRequireGraph(Package.payloadRoot);
    const payload = Package.appletPayloadFiles(Package.payloadRoot);
    for (const basename of [
        "clipboard-selection-port.js", "document-source-port.js", "media-source-port.js",
        "path-port.js",
    ]) {
        assert.equal(graph.modules.includes(`lib/${basename}`), true, basename);
        assert.equal(graph.rootShims.includes(basename), true, basename);
        assert.equal(payload.includes(`lib/${basename}`), true, basename);
        assert.equal(payload.includes(basename), true, basename);
    }
    assert.equal(graph.modules.includes("lib/cinnamon-runtime.js"), true);
    assert.equal(graph.rootShims.includes("cinnamon-runtime.js"), false);
    assert.equal(payload.includes("cinnamon-runtime.js"), false);
    assert.equal(graph.modules.includes("lib/workflow-wiring.js"), true);
    assert.equal(graph.rootShims.includes("workflow-wiring.js"), false);
});
