"use strict";

// Submitting one job over the bus, and asking what became of it.
//
// The same shape as the control gateway on purpose: one call in flight per
// channel, a sequence number so a reply that arrives after a newer request is
// discarded rather than delivered, and a refusal recognised before the
// acknowledgement contract can flatten it into "malformed reply". A job is
// slower and more expensive than a policy change, which is a reason to keep the
// failure vocabulary identical rather than to invent a second one.
//
// Two channels, not one. A poll and a submission are independent calls with
// independent lifetimes, and sharing a pending slot would make starting a new
// job silently abandon the poll for the job before it — which is exactly the
// moment a user is waiting for an answer.

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

function parsed(text, label) {
    if (typeof text !== "string") {
        throw contractViolation(TypeError, `Runtime job ${label} is not text`);
    }
    try {
        return JSON.parse(text);
    } catch {
        throw contractViolation(SyntaxError, `Runtime job ${label} contains invalid JSON`);
    }
}

function accepted(text, label, matches) {
    const reply = parsed(text, label);
    if (Refusal.isRuntimeRefusal(reply)) {
        throw new Refusal.RuntimeRefusedError(reply);
    }
    if (!matches(reply)) {
        throw contractViolation(
            TypeError,
            `Runtime job ${label} does not match version 1 contract`,
        );
    }
    return reply;
}

function parseJobAcknowledgement(text) {
    return accepted(text, "acknowledgement", Job.isJobAcknowledgement);
}

function parseJobResult(text) {
    return accepted(text, "result", Job.isJobResult);
}

// One request in flight, and a reply for a superseded one thrown away rather
// than delivered against whatever the caller is waiting for now.
class Channel {
    constructor(sendText, cancellableFactory) {
        this._sendText = sendText;
        this._cancellableFactory = cancellableFactory;
        this._sequence = 0;
        this._pending = null;
    }

    send(requestId, text, parse, callback) {
        this.cancel();
        this._sequence += 1;
        const sequence = this._sequence;
        const cancellable = this._cancellableFactory();
        this._pending = {sequence, cancellable, requestId};
        try {
            this._sendText(text, {cancellable}, (error, reply) => {
                this._complete(sequence, parse, callback, error, reply);
            });
        } catch (error) {
            this._complete(sequence, parse, callback, error, null);
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

    _complete(sequence, parse, callback, error, text) {
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
            callback(null, matched(pending, parse(text)));
        } catch (parseError) {
            callback(parseError, null);
        }
        return true;
    }
}

// A reply for a different request is not this one's answer, and treating it as
// one would report another call's outcome against the picture in front of the
// user.
function matched(pending, reply) {
    if (reply.requestId !== pending.requestId) {
        throw contractViolation(
            RangeError,
            "Runtime job reply request ID does not match request",
        );
    }
    return reply;
}

class RuntimeJobGateway {
    constructor({
        sendText,
        sendResultText = null,
        sendCancelText = null,
        cancellableFactory = () => null,
    }) {
        requirePorts(sendText, cancellableFactory);
        this._submissions = new Channel(sendText, cancellableFactory);
        // Absent against a runtime that has no result method to call: the
        // applet then reports the acknowledgement and says nothing it cannot
        // know, rather than polling an endpoint that is not there.
        this._results = sendResultText === null
            ? null
            : new Channel(sendResultText, cancellableFactory);
        this._cancellations = sendCancelText === null
            ? null
            : new Channel(sendCancelText, cancellableFactory);
    }

    get pollable() {
        return this._results !== null;
    }

    submit(submission, callback) {
        if (!Job.isJobSubmission(submission)) {
            throw new TypeError("Job submission does not match the version 1 contract");
        }
        if (typeof callback !== "function") {
            throw new TypeError("A job submission callback is required");
        }
        return this._submissions.send(
            submission.requestId,
            JSON.stringify(submission),
            parseJobAcknowledgement,
            callback,
        );
    }

    requestResult(request, callback) {
        if (typeof callback !== "function") {
            throw new TypeError("A job result callback is required");
        }
        if (this._results === null) {
            throw new TypeError("This runtime job gateway cannot request results");
        }
        return this._results.send(
            request.requestId,
            JSON.stringify(Job.jobResultRequest(request)),
            parseJobResult,
            callback,
        );
    }

    cancelJob(request, callback) {
        if (typeof callback !== "function") {
            throw new TypeError("A job cancellation callback is required");
        }
        if (this._cancellations === null) {
            throw new TypeError("This runtime job gateway cannot cancel jobs");
        }
        const cancellation = Job.jobCancelRequest(request);
        return this._cancellations.send(
            cancellation.requestId,
            JSON.stringify(cancellation),
            parseJobAcknowledgement,
            callback,
        );
    }

    cancelResult() {
        return this._results === null ? false : this._results.cancel();
    }

    cancel() {
        const results = this.cancelResult();
        const cancellations = this._cancellations === null ? false : this._cancellations.cancel();
        return this._submissions.cancel() || results || cancellations;
    }
}

module.exports = {
    Channel,
    RuntimeJobGateway,
    matched,
    parseJobAcknowledgement,
    parseJobResult,
    requirePorts,
};
