"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const Events = require("../../files/cinnamon-xpuwlm@geraldo-netto/lib/event-import.js");
const Inventory = require("../../files/cinnamon-xpuwlm@geraldo-netto/lib/plugin-inventory.js");

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
        outcome: "succeeded",
        code: "events-extracted",
        detail: "review",
        duplicatePolicy: "keep-first-title-start-location",
        confirmationState: "pending",
        events: [{
            candidateId: "event-1",
            title: "Planning",
            start: "2026-08-11T10:00:00+02:00",
            end: null,
            timezone: "Europe/Rome",
            location: null,
            confirmation: "pending",
            evidence: [{
                sourceRef: "private:job:source:1",
                sourceSha256: "a".repeat(64),
                page: null,
                span: {start: 0, end: 8},
                textSha256: "b".repeat(64),
            }],
        }],
    };
}

test("fuzz: hostile event-result leaves never cross the grounded boundary", () => {
    const next = random(0xe7e471);
    const paths = [
        ["version"], ["requestId"], ["outcome"], ["code"], ["duplicatePolicy"],
        ["confirmationState"], ["events", 0, "candidateId"], ["events", 0, "title"],
        ["events", 0, "start"], ["events", 0, "timezone"],
        ["events", 0, "confirmation"], ["events", 0, "evidence", 0, "sourceRef"],
        ["events", 0, "evidence", 0, "sourceSha256"],
        ["events", 0, "evidence", 0, "span", "start"],
        ["events", 0, "evidence", 0, "span", "end"],
        ["events", 0, "evidence", 0, "textSha256"],
    ];
    const hostile = [null, true, false, -1, 0, 1.5, "", "bad value", [], {}, "x".repeat(5001)];
    for (let iteration = 0; iteration < 2000; iteration += 1) {
        const candidate = result();
        const parts = paths[Math.floor(next() * paths.length)];
        let owner = candidate;
        for (const part of parts.slice(0, -1)) {
            owner = owner[part];
        }
        owner[parts.at(-1)] = hostile[Math.floor(next() * hostile.length)];
        try {
            const accepted = Events.groundedEventResult(candidate, "job-1");
            assert.equal(accepted.candidates.length, 1);
        } catch (error) {
            assert.equal(error.code, "result-invalid", `iteration ${iteration}`);
        }
    }
});

test("property: explicit source selection never admits unsupported or duplicate paths", () => {
    const next = random(0x5012ce);
    const suffixes = [".txt", ".pdf", ".png", ".exe", "", ".TXT"];
    for (let iteration = 0; iteration < 1000; iteration += 1) {
        const suffix = suffixes[Math.floor(next() * suffixes.length)];
        const path = `/private/source-${iteration}${suffix}`;
        const source = {path, name: `source-${iteration}${suffix}`, size: 1, regular: true, symlink: false};
        if (Events.isSupportedSourceName(path)) {
            assert.equal(Events.selectedSources([source])[0].path, path);
            assert.throws(() => Events.selectedSources([source, source]), /same source/u);
        } else {
            assert.throws(() => Events.selectedSources([source]), /supported/u);
        }
    }
});

test("property: ICS metacharacters cannot inject an unfolded calendar property", () => {
    const next = random(0x1ca1e7);
    const alphabet = ["a", "é", ";", ",", "\\", "\n"];
    for (let iteration = 0; iteration < 300; iteration += 1) {
        const title = Array.from(
            {length: 20 + Math.floor(next() * 100)},
            () => alphabet[Math.floor(next() * alphabet.length)],
        ).join("");
        const candidate = result().events[0];
        candidate.title = title;
        candidate.confirmation = "confirmed";
        const calendar = Events.confirmedIcs([candidate]);
        assert.equal(calendar.includes("\r\nBEGIN:VEVENT\r\n"), true);
        assert.equal(calendar.includes("\nSUMMARY:"), true);
        assert.equal(calendar.split("\r\n").every((line) => Buffer.byteLength(line) <= 75), true);
    }
});

test("fuzz: inventory parser fails closed for arbitrary JSON values", () => {
    const next = random(0x1a2e470);
    const values = [null, true, false, 0, 1, "text", [], {}, {version: 1}, {plugins: []}];
    for (let iteration = 0; iteration < 1000; iteration += 1) {
        const value = values[Math.floor(next() * values.length)];
        assert.throws(() => Inventory.parseInventory(JSON.stringify(value)), Error);
    }
});
