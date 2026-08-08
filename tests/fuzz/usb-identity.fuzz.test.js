"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const Cinnamon = require("../../files/cinnamon-tpuwm@geraldo-netto/lib/cinnamon-runtime.js");

function generator(seed) {
    let state = seed >>> 0;
    return () => {
        state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
        return state;
    };
}

function hexIdentifier(random) {
    return (random() & 0xffff).toString(16).padStart(4, "0");
}

test("property: only exact Coral USB vendor/product pairs are accepted", () => {
    const random = generator(0x58545055);
    const allowed = new Set(["18d1:9302", "1a6e:089a"]);
    const fixedPairs = [
        ["18d1", "9302"],
        ["1a6e", "089a"],
        ["18d1", "089a"],
        ["1a6e", "9302"],
    ];

    for (let index = 0; index < 4096; index += 1) {
        const [vendor, product] = index < fixedPairs.length
            ? fixedPairs[index]
            : [hexIdentifier(random), hexIdentifier(random)];
        const identity = Cinnamon.findCoralUsbIdentity(vendor, product);
        assert.equal(identity !== null, allowed.has(`${vendor}:${product}`));
    }
});
