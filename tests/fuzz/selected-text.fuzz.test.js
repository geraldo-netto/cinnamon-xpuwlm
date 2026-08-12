"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const Selected = require("../../files/cinnamon-xpuwlm@geraldo-netto/lib/selected-text.js");

function random(seed) {
    let state = seed >>> 0;
    return () => {
        state = ((state * 1664525) + 1013904223) >>> 0;
        return state / 0x100000000;
    };
}

function result() {
    return {
        version: 1,
        requestId: "job-1",
        operation: "extract-tasks",
        result: "Two tasks were found.",
        tasks: ["Review logs", "Restart service"],
        providerId: "qwen3-gpu",
        accelerator: "gpu",
        evidence: {
            selectionSha256: "a".repeat(64),
            span: {start: 0, end: 14},
            textSha256: "a".repeat(64),
        },
    };
}

test("fuzz: hostile selected-text result leaves fail the closed public boundary", () => {
    const next = random(0x5e1ec7ed);
    const paths = [
        ["version"], ["requestId"], ["operation"], ["result"], ["tasks"],
        ["providerId"], ["accelerator"], ["evidence", "selectionSha256"],
        ["evidence", "textSha256"], ["evidence", "span", "start"],
        ["evidence", "span", "end"],
    ];
    const hostile = [null, true, false, -1, 0, 1.5, "", "bad value", [], {}, "x".repeat(32769)];
    for (let iteration = 0; iteration < 2000; iteration += 1) {
        const candidate = result();
        const parts = paths[Math.floor(next() * paths.length)];
        let owner = candidate;
        for (const part of parts.slice(0, -1)) {
            owner = owner[part];
        }
        owner[parts.at(-1)] = hostile[Math.floor(next() * hostile.length)];
        try {
            const accepted = Selected.selectedTextResult(candidate, "job-1", "extract-tasks");
            assert.equal(accepted.requestId, "job-1");
        } catch (error) {
            assert.equal(error.code, "result-invalid", `iteration ${iteration}`);
        }
    }
});

test("property: every bounded explicit Unicode selection is preserved without normalization", () => {
    const next = random(0x0e5e1ec7);
    const alphabet = ["a", "é", "中", "\n", " ", "🙂"];
    for (let iteration = 1; iteration <= 1000; iteration += 1) {
        const length = 1 + Math.floor(next() * 96);
        const value = Array.from(
            {length}, () => alphabet[Math.floor(next() * alphabet.length)],
        ).join("");
        if (value.trim() === "") {
            assert.throws(() => Selected.normalizedSelection(value), /selection-invalid/u);
        } else {
            assert.equal(Selected.normalizedSelection(value), value);
        }
    }
});
