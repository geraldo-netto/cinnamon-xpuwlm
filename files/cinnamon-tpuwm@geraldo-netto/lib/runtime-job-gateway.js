"use strict";

// Submitting one job over the bus, and nothing else.
//
// The same shape as the control gateway on purpose: one call in flight, a
// sequence number so a reply that arrives after a newer request is discarded
// rather than delivered, and a refusal recognised before the acknowledgement
// contract can flatten it into "malformed reply". A job is slower and more
// expensive than a policy change, which is a reason to keep the failure
// vocabulary identical rather than to invent a second one.

const Contract = require("./runtime-control-contract.js");
const Job = require("./runtime-job-contract.js");
const Refusal = require("./runtime-refusal-contract.js");

const contractViolation = Contract.contractViolation;

function requirePorts(sendText, cancellableFactory) {
    if (typeof sendText !== "function") {
        throw new TypeError("An asynchronous job transport is required");
    }
    if (typeof cancellableFactory !== "function") {
        throw new TypeError("A job cancellable factory is required");
    }
}

function parseJobAcknowledgement(text) {
    if (typeof text !== "string") {
        throw contractViolation(TypeError, "Runtime job acknowledgement is not text");
    }
    let reply;
    try {
        reply = JSON.parse(text);
    } catch {
        throw contractViolation(SyntaxError, "Runtime job acknowledgement contains invalid JSON");
    }
    if (Refusal.isRuntimeRefusal(reply)) {
        throw new Refusal.RuntimeRefusedError(reply);
    }
    if (!Job.isJobAcknowledgement(reply)) {
        throw contractViolation(
            TypeError,
            "Runtime job acknowledgement does not match version 1 contract",
        );
    }
    return reply;
}

class RuntimeJobGateway {
    constructor({sendText, cancellableFactory = () => null}) {
        requirePorts(sendText, cancellableFactory);
        this._sendText = sendText;
        this._cancellableFactory = cancellableFactory;
        this._sequence = 0;
        this._pending = null;
    }

    submit(submission, callback) {
        if (!Job.isJobSubmission(submission)) {
            throw new TypeError("Job submission does not match the version 1 contract");
        }
        if (typeof callback !== "function") {
            throw new TypeError("A job submission callback is required");
        }
        this.cancel();
        this._sequence += 1;
        const sequence = this._sequence;
        const cancellable = this._cancellableFactory();
        this._pending = {sequence, cancellable, requestId: submission.requestId};
        try {
            this._sendText(JSON.stringify(submission), {cancellable}, (error, text) => {
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
        const pending = this._pending;
        this._pending = null;
        if (error) {
            callback(error, null);
            return true;
        }
        try {
            callback(null, this._matched(pending, text));
        } catch (parseError) {
            callback(parseError, null);
        }
        return true;
    }

    // An acknowledgement for a different request is not this job's answer, and
    // treating it as one would report another submission's refusal against the
    // picture the user just chose.
    _matched(pending, text) {
        const acknowledgement = parseJobAcknowledgement(text);
        if (acknowledgement.requestId !== pending.requestId) {
            throw contractViolation(
                RangeError,
                "Runtime job acknowledgement request ID does not match request",
            );
        }
        return acknowledgement;
    }
}

module.exports = {
    RuntimeJobGateway,
    parseJobAcknowledgement,
    requirePorts,
};
