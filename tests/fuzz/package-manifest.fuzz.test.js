"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const Package = require("../../scripts/package-applet.js");

function nextRandom(state) {
    return ((state * 1664525) + 1013904223) >>> 0;
}

const NAME_CHARS = "abcdefghijklmnopqrstuvwxyz0123456789-_./";

function randomName(next) {
    const length = 1 + next() % 24;
    let name = "";
    for (let index = 0; index < length; index += 1) {
        name += NAME_CHARS[next() % (NAME_CHARS.length - 2)];
    }
    return name;
}

test("property: checksum manifests round-trip for arbitrary payload shapes", () => {
    let state = 0x5EED;
    const next = () => {
        state = nextRandom(state);
        return state;
    };
    for (let round = 0; round < 200; round += 1) {
        const entries = new Map();
        for (let index = 0; index < next() % 8; index += 1) {
            entries.set(`dir-${index}/${randomName(next)}`, Package.sha256Hex(Buffer.from(`${next()}`)));
        }
        const manifest = [...entries]
            .map(([name, hash]) => `${hash}  ${name}\n`)
            .join("");
        assert.deepEqual([...Package.parseChecksums(manifest)], [...entries]);
    }
});

test("property: corrupted checksum lines always fail loudly", () => {
    let state = 0xDEAD;
    const next = () => {
        state = nextRandom(state);
        return state;
    };
    const corruptions = [
        (hash, name) => `${hash} ${name}`,
        (hash, name) => `${hash.slice(0, 63)}  ${name}`,
        (hash, name) => `${hash.toUpperCase()}  ${name}`,
        (hash) => `${hash}  `,
        () => "garbage",
    ];
    for (let round = 0; round < 200; round += 1) {
        const hash = Package.sha256Hex(Buffer.from(`${next()}`));
        const corrupt = corruptions[next() % corruptions.length](hash, randomName(next));
        assert.throws(() => Package.parseChecksums(`${corrupt}\n`), /Malformed/u);
    }
});

test("property: archive member names are accepted exactly up to the ustar bound", () => {
    for (let length = 90; length <= 110; length += 1) {
        const name = "n".repeat(length);
        if (length <= 100) {
            const header = Package.tarHeader(name, 0, "0");
            assert.equal(header.length, Package.BLOCK_SIZE);
            assert.equal(header.subarray(0, length).toString("utf8"), name);
        } else {
            assert.throws(() => Package.tarHeader(name, 0, "0"), /100 characters/u);
        }
    }
});
