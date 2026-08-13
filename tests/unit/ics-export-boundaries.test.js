"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const ROOT = path.resolve(__dirname, "../../files/cinnamon-xpuwlm@geraldo-netto/lib");
const EventImport = require(path.join(ROOT, "event-import.js"));
const EventImportErrors = require(path.join(ROOT, "event-import-error.js"));
const IcsExport = require(path.join(ROOT, "ics-export.js"));

test("event-import facade preserves the extracted ICS export surface", () => {
    for (const name of [
        "confirmedIcs", "exportRefusal", "foldIcsLine", "icsDateProperty",
        "isNamedTimezone", "utf8Width",
    ]) {
        assert.equal(EventImport[name], IcsExport[name], name);
    }
    assert.equal(EventImport.EventImportError, EventImportErrors.EventImportError);
});

test("event-import facade contains no extracted ICS implementation bodies", () => {
    const source = fs.readFileSync(path.join(ROOT, "event-import.js"), "utf8");
    for (const name of [
        "confirmedIcs", "exportRefusal", "foldIcsLine", "icsDate", "icsDateProperty",
        "icsText", "isNamedTimezone", "utf8Width",
    ]) {
        assert.doesNotMatch(source, new RegExp(`^function ${name}\\(`, "mu"), name);
    }
});

test("ICS owner emits the facade's exact bytes", () => {
    const candidate = {
        candidateId: "event-byte-parity",
        title: "A;B,C\\D\nE",
        start: "2026-09-01T09:00:00+02:00",
        end: null,
        timezone: "Europe/Rome",
        location: null,
        confirmation: "confirmed",
    };
    const expected = [
        "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Cinnamon XPU WLM//Events 1//EN",
        "BEGIN:VEVENT", "UID:event-byte-parity@omnitensor", "DTSTART:20260901T070000Z",
        "SUMMARY:A\\;B\\,C\\\\D\\nE", "END:VEVENT", "END:VCALENDAR", "",
    ].join("\r\n");
    assert.equal(IcsExport.confirmedIcs([candidate]), expected);
    assert.equal(EventImport.confirmedIcs([candidate]), expected);
});
