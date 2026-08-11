"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const Cinnamon = require("../../files/cinnamon-xpuwlm@geraldo-netto/lib/cinnamon-runtime.js");

function valueAt(index) {
    const values = [
        null,
        true,
        false,
        -1,
        0,
        1,
        2,
        60,
        61,
        1.5,
        "",
        " ",
        "/tmp/runtime.json",
        "bad\0path",
        [],
        {},
    ];
    return values[index % values.length];
}

test("fuzz: legacy identity projection emits only bounded typed settings", () => {
    for (let index = 0; index < 512; index += 1) {
        const document = {
            "show-panel-label": {value: valueAt(index)},
            "refresh-interval": {value: valueAt(index * 3 + 1)},
            "runtime-state-path": {value: valueAt(index * 7 + 2)},
            [`unknown-${index}`]: {value: valueAt(index * 11 + 3)},
        };
        const projected = Cinnamon.migratedIdentitySettings(document);
        assert.deepEqual(
            Object.keys(projected).sort(),
            Object.keys(projected).filter((key) => [
                "refresh-interval",
                "runtime-state-path",
                "show-panel-label",
            ].includes(key)).sort(),
        );
        if (Object.hasOwn(projected, "show-panel-label")) {
            assert.equal(typeof projected["show-panel-label"], "boolean");
        }
        if (Object.hasOwn(projected, "refresh-interval")) {
            assert.equal(Number.isInteger(projected["refresh-interval"]), true);
            assert.equal(projected["refresh-interval"] >= 1, true);
            assert.equal(projected["refresh-interval"] <= 60, true);
        }
        if (Object.hasOwn(projected, "runtime-state-path")) {
            assert.equal(typeof projected["runtime-state-path"], "string");
            assert.equal(projected["runtime-state-path"].trim() !== "", true);
            assert.equal(projected["runtime-state-path"].includes("\0"), false);
            assert.equal(projected["runtime-state-path"].length <= 4096, true);
        }
    }
});

test("fuzz: non-record legacy roots always project to an empty migration", () => {
    for (const root of [null, undefined, true, false, 0, 1, "text", [], [1], () => {}]) {
        assert.deepEqual(Cinnamon.migratedIdentitySettings(root), {});
    }
});
