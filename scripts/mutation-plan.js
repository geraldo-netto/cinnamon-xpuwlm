"use strict";

const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const LIBRARY_ROOT = path.join(
    ROOT,
    "files/cinnamon-xpuwlm@geraldo-netto/lib",
);
const UNIT_ROOT = path.join(ROOT, "tests/unit");
// The helper's behaviour modules. It shrank to a panel presence and a way
// into the client (XTPU-0196), so the scope shrank with it: what is left that
// can be silently wrong is the status derivation and the snapshot read.
const BEHAVIOR_MODULES = new Set([
    "panel-status",
    "snapshot-reader",
    "xpuwlm-launcher",
]);

function relativePath(file) {
    return path.relative(ROOT, file).split(path.sep).join("/");
}

function matchingUnitTests(moduleName) {
    return fs.globSync(path.join(UNIT_ROOT, `${moduleName}*.test.js`))
        .map(relativePath)
        .sort();
}

function mutationTargets() {
    return fs.globSync(path.join(LIBRARY_ROOT, "*.js"))
        .sort()
        .filter((source) => BEHAVIOR_MODULES.has(path.basename(source, ".js")))
        .map((source) => ({
            source: relativePath(source),
            tests: matchingUnitTests(path.basename(source, ".js")),
        }))
        .filter((target) => target.tests.length > 0);
}

module.exports = {BEHAVIOR_MODULES, mutationTargets};
