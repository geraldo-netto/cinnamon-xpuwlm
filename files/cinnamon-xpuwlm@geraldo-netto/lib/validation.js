"use strict";

// Syntax shared by the wire and workflow contracts. Domain-specific formats
// and policy stay with their owning modules; only identical primitives live
// here so their failure boundaries cannot drift independently.
const DIGEST = /^[a-f0-9]{64}$/u;
const REQUEST_ID = /^[A-Za-z0-9._-]{1,120}$/u;

function isRecord(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value);
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

module.exports = {
    DIGEST,
    REQUEST_ID,
    boundedText,
    exactKeys,
    isDigest,
    isRecord,
    isRequestId,
};
