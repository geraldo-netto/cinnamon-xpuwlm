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

// The local-date pattern is the only thing standing between a malformed
// timestamp and a calendar entry on the wrong day. Every field width and every
// digit class matters, so each is stated: a parser that accepted `12-3-4T5:6`
// would silently write an event nobody scheduled.
test("the local date pattern accepts exactly ISO-8601 local timestamps", () => {
    const timezone = "Europe/Lisbon";
    const accepted = [
        ["2026-08-15T09:30", "DTSTART;TZID=Europe/Lisbon:20260815T093000"],
        ["2026-08-15T09:30:45", "DTSTART;TZID=Europe/Lisbon:20260815T093045"],
        ["2026-08-15T09:30:45.1", "DTSTART;TZID=Europe/Lisbon:20260815T093045"],
        ["2026-08-15T09:30:45.123456", "DTSTART;TZID=Europe/Lisbon:20260815T093045"],
        ["0001-01-01T00:00", "DTSTART;TZID=Europe/Lisbon:00010101T000000"],
    ];
    for (const [value, expected] of accepted) {
        assert.equal(IcsExport.icsDateProperty("DTSTART", value, timezone), expected, value);
    }

    const refused = [
        // Field widths: each is exact, and a shorter or longer one is a
        // different instant or no instant at all.
        "202-08-15T09:30", "20261-08-15T09:30",
        "2026-8-15T09:30", "2026-081-15T09:30",
        "2026-08-1T09:30", "2026-08-155T09:30",
        "2026-08-15T9:30", "2026-08-15T091:30",
        "2026-08-15T09:3", "2026-08-15T09:301",
        "2026-08-15T09:30:4", "2026-08-15T09:30:451",
        // Digits, not any character: `\\D` in any field is a different pattern.
        "abcd-08-15T09:30", "2026-ab-15T09:30", "2026-08-abT09:30",
        "2026-08-15Tab:30", "2026-08-15T09:ab", "2026-08-15T09:30:ab",
        // Fractional seconds are bounded and need a second to attach to.
        "2026-08-15T09:30.123", "2026-08-15T09:30:45.1234567", "2026-08-15T09:30:45.",
        // Anchors: nothing may precede or follow the timestamp.
        " 2026-08-15T09:30", "2026-08-15T09:30 ", "x2026-08-15T09:30", "2026-08-15T09:30x",
        "2026-08-15T09:30\n2026-08-15T09:30",
        // Separators are literal.
        "2026/08/15T09:30", "2026-08-15 09:30", "2026-08-15T09-30",
        "", "2026-08-15",
    ];
    for (const value of refused) {
        assert.throws(
            () => IcsExport.icsDateProperty("DTSTART", value, timezone),
            /date and timezone are invalid/u,
            JSON.stringify(value),
        );
    }
});

// A TZID that is not a real zone name goes straight into the calendar file, so
// the anchors and the length bound are the whole check. Each is stated
// separately because each admits a different wrong value.
test("a named timezone is anchored, bounded, and shaped like a zone name", () => {
    for (const value of [
        "UTC",
        "Europe/Lisbon",
        "America/Argentina/Buenos_Aires",
        "Etc/GMT+3",
        "a/b",
    ]) {
        assert.equal(IcsExport.isNamedTimezone(value), true, value);
    }

    for (const value of [
        // Anchored at both ends: a zone name may not be embedded in something
        // else, which is how a folded line or an injected parameter gets in.
        "xUTC", "UTCx", " Europe/Lisbon", "Europe/Lisbon ", "Europe/Lisbon\nX",
        // A bare region is not a zone: the separator is required.
        "Europe", "UTCC", "Lisbon",
        // Length bounds.
        "ab", "", `${"a".repeat(60)}/${"b".repeat(60)}`,
        // Characters outside the zone alphabet.
        "Europe/Lisbon;TZID=x", "Europe/Lis bon", "Europe\\Lisbon", "Europe/Lisbon:00",
        null, undefined, 7, ["Europe/Lisbon"],
    ]) {
        assert.equal(IcsExport.isNamedTimezone(value), false, JSON.stringify(value));
    }
});

