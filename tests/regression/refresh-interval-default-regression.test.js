"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const APPLET_ROOT = path.resolve(__dirname, "../../files/cinnamon-xpuwlm@geraldo-netto");
const SCHEMA_PATH = path.join(APPLET_ROOT, "settings-schema.json");
const APPLET_SOURCE = path.join(APPLET_ROOT, "applet.js");
const DEFAULT_CONSTANT = /^const DEFAULT_REFRESH_SECONDS = (?<seconds>\d+);$/mu;

test("regression: new applet instances refresh once per second by default", () => {
    const schema = JSON.parse(fs.readFileSync(SCHEMA_PATH, "utf8"));
    const setting = schema["refresh-interval"];

    assert.equal(setting.type, "scale");
    assert.equal(setting.default, 1);
    assert.equal(setting.min, 1);
    assert.equal(setting.step, 1);
    assert.equal(setting.units, "seconds");
});

// Two defaults for one interval is a default that disagrees with itself: the
// schema is what a new instance actually gets, and the constant is only what
// the applet holds until the binding lands. A reader who finds the constant
// first must not be told a different number from the one the panel obeys.
test("regression: the applet constant and the shipped schema name one interval", () => {
    const schema = JSON.parse(fs.readFileSync(SCHEMA_PATH, "utf8"));
    const match = DEFAULT_CONSTANT.exec(fs.readFileSync(APPLET_SOURCE, "utf8"));

    assert.notEqual(match, null, "applet.js no longer declares DEFAULT_REFRESH_SECONDS");
    assert.equal(Number(match.groups.seconds), schema["refresh-interval"].default);
});
