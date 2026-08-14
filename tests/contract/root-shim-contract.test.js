"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const Package = require("../../scripts/package-applet.js");

const INTENTIONAL_ROOT_FACADES = Object.freeze([
    "artifact-qualification.js",
    "background-execution.js",
    "caption-export.js",
    "cinnamon-platform-adapter.js",
    "cinnamon-runtime.js",
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
    "workflow-wiring.js",
    "workload-benchmark.js",
    "workload-result.js",
]);

function rootJavaScript() {
    return fs.readdirSync(Package.payloadRoot, {withFileTypes: true})
        .filter((entry) => entry.isFile() && entry.name.endsWith(".js"))
        .map((entry) => entry.name)
        .filter((name) => name !== "applet.js")
        .sort(Package.compareText);
}

function shimSource(basename, role) {
    const explanation = role === "bridge"
        ? "Cinnamon resolves nested CommonJS imports from the applet root."
        : "Maintained public facade; production does not load it as a root bridge.";
    return [
        "\"use strict\";",
        "",
        `// ${explanation}`,
        `module.exports = require("./lib/${basename}");`,
        "",
    ].join("\n");
}

test("root shim inventory is exactly production bridges plus intentional facades", () => {
    const graph = Package.productionRequireGraph(Package.payloadRoot);
    const overlap = INTENTIONAL_ROOT_FACADES.filter((name) => graph.rootShims.includes(name));
    assert.deepEqual(overlap, []);
    assert.deepEqual(
        rootJavaScript(),
        [...graph.rootShims, ...INTENTIONAL_ROOT_FACADES].sort(Package.compareText),
    );
});

test("every maintained root shim has exact role bytes and its same-name target", () => {
    const graph = Package.productionRequireGraph(Package.payloadRoot);
    for (const [role, basenames] of [
        ["bridge", graph.rootShims],
        ["facade", INTENTIONAL_ROOT_FACADES],
    ]) {
        for (const basename of basenames) {
            const shimPath = path.join(Package.payloadRoot, basename);
            const targetPath = path.join(Package.payloadRoot, "lib", basename);
            assert.equal(fs.lstatSync(shimPath).isFile(), true, basename);
            assert.equal(fs.lstatSync(targetPath).isFile(), true, `lib/${basename}`);
            assert.equal(fs.readFileSync(shimPath, "utf8"), shimSource(basename, role), basename);
            assert.deepEqual(Package.sourceRequires(fs.readFileSync(shimPath, "utf8"), basename), [
                `./lib/${basename}`,
            ]);
        }
    }
});
