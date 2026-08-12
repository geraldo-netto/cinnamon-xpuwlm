"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const Port = require(
    "../../files/cinnamon-xpuwlm@geraldo-netto/lib/external-chooser-port.js"
);

function generator(seed) {
    let state = seed >>> 0;
    return () => {
        state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
        return state;
    };
}

test("chooser output parser either returns bounded absolute paths or rejects input", () => {
    const next = generator(0x585055);
    const alphabet = ["/", "a", " ", ".", "\n", "\0", Port.PATH_SEPARATOR, "é", "文"];
    for (let sample = 0; sample < 1_000; sample += 1) {
        const length = next() % 180;
        let value = "";
        for (let index = 0; index < length; index += 1) {
            value += alphabet[next() % alphabet.length];
        }
        const multiple = (next() & 1) === 1;
        try {
            const paths = Port.parseSelection(value, multiple);
            assert.ok(paths.length <= Port.MAX_PATHS);
            assert.ok(paths.every((path) => path.startsWith("/")));
            assert.ok(paths.every((path) => !path.includes("\0")));
            assert.ok(paths.every((path) => !path.includes(Port.PATH_SEPARATOR)));
            assert.ok(paths.every((path) => [...path].length <= Port.MAX_PATH_LENGTH));
        } catch (error) {
            assert.ok(error instanceof TypeError || error instanceof RangeError);
        }
    }
});
