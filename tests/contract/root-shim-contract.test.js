"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const Package = require("../../scripts/package-applet.js");

// Cinnamon resolves a nested CommonJS import from the applet root rather than
// from the importing file's directory, so a module in lib/ that another module
// in lib/ requires needs a same-name shim at the root. The helper has none:
// every lib/ module is imported by applet.js alone, and the last bridge went
// with the translation port. The shims are derived from the require graph
// rather than listed, so this gate keeps them exact as the tree shrinks.
const INTENTIONAL_ROOT_FACADES = Object.freeze([]);

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

test("the helper needs no root bridge, because no lib/ module imports another", () => {
    const graph = Package.productionRequireGraph(Package.payloadRoot);
    assert.deepEqual([...graph.rootShims], []);
    assert.deepEqual(rootJavaScript(), []);
});

test("every maintained root shim has exact role bytes and its same-name target", {
    skip: process.env.XPUWLM_MUTATION_RUN === "1"
        ? "Stryker instruments the production shim bytes"
        : false,
}, () => {
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
