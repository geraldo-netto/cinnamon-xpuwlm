"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const SCHEMA_PATH = path.resolve(
    __dirname,
    "../../files/cinnamon-xpuwlm@geraldo-netto/settings-schema.json",
);

test("regression: new applet instances refresh once per second by default", () => {
    const schema = JSON.parse(fs.readFileSync(SCHEMA_PATH, "utf8"));
    const setting = schema["refresh-interval"];

    assert.equal(setting.type, "scale");
    assert.equal(setting.default, 1);
    assert.equal(setting.min, 1);
    assert.equal(setting.step, 1);
    assert.equal(setting.units, "seconds");
});
