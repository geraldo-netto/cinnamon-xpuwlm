"use strict";

const Paths = require("./path-port.js");

// Syntax shared by the wire and workflow contracts. Domain-specific formats
// and policy stay with their owning modules; only identical primitives live
// here so their failure boundaries cannot drift independently.
const DIGEST = /^[a-f0-9]{64}$/u;
const REQUEST_ID = /^[A-Za-z0-9._-]{1,120}$/u;

function isRecord(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value);
}

function compareText(left, right) {
    if (left === right) {
        return 0;
    }
    return left < right ? -1 : 1;
}

function exactKeys(value, expected) {
    if (!isRecord(value)) {
        return false;
    }
    const keys = Object.keys(value);
    if (Array.isArray(expected)) {
        return keys.length === expected.length
            && expected.every((name) => Object.hasOwn(value, name));
    }
    return expected instanceof Set
        && keys.length === expected.size
        && keys.every((name) => expected.has(name));
}

function boundedText(value, minimum, maximum) {
    if (typeof value !== "string") {
        return false;
    }
    const length = [...value].length;
    return length >= minimum && length <= maximum;
}

function isDigest(value) {
    return typeof value === "string" && DIGEST.test(value);
}

function isRequestId(value) {
    return typeof value === "string" && REQUEST_ID.test(value);
}

function validExportDestination(
    value,
    format,
    formats,
    maximum,
    pathPort = Paths.POSIX_PATHS,
) {
    return boundedText(value, 1, maximum)
        && typeof format === "string"
        && Array.isArray(formats)
        && formats.includes(format)
        && Paths.requirePathPort(pathPort).isSafeAbsolute(value)
        && value.toLowerCase().endsWith(`.${format.toLowerCase()}`);
}

module.exports = {
    DIGEST,
    REQUEST_ID,
    boundedText,
    compareText,
    exactKeys,
    isDigest,
    isRecord,
    isRequestId,
    validExportDestination,
};