// Export refuses in a fixed order, and each answer tells the user a different
// thing to do. A ladder that collapsed would send them to fix the wrong one.
test("export refusal names the first unmet condition, in order", () => {
    const candidate = (confirmation, timezone = "Europe/Lisbon") => ({confirmation, timezone});

    assert.equal(IcsExport.exportRefusal([]), "No event candidates are available");
    assert.equal(IcsExport.exportRefusal(null), "No event candidates are available");
    assert.equal(IcsExport.exportRefusal(undefined), "No event candidates are available");

    assert.equal(
        IcsExport.exportRefusal([candidate("pending")]),
        "Decide whether to keep or reject every candidate",
    );
    // Pending outranks every later complaint, including a missing timezone.
    assert.equal(
        IcsExport.exportRefusal([candidate("confirmed", ""), candidate("pending")]),
        "Decide whether to keep or reject every candidate",
    );

    assert.equal(
        IcsExport.exportRefusal([candidate("rejected")]),
        "Keep at least one candidate before export",
    );

    assert.equal(
        IcsExport.exportRefusal([candidate("confirmed", "Lisbon")]),
        "Give every kept event a named timezone before export",
    );
    // Only kept candidates are held to it; a rejected one may be anything.
    assert.equal(IcsExport.exportRefusal([candidate("confirmed"), candidate("rejected", "")]), "");
    assert.equal(IcsExport.exportRefusal([candidate("confirmed")]), "");
});


// Folding is by octet, not by character: a line measured in characters would
// fold in the wrong place for any non-ASCII summary and produce a file other
// calendar clients reject. Each UTF-8 boundary is stated exactly.
test("UTF-8 width is counted at every encoding boundary", () => {
    const cases = [
        ["\u0020", 1], ["A", 1], ["\u007f", 1],
        ["\u0080", 2], ["\u00e9", 2], ["\u07ff", 2],
        ["\u0800", 3], ["\u20ac", 3], ["\uffff", 3],
        ["\u{10000}", 4], ["\u{1f600}", 4], ["\u{10ffff}", 4],
    ];
    for (const [character, width] of cases) {
        assert.equal(
            IcsExport.utf8Width(character),
            width,
            `U+${character.codePointAt(0).toString(16)}`,
        );
    }
});

test("a folded line never exceeds the octet bound and continues with one space", () => {
    const octets = (text) => [...text].reduce((total, ch) => total + IcsExport.utf8Width(ch), 0);
    const euro = "\u20ac";
    const emoji = "\u{1f600}";

    assert.deepEqual(IcsExport.foldIcsLine(""), [""]);
    assert.deepEqual(IcsExport.foldIcsLine("A".repeat(73)), ["A".repeat(73)]);

    // One octet past the bound is the first thing that folds, and the
    // continuation carries the leading space RFC 5545 requires.
    const justOver = IcsExport.foldIcsLine("A".repeat(74));
    assert.equal(justOver.length, 2);
    assert.equal(justOver[0], "A".repeat(73));
    assert.equal(justOver[1], " A");

    // A wide character that would straddle the bound moves whole to the next
    // line rather than being split across it.
    const wide = IcsExport.foldIcsLine(`${"A".repeat(72)}${euro}`);
    assert.equal(wide.length, 2);
    assert.equal(wide[0], "A".repeat(72));
    assert.equal(wide[1], ` ${euro}`);

    for (const line of [
        "A".repeat(500),
        "\u00e9".repeat(200),
        emoji.repeat(100),
        `${"A".repeat(70)}${emoji}${"B".repeat(70)}`,
    ]) {
        const folded = IcsExport.foldIcsLine(line);
        for (const piece of folded) {
            assert.ok(octets(piece) <= 74, `${octets(piece)} octets in ${JSON.stringify(piece)}`);
        }
        assert.equal(folded.slice(1).every((piece) => piece.startsWith(" ")), true);
        assert.equal(
            folded.map((piece, index) => (index === 0 ? piece : piece.slice(1))).join(""),
            line,
        );
    }
});
