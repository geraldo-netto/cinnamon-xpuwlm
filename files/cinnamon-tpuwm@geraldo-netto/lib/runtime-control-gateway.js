"use strict";

const Contract = require("./runtime-control-contract.js");

function requirePorts(sendText, cancellableFactory) {
    if (typeof sendText !== "function") {
        throw new TypeError("An asynchronous command transport is required");
    }
    if (typeof cancellableFactory !== "function") {
        throw new TypeError("A command cancellable factory is required");
    }
}

function parseAcknowledgement(text) {
    if (typeof text !== "string") {
        throw new TypeError("Runtime acknowledgement is not text");
    }
    let acknowledgement;
    try {
        acknowledgement = JSON.parse(text);
    } catch {
        throw new SyntaxError("Runtime acknowledgement contains invalid JSON");
    }
    if (!Contract.isRuntimeAcknowledgement(acknowledgement)) {
        throw new TypeError("Runtime acknowledgement does not match version 1 contract");
    }
    return acknowledgement;
}

class RuntimeControlGateway {
    constructor({sendText, cancellableFactory = () => null}) {
        requirePorts(sendText, cancellableFactory);
        this._sendText = sendText;
        this._cancellableFactory = cancellableFactory;
        this._sequence = 0;
        this._pending = null;
    }

    send(command, callback) {
        if (!Contract.isRuntimeCommand(command)) {
            throw new TypeError("Runtime command does not match version 1 contract");
        }
        if (typeof callback !== "function") {
            throw new TypeError("A runtime command callback is required");
        }
        this.cancel();
        this._sequence += 1;
        const sequence = this._sequence;
        const cancellable = this._cancellableFactory();
        this._pending = {sequence, cancellable, commandId: command.id};
        try {
            this._sendText(JSON.stringify(command), {cancellable}, (error, text) => {
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
            const acknowledgement = parseAcknowledgement(text);
            if (acknowledgement.commandId !== pending.commandId) {
                throw new RangeError("Runtime acknowledgement command ID does not match request");
            }
            callback(null, acknowledgement);
        } catch (parseError) {
            callback(parseError, null);
        }
        return true;
    }
}

module.exports = {
    RuntimeControlGateway,
    parseAcknowledgement,
    requirePorts,
};
