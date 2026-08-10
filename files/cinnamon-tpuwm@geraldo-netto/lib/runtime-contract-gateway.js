"use strict";

const Contract = require("./runtime-contract.js");
const ControlContract = require("./runtime-control-contract.js");
const Refusal = require("./runtime-refusal-contract.js");

// Transport for the one call that takes no arguments. Kept apart from the
// control gateway because the two have opposite failure meanings: a failed
// command is a change the user asked for and did not get, while a failed
// handshake only means the applet still does not know what the service speaks,
// which is exactly the state it was already in.

const contractViolation = ControlContract.contractViolation;

function requirePorts(sendText) {
    if (typeof sendText !== "function") {
        throw new TypeError("An asynchronous contract transport is required");
    }
}

function parseContract(text) {
    if (typeof text !== "string") {
        throw contractViolation(TypeError, "Runtime contract description is not text");
    }
    let reply;
    try {
        reply = JSON.parse(text);
    } catch {
        throw contractViolation(SyntaxError, "Runtime contract description contains invalid JSON");
    }
    // A guarded method answers with the refusal envelope in place of its own
    // reply, so the refusal is recognised before the contract check flattens
    // it into "malformed description".
    if (Refusal.isRuntimeRefusal(reply)) {
        throw new Refusal.RuntimeRefusedError(reply);
    }
    if (!Contract.isRuntimeContractDocument(reply)) {
        throw contractViolation(
            TypeError,
            "Runtime contract description does not match version 1 contract",
        );
    }
    return new Contract.RuntimeContract(reply);
}

class RuntimeContractGateway {
    constructor({sendText, cancellableFactory = () => null}) {
        requirePorts(sendText);
        this._sendText = sendText;
        this._cancellableFactory = typeof cancellableFactory === "function"
            ? cancellableFactory
            : () => null;
        this._sequence = 0;
        this._pending = null;
    }

    describe(callback) {
        if (typeof callback !== "function") {
            throw new TypeError("A runtime contract callback is required");
        }
        this.cancel();
        this._sequence += 1;
        const sequence = this._sequence;
        const cancellable = this._cancellableFactory();
        this._pending = {sequence, cancellable};
        try {
            this._sendText({cancellable}, (error, text) => {
                this._complete(sequence, callback, error, text);
            });
        } catch (error) {
            this._complete(sequence, callback, error, null);
        }
        return true;
    }

    cancel() {
        if (this._pending === null) {
            return false;
        }
        const {cancellable} = this._pending;
        this._pending = null;
        this._sequence += 1;
        if (cancellable && typeof cancellable.cancel === "function") {
            cancellable.cancel();
        }
        return true;
    }

    _complete(sequence, callback, error, text) {
        if (this._pending === null || sequence !== this._sequence) {
            return false;
        }
        this._pending = null;
        if (error) {
            callback(error, null);
            return true;
        }
        try {
            callback(null, parseContract(text));
        } catch (parseError) {
            callback(parseError, null);
        }
        return true;
    }
}

module.exports = {
    RuntimeContractGateway,
    parseContract,
    requirePorts,
};
