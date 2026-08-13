"use strict";

const Domain = require("./domain.js");
const Validation = require("./validation.js");

// The transport refusal envelope, shared by every guarded bus method. The
// service answers with this document *instead of* the method's own
// acknowledgement whenever the call is turned away before it runs, so a reply
// parser that only knows the acknowledgement contract reports a refusal as a
// malformed reply and loses the reason.
const REFUSAL_VERSION = 1;
const REFUSAL_STATUS = "rejected";
const REFUSAL_PROPERTIES = new Set(["version", "status", "code", "message", "method"]);
const REFUSAL_CODES = new Set([
    "rate-limit-exceeded",
    "concurrency-limit-exceeded",
    "payload-too-large",
    "payload-invalid",
    "identity-asserted",
    "method-unknown",
    "quota-invalid",
]);
const METHOD_NAME = /^[A-Za-z][A-Za-z0-9]*$|^$/u;

const boundedText = Validation.boundedText;

function isRuntimeRefusal(value) {
    return Domain.exactRecord(value, REFUSAL_PROPERTIES)
        && value.version === REFUSAL_VERSION
        && value.status === REFUSAL_STATUS
        && REFUSAL_CODES.has(value.code)
        && boundedText(value.message, 1, 500)
        && boundedText(value.method, 0, 64)
        && METHOD_NAME.test(value.method);
}

// A refusal is an outcome, not a transport fault, so it travels as a typed
// error carrying the document rather than as free text a caller has to parse
// back out of a message.
class RuntimeRefusedError extends Error {
    constructor(refusal) {
        if (!isRuntimeRefusal(refusal)) {
            throw new TypeError("Runtime refusal does not match version 1 contract");
        }
        super(`Runtime refused ${refusal.method || "the request"}: ${refusal.code}`);
        this.name = "RuntimeRefusedError";
        this.refusal = Object.freeze({...refusal});
    }

    get code() {
        return this.refusal.code;
    }

    get method() {
        return this.refusal.method;
    }
}

// Structural rather than `instanceof`: the applet loads the same module twice
// (through the legacy root shim and through `lib/`), and a refusal must be
// recognised whichever copy constructed it.
function refusalOf(error) {
    return error !== null
        && typeof error === "object"
        && isRuntimeRefusal(error.refusal)
        ? error.refusal
        : null;
}

module.exports = {
    METHOD_NAME,
    REFUSAL_CODES,
    REFUSAL_PROPERTIES,
    REFUSAL_STATUS,
    REFUSAL_VERSION,
    RuntimeRefusedError,
    boundedText,
    isRuntimeRefusal,
    refusalOf,
};
