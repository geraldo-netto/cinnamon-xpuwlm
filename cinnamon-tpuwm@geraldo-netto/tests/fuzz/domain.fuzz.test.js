"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const Domain = require("../../lib/domain.js");
const Runtime = require("../../lib/runtime-gateway.js");

function generator(seed) {
    let state = seed >>> 0;
    return () => {
        state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
        return state / 0x1_0000_0000;
    };
}

function arbitrary(random, depth = 0) {
    const choice = Math.floor(random() * (depth > 2 ? 6 : 9));
    if (choice === 0) {
        return null;
    }
    if (choice === 1) {
        return random() < 0.5;
    }
    if (choice === 2) {
        return (random() - 0.5) * 1e12;
    }
    if (choice === 3) {
        return Number.NaN;
    }
    if (choice === 4) {
        return String.fromCodePoint(Math.floor(random() * 0x10ffff)).repeat(Math.floor(random() * 20));
    }
    if (choice === 5) {
        return undefined;
    }
    if (choice === 6) {
        return Array.from({length: Math.floor(random() * 5)}, () => arbitrary(random, depth + 1));
    }
    const object = {};
    for (let index = 0; index < Math.floor(random() * 5); index += 1) {
        object[`key-${index}`] = arbitrary(random, depth + 1);
    }
    return object;
}

test("fuzz: normalizers never throw or leak unknown profile keys", () => {
    const random = generator(0x58545055);
    for (let index = 0; index < 5000; index += 1) {
        const value = arbitrary(random);
        assert.doesNotThrow(() => Domain.sanitizeProfileState(value));
        assert.doesNotThrow(() => Domain.normalizeSnapshot(value, 1_700_000_000_000));
        const state = Domain.sanitizeProfileState(value);
        assert.deepEqual(Object.keys(state.profiles), [...Domain.PROFILE_IDS]);
        assert.equal(typeof state.paused, "boolean");
        for (const profile of Object.values(state.profiles)) {
            assert.equal(profile.weight >= Domain.MIN_WEIGHT && profile.weight <= Domain.MAX_WEIGHT, true);
        }
    }
});

test("fuzz: document parsing fails closed for arbitrary strings", () => {
    const random = generator(0x434f5241);
    for (let index = 0; index < 3000; index += 1) {
        const value = arbitrary(random);
        const text = typeof value === "string" ? value : JSON.stringify(value);
        const snapshot = Runtime.parseSnapshotDocument(text, 1_700_000_000_000);
        assert.equal(typeof snapshot.device.available, "boolean");
        assert.equal(Array.isArray(snapshot.alerts), true);
        assert.equal(Number.isFinite(snapshot.generatedAt), true);
    }
});

test("fuzz: UTF-8 counter agrees with platform encoder", () => {
    const random = generator(0x55544638);
    for (let index = 0; index < 5000; index += 1) {
        let text = "";
        const length = Math.floor(random() * 40);
        for (let character = 0; character < length; character += 1) {
            let codePoint = Math.floor(random() * 0x110000);
            if (codePoint >= 0xd800 && codePoint <= 0xdfff) {
                codePoint = 0x20;
            }
            text += String.fromCodePoint(codePoint);
        }
        assert.equal(Runtime.byteLength(text), new TextEncoder().encode(text).byteLength);
    }
});

test("fuzz: portfolio operations preserve invariants", () => {
    const random = generator(0x574f524b);
    const portfolio = new Domain.WorkloadPortfolio();
    const ids = [...Domain.PROFILE_IDS];
    for (let index = 0; index < 5000; index += 1) {
        const id = ids[Math.floor(random() * ids.length)];
        portfolio.setEnabled(id, random() < 0.5);
        portfolio.adjustWeight(id, (random() - 0.5) * 1000);
        if (random() < 0.5) {
            portfolio.pauseAll();
        } else {
            portfolio.resumeAll();
        }
        const state = portfolio.serialize();
        assert.equal(state.profiles[id].weight >= Domain.MIN_WEIGHT, true);
        assert.equal(state.profiles[id].weight <= Domain.MAX_WEIGHT, true);
        assert.equal(typeof state.profiles[id].enabled, "boolean");
    }
});
