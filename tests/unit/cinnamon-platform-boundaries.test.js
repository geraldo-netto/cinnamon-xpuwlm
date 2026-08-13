"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const APPLET_ROOT = path.resolve(
    __dirname,
    "../../files/cinnamon-xpuwlm@geraldo-netto",
);
const ADAPTERS = Object.freeze([
    "gio-file-adapter",
    "cinnamon-workload-adapter",
    "linux-device-adapter",
    "cinnamon-state-adapter",
    "cinnamon-host-adapter",
    "cinnamon-image-adapter",
    "cinnamon-dbus-adapter",
]);

test("runtime facade composes narrow platform adapters without changing exports", () => {
    const facade = require(path.join(APPLET_ROOT, "lib/cinnamon-runtime.js"));
    const composed = Object.assign(
        {},
        ...ADAPTERS.map((name) => require(path.join(APPLET_ROOT, `lib/${name}.js`))),
    );

    assert.deepEqual(Object.keys(facade).sort(), Object.keys(composed).sort());
    for (const key of Object.keys(composed)) {
        assert.equal(facade[key], composed[key], key);
    }
});

test("Cinnamon root bridges expose each platform adapter", () => {
    for (const name of ADAPTERS) {
        const bridge = require(path.join(APPLET_ROOT, `${name}.js`));
        const adapter = require(path.join(APPLET_ROOT, `lib/${name}.js`));
        assert.equal(bridge, adapter, name);
    }
});

test("runtime facade stays a composition root instead of regrowing adapter logic", () => {
    const source = fs.readFileSync(
        path.join(APPLET_ROOT, "lib/cinnamon-runtime.js"),
        "utf8",
    );

    assert.equal(source.split("\n").length < 40, true);
    assert.doesNotMatch(source, /class Cinnamon|function (?:readFile|detect|callRuntime)/u);
});
