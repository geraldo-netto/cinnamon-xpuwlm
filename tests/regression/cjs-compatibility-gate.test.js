"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const ROOT = path.resolve(__dirname, "../..");
const metadata = JSON.parse(fs.readFileSync(
    path.join(ROOT, "files/cinnamon-tpuwm@geraldo-netto/metadata.json"),
    "utf8",
));
const packageJson = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
const smoke = fs.readFileSync(path.join(ROOT, "tests/cjs/production-smoke.js"), "utf8");
const workflow = fs.readFileSync(path.join(ROOT, ".github/workflows/applet-quality.yml"), "utf8");

test("CJS smoke command covers root and library production sources", () => {
    assert.equal(packageJson.scripts["test:cjs"], [
        '"${TPUWM_CJS:-cjs}"',
        "tests/cjs/production-smoke.js",
        "files/cinnamon-tpuwm@geraldo-netto/*.js",
        "files/cinnamon-tpuwm@geraldo-netto/lib/*.js",
    ].join(" "));
    assert.match(smoke, /for \(const filename of sourceFiles\) \{\s+compile\(filename\);/u);
    assert.match(smoke, /loadModule\(filename\)/u);
    assert.match(smoke, /path_get_basename\(filename\) !== "applet\.js"/u);
});

test("compatibility matrix pins the declared runtime floor and current line", () => {
    assert.deepEqual(metadata["cinnamon-version"], ["6.0", "6.2", "6.4", "6.6"]);
    assert.match(workflow, /cinnamon-version: "6\.0"\s+cjs-version: "6\.0\.0"/u);
    assert.match(workflow, /cinnamon-version: "6\.6"\s+cjs-version: "115\.1"/u);
    assert.match(workflow, /cjs=6\.0\.0-2build3/u);
    assert.match(workflow, /cjs_115\.1\+zena_amd64\.deb/u);
    assert.match(workflow, /300b989cff2c7c98fb7f25998e984763ff993b2760d19449c6631033222d6980/u);
    assert.match(workflow, /3b376cb554a8d3a559b1d34b6cd244554422e099c7708242de2fe94648838e79/u);
    assert.match(workflow, /run: npm run test:cjs/u);
});

test("CI keeps quality gates without running mutation tests", () => {
    for (const command of [
        "lint",
        "test:syntax",
        "check:workloads",
        "test:coverage",
        "test:fuzz",
        "test:visual",
    ]) {
        assert.match(packageJson.scripts["test:ci"], new RegExp(`npm run ${command}`));
    }
    assert.doesNotMatch(packageJson.scripts["test:ci"], /test:mutation/u);
    assert.match(packageJson.scripts.test, /test:mutation/u);
    assert.match(workflow, /run: npm run test:ci/u);
    assert.doesNotMatch(workflow, /run: npm test(?:\s|$)/mu);
});
