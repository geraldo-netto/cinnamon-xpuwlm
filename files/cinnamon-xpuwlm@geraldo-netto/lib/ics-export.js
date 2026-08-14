"use strict";

const {EventImportError} = require("./event-import-error.js");
const Validation = require("./validation.js");

const LOCAL_DATE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,6})?)?$/u;
const NAMED_TIMEZONE = /^(?:UTC|[A-Za-z0-9._+-]+(?:\/[A-Za-z0-9._+-]+)+)$/u;

function isNamedTimezone(value) {
    return Validation.boundedText(value, 3, 64) && NAMED_TIMEZONE.test(value);
}

function exportRefusal(candidates) {
    if (!Array.isArray(candidates) || candidates.length === 0) {
        return "No event candidates are available";
    }
    if (candidates.some((candidate) => candidate.confirmation === "pending")) {
        return "Decide whether to keep or reject every candidate";
    }
    const confirmed = candidates.filter((candidate) => candidate.confirmation === "confirmed");
    if (confirmed.length === 0) {
        return "Keep at least one candidate before export";
    }
    return confirmed.some((candidate) => !isNamedTimezone(candidate.timezone))
        ? "Give every kept event a named timezone before export"
        : "";
}

function icsDate(value) {
    return new Date(Date.parse(value)).toISOString().replace(/[-:]/gu, "").replace(/\.\d{3}Z$/u, "Z");
}

function icsDateProperty(name, value, timezone) {
    if (/(?:Z|[+-]\d{2}:\d{2})$/u.test(value)) {
        return `${name}:${icsDate(value)}`;
    }
    const parts = LOCAL_DATE.exec(value);
    if (parts === null || !isNamedTimezone(timezone)) {
        throw new EventImportError("date-invalid", "event date and timezone are invalid");
    }
    const local = `${parts[1]}${parts[2]}${parts[3]}T${parts[4]}${parts[5]}${parts[6] || "00"}`;
    return `${name};TZID=${timezone}:${local}`;
}

function icsText(value) {
    return String(value).replace(/\\/gu, String.raw`\\`)
        .replace(/;/gu, String.raw`\;`)
        .replace(/,/gu, String.raw`\,`)
        .replace(/\r/gu, "")
        .replace(/\n/gu, String.raw`\n`);
}

function utf8Width(character) {
    const point = character.codePointAt(0);
    if (point <= 0x7f) {
        return 1;
    }
    if (point <= 0x7ff) {
        return 2;
    }
    return point <= 0xffff ? 3 : 4;
}

function foldIcsLine(line) {
    const lines = [];
    let current = "";
    let width = 0;
    for (const character of line) {
        const nextWidth = utf8Width(character);
        if (width + nextWidth > 73) {
            lines.push(current);
            current = ` ${character}`;
            width = 1 + nextWidth;
        } else {
            current += character;
            width += nextWidth;
        }
    }
    lines.push(current);
    return lines;
}

function confirmedIcs(candidates) {
    const refusal = exportRefusal(candidates);
    if (refusal !== "") {
        throw new EventImportError("confirmation-required", refusal);
    }
    const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Cinnamon XPU WLM//Events 1//EN"];
    for (const candidate of candidates.filter((item) => item.confirmation === "confirmed")) {
        lines.push(
            "BEGIN:VEVENT",
            `UID:${candidate.candidateId}@omnitensor`,
            icsDateProperty("DTSTART", candidate.start, candidate.timezone),
        );
        if (candidate.end !== null) {
            lines.push(icsDateProperty("DTEND", candidate.end, candidate.timezone));
        }
        lines.push(`SUMMARY:${icsText(candidate.title)}`);
        if (candidate.location !== null) {
            lines.push(`LOCATION:${icsText(candidate.location)}`);
        }
        lines.push("END:VEVENT");
    }
    lines.push("END:VCALENDAR");
    return lines.flatMap(foldIcsLine).join("\r\n") + "\r\n";
}

module.exports = {
    confirmedIcs,
    exportRefusal,
    foldIcsLine,
    icsDate,
    icsDateProperty,
    icsText,
    isNamedTimezone,
    utf8Width,
};
