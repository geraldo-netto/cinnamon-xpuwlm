"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const Paths = require("../../files/cinnamon-xpuwlm@geraldo-netto/lib/path-port.js");

function random(seed) {
    let state = seed >>> 0;
    return () => {
        state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
        return state / 0x100000000;
    };
}

test("property: safe Windows paths stay absolute and forbid ambiguous syntax", () => {
    const next = random(0x0089);
    const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789._-";
    for (let iteration = 0; iteration < 2000; iteration += 1) {
        let name = "";
        const length = 1 + Math.floor(next() * 32);
        for (let index = 0; index < length; index += 1) {
            name += alphabet[Math.floor(next() * alphabet.length)];
        }
        const candidate = `C:\\safe\\${name}`;
        if (Paths.WINDOWS_PATHS.isSafeName(name)) {
            assert.equal(Paths.WINDOWS_PATHS.isSafeAbsolute(candidate), true);
            assert.equal(Paths.WINDOWS_PATHS.join("C:\\safe", name), candidate);
        }
        for (const hostile of [
            `${candidate}:stream`,
            `${candidate}/mixed`,
            `C:\\safe\\..\\${name}`,
            `\\\\?\\${candidate}`,
        ]) {
            assert.equal(Paths.WINDOWS_PATHS.isSafeAbsolute(hostile), false);
        }
    }
});
