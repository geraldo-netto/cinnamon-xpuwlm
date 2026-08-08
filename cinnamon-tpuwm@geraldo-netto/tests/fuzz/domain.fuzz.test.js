"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const Domain = require("../../lib/domain.js");
const FailureBackoff = require("../../lib/failure-log-backoff.js");
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

test("fuzz: warning backoff follows bounded exponential state transitions", () => {
    const random = generator(0x4241434b);
    const warnings = [];
    const initialDelayMs = 4;
    const maximumDelayMs = 32;
    const backoff = new FailureBackoff.FailureWarningBackoff({
        logger: {warn: (message) => warnings.push(message)},
        initialDelayMs,
        maximumDelayMs,
    });
    let nowMs = 0;

    for (let cycle = 0; cycle < 100; cycle += 1) {
        const key = `channel-${cycle % 3}`;
        backoff.recover(key);
        let delayMs = initialDelayMs;
        assert.equal(backoff.warn(key, `first-${cycle}`, nowMs), true);
        for (let emission = 0; emission < 20; emission += 1) {
            const beforeDeadline = Math.floor(random() * delayMs);
            assert.equal(backoff.warn(key, "suppressed", nowMs + beforeDeadline), false);
            nowMs += delayMs;
            assert.equal(backoff.warn(key, `due-${cycle}-${emission}`, nowMs), true);
            delayMs = Math.min(delayMs * 2, maximumDelayMs);
        }
        nowMs += 1;
    }
    assert.equal(warnings.length, 2100);
});

test("fuzz: non-finite delays and backward clocks remain bounded", () => {
    const random = generator(0x434c4f43);
    const nonFiniteValues = [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY];
    const warnings = [];

    for (let cycle = 0; cycle < 500; cycle += 1) {
        const backoff = new FailureBackoff.FailureWarningBackoff({
            logger: {warn: (message) => warnings.push(message)},
            initialDelayMs: nonFiniteValues[Math.floor(random() * nonFiniteValues.length)],
            maximumDelayMs: nonFiniteValues[Math.floor(random() * nonFiniteValues.length)],
        });
        const key = `channel-${cycle}`;
        const start = Math.floor(random() * 1_000_000) + FailureBackoff.FAILURE_INITIAL_DELAY_MS;
        assert.equal(backoff.warn(key, "first", start), true);
        assert.equal(backoff.warn(key, "before-default-delay", start + FailureBackoff.FAILURE_INITIAL_DELAY_MS - 1), false);
        assert.equal(backoff.warn(key, "at-default-delay", start + FailureBackoff.FAILURE_INITIAL_DELAY_MS), true);

        const rolledBackAt = start - Math.floor(random() * FailureBackoff.FAILURE_MAX_DELAY_MS) - 1;
        assert.equal(backoff.warn(key, "after-rollback", rolledBackAt), true);
        assert.equal(backoff.warn(key, "bounded-suppression", rolledBackAt + FailureBackoff.FAILURE_INITIAL_DELAY_MS - 1), false);
        assert.equal(backoff.warn(key, "bounded-emission", rolledBackAt + FailureBackoff.FAILURE_INITIAL_DELAY_MS), true);
    }
    assert.equal(warnings.length, 2000);
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
