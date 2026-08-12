"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const Organizer = require("../../files/cinnamon-xpuwlm@geraldo-netto/lib/file-organizer.js");

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
        providerId: "qwen3-gpu",
        accelerator: "gpu",
        plan: [{
            fileId: "selected-file-1",
            fileName: "guide.pdf",
            sourceSha256: "a".repeat(64),
            tags: ["project-notes"],
            proposedName: "project-guide.pdf",
            proposedFolder: "Projects/Mars",
            duplicateGroup: null,
            reason: "Grounded reason",
            evidence: [{
                fileId: "selected-file-1",
                fileName: "guide.pdf",
                sourceSha256: "a".repeat(64),
                page: 1,
                span: {start: 0, end: 12},
                textSha256: "b".repeat(64),
            }],
        }],
    };
}

test("fuzz: hostile organizer leaves fail the closed review-plan boundary", () => {
    const next = random(0xf11e0a6a);
    const paths = [
        ["version"], ["requestId"], ["providerId"], ["accelerator"], ["plan"],
        ["plan", 0, "fileId"], ["plan", 0, "fileName"],
        ["plan", 0, "sourceSha256"], ["plan", 0, "tags"],
        ["plan", 0, "proposedName"], ["plan", 0, "proposedFolder"],
        ["plan", 0, "duplicateGroup"], ["plan", 0, "reason"],
        ["plan", 0, "evidence"], ["plan", 0, "evidence", 0, "page"],
        ["plan", 0, "evidence", 0, "span", "start"],
        ["plan", 0, "evidence", 0, "span", "end"],
        ["plan", 0, "evidence", 0, "textSha256"],
    ];
    const hostile = [null, true, false, -1, 0, 1.5, "", "../bad", [], {}, "x".repeat(5000001)];
    for (let iteration = 0; iteration < 2000; iteration += 1) {
        const candidate = result();
        const parts = paths[Math.floor(next() * paths.length)];
        let owner = candidate;
        for (const part of parts.slice(0, -1)) {
            owner = owner[part];
        }
        owner[parts.at(-1)] = hostile[Math.floor(next() * hostile.length)];
        try {
            const accepted = Organizer.organizationPlan(candidate, "job-1");
            assert.equal(accepted.requestId, "job-1");
        } catch (error) {
            assert.equal(error.code, "result-invalid", `iteration ${iteration}`);
        }
    }
});

test("property: bounded safe relative folders and kebab tags preserve order exactly", () => {
    const next = random(0x0f01de12);
    for (let iteration = 1; iteration <= 1000; iteration += 1) {
        const parts = Array.from({length: 1 + Math.floor(next() * 4)}, (_value, index) => (
            `folder-${iteration}-${index}`
        ));
        const folder = parts.join("/");
        const tags = Array.from({length: Math.floor(next() * 8)}, (_value, index) => (
            `tag-${iteration}-${index}`
        ));
        assert.equal(Organizer.safeFolder(folder), true);
        const candidate = result();
        candidate.plan[0].proposedFolder = folder;
        candidate.plan[0].tags = tags;
        assert.deepEqual(Organizer.organizationPlan(candidate, "job-1").plan[0].tags, tags);
    }
});
