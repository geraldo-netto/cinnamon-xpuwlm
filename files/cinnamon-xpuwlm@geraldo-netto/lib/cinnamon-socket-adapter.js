"use strict";

// The control socket client: framed msgpack over the runtime's unix socket.
//
// This replaced the session D-Bus adapter outright when the runtime dropped
// D-Bus. The seam it presents to the gateways is unchanged — text in, text
// out, one callback — so everything above it (`runtime-control-gateway.js`
// and friends) never learned the transport changed. Inside, each call is one
// connection: connect, write one length-prefixed msgpack request envelope,
// read one reply envelope, close. The envelope contracts are vendored as
// `control-request.schema.json` and `control-reply.schema.json`.
//
// Liveness comes from the socket file itself. The runtime runs under
// systemd with `RuntimeDirectory=omnitensor`, so the socket's presence in
// `$XDG_RUNTIME_DIR` tracks the service's lifetime; a file monitor replaces
// the old bus-name watch with the same appeared/vanished shape.

const FileSystem = require("./gio-file-adapter.js");
const Msgpack = require("./msgpack-codec.js");
const PluginInventory = require("./plugin-inventory.js");
const RuntimeContract = require("./runtime-contract-gateway.js");
const RuntimeControl = require("./runtime-control-gateway.js");
const RuntimeJob = require("./runtime-job-gateway.js");

const {
    createCancellableFactory,
    isIoError,
} = FileSystem;

const CONTROL_SOCKET_ENV = "OMNITENSOR_CONTROL_SOCKET";
const CONTROL_SOCKET_SUFFIX = "omnitensor/control.sock";
const CONTROL_PROTOCOL_VERSION = 1;
const CONTROL_METHOD = "apply-command";
const CONTRACT_METHOD = "describe-contract";
const PLUGIN_INVENTORY_METHOD = "describe-plugins";
const SUBMIT_JOB_METHOD = "submit-job";
const CANCEL_JOB_METHOD = "cancel-job";
const JOB_RESULT_METHOD = "get-job-result";
const CONTROL_TIMEOUT_MS = 5000;
// The runtime refuses larger frames; mirroring the cap means an oversized
// reply is refused at the boundary instead of exhausting memory here.
const MAX_FRAME_BYTES = 16 * 1024 * 1024;

let nextRequestId = 0;

function controlSocketPath(environment) {
    const override = environment.GLib?.getenv?.(CONTROL_SOCKET_ENV);
    if (override) {
        return override;
    }
    return `${environment.GLib.get_user_runtime_dir()}/${CONTROL_SOCKET_SUFFIX}`;
}

function frameRequest(document) {
    const payload = Msgpack.encode(document);
    const frame = new Uint8Array(4 + payload.length);
    frame[0] = (payload.length >>> 24) & 0xff;
    frame[1] = (payload.length >>> 16) & 0xff;
    frame[2] = (payload.length >>> 8) & 0xff;
    frame[3] = payload.length & 0xff;
    frame.set(payload, 4);
    return frame;
}

function frameLength(header) {
    return header[0] * 0x1000000 + header[1] * 0x10000 + header[2] * 0x100 + header[3];
}

function envelopeError(code, message) {
    const error = new Error(`${code}: ${message}`);
    error.code = code;
    return error;
}

function isDocument(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value);
}

// The service's own refusal of the envelope, surfaced with its code intact so
// the failure text upstream can name the actual cause.
function serviceEnvelopeError(error) {
    const code = typeof error?.code === "string" ? error.code : "reply-invalid";
    const message = typeof error?.message === "string"
        ? error.message
        : "the service refused the envelope";
    return envelopeError(code, message);
}

function envelopeShapeError(reply, requestId) {
    if (!isDocument(reply)) {
        return envelopeError("reply-invalid", "the reply is not an envelope");
    }
    if (reply.version !== CONTROL_PROTOCOL_VERSION) {
        return envelopeError("reply-invalid", "the envelope version is not 1");
    }
    if (reply.id !== requestId) {
        return envelopeError("reply-mismatched", "the reply answers a different request");
    }
    return null;
}

// One reply envelope, checked before anything inside it is believed: the id
// must answer this request, and exactly one of result and error is present.
function unpackReply(bytes, requestId) {
    let reply;
    try {
        reply = Msgpack.decode(bytes);
    } catch (error) {
        return {error: envelopeError("reply-undecodable", error.message)};
    }
    const shapeError = envelopeShapeError(reply, requestId);
    if (shapeError !== null) {
        return {error: shapeError};
    }
    if (reply.error !== undefined) {
        return {error: serviceEnvelopeError(reply.error)};
    }
    if (!isDocument(reply.result)) {
        return {error: envelopeError("reply-invalid", "the reply carries no result document")};
    }
    return {result: reply.result};
}

function readExactly(input, count, {environment, cancellable}, callback) {
    const priority = environment.GLib.PRIORITY_DEFAULT ?? 0;
    const collected = new Uint8Array(count);
    let received = 0;
    const step = () => {
        input.read_bytes_async(count - received, priority, cancellable, (source, result) => {
            let chunk;
            try {
                chunk = source.read_bytes_finish(result).get_data();
            } catch (error) {
                callback(error, null);
                return;
            }
            if (!chunk || chunk.length === 0) {
                callback(envelopeError(
                    "connection-closed",
                    "the service closed before replying",
                ), null);
                return;
            }
            collected.set(chunk, received);
            received += chunk.length;
            if (received < count) {
                step();
                return;
            }
            callback(null, collected);
        });
    };
    step();
}

function exchangeOnce(frame, requestId, {environment, cancellable}, callback) {
    const Gio = environment.Gio;
    const client = new Gio.SocketClient();
    if (typeof client.set_timeout === "function") {
        client.set_timeout(Math.ceil(CONTROL_TIMEOUT_MS / 1000));
    }
    const address = Gio.UnixSocketAddress.new(controlSocketPath(environment));
    const priority = environment.GLib.PRIORITY_DEFAULT ?? 0;
    client.connect_async(address, cancellable, (source, result) => {
        let connection;
        try {
            connection = source.connect_finish(result);
        } catch (error) {
            callback(error, null);
            return;
        }
        const finish = (error, reply) => {
            try {
                connection.close(null);
            } catch {
                // The reply is already in hand; a close failure changes nothing.
            }
            callback(error, reply);
        };
        connection.get_output_stream().write_all_async(
            frame,
            priority,
            cancellable,
            (stream, writeResult) => {
                try {
                    stream.write_all_finish(writeResult);
                } catch (error) {
                    finish(error, null);
                    return;
                }
                const input = connection.get_input_stream();
                readExactly(input, 4, {environment, cancellable}, (headerError, header) => {
                    if (headerError !== null) {
                        finish(headerError, null);
                        return;
                    }
                    const length = frameLength(header);
                    if (length === 0 || length > MAX_FRAME_BYTES) {
                        finish(envelopeError(
                            "frame-length-invalid",
                            `the service declared ${length} bytes`,
                        ), null);
                        return;
                    }
                    readExactly(input, length, {environment, cancellable}, (bodyError, body) => {
                        if (bodyError !== null) {
                            finish(bodyError, null);
                            return;
                        }
                        const {error, result: document} = unpackReply(body, requestId);
                        finish(error ?? null, error ? null : document);
                    });
                });
            },
        );
    });
}

// The gateway seam is text in, text out, exactly as it was over D-Bus: the
// gateways own the document contracts and this adapter owns the wire.
function callRuntimeMethod(method, argument, {cancellable}, callback, environment) {
    let params;
    try {
        params = argument === null ? {} : JSON.parse(argument);
    } catch (error) {
        callback(envelopeError("request-invalid", `the request is not JSON: ${error.message}`), null);
        return;
    }
    nextRequestId = (nextRequestId + 1) % 0x100000000;
    const requestId = nextRequestId;
    const request = {
        version: CONTROL_PROTOCOL_VERSION,
        id: requestId,
        method,
        params,
    };
    exchangeOnce(frameRequest(request), requestId, {environment, cancellable}, (error, result) => {
        if (error !== null) {
            if (!isIoError(environment, error, "CANCELLED")) {
                callback(error, null);
            }
            return;
        }
        callback(null, JSON.stringify(result));
    });
}

function sendRuntimeCommandText(text, options, callback, environment) {
    return callRuntimeMethod(CONTROL_METHOD, text, options, callback, environment);
}

// The handshake takes no request document, so the params travel empty rather
// than as an empty string: a service reading "" as a request body would be
// answering a different question from the one asked.
function requestRuntimeContractText(options, callback, environment) {
    return callRuntimeMethod(CONTRACT_METHOD, null, options, callback, environment);
}

function requestPluginInventoryText(options, callback, environment) {
    return callRuntimeMethod(PLUGIN_INVENTORY_METHOD, null, options, callback, environment);
}

// The socket file's presence is the only signal that says the control service
// started or stopped without the applet having to fail a command first: the
// runtime's systemd unit owns the directory, so the file appears on start and
// is removed on stop. An environment without the monitor API (test harnesses)
// reports nothing rather than claiming the service is absent.
function createControlServiceWatch(environment) {
    return {
        watch(listener) {
            const Gio = environment.Gio;
            if (!Gio?.File || typeof Gio.File.new_for_path !== "function") {
                return null;
            }
            const file = Gio.File.new_for_path(controlSocketPath(environment));
            let monitor;
            try {
                monitor = file.monitor(Gio.FileMonitorFlags.NONE, null);
            } catch {
                return null;
            }
            const handler = monitor.connect("changed", (_monitor, _file, _other, eventType) => {
                if (eventType === Gio.FileMonitorEvent.CREATED) {
                    listener(true);
                } else if (eventType === Gio.FileMonitorEvent.DELETED) {
                    listener(false);
                }
            });
            listener(file.query_exists(null));
            return () => {
                monitor.disconnect(handler);
                monitor.cancel();
            };
        },
    };
}

function createRuntimeContractGateway(environment) {
    return new RuntimeContract.RuntimeContractGateway({
        cancellableFactory: createCancellableFactory(environment),
        sendText: (options, callback) => requestRuntimeContractText(
            options, callback, environment,
        ),
    });
}

function createPluginInventoryGateway(environment) {
    return new PluginInventory.PluginInventoryGateway({
        cancellableFactory: createCancellableFactory(environment),
        sendText: (options, callback) => requestPluginInventoryText(
            options, callback, environment,
        ),
    });
}

function submitRuntimeJobText(text, options, callback, environment) {
    return callRuntimeMethod(SUBMIT_JOB_METHOD, text, options, callback, environment);
}

function requestRuntimeJobResultText(text, options, callback, environment) {
    return callRuntimeMethod(JOB_RESULT_METHOD, text, options, callback, environment);
}

function cancelRuntimeJobText(text, options, callback, environment) {
    return callRuntimeMethod(CANCEL_JOB_METHOD, text, options, callback, environment);
}

function createRuntimeJobGateway(environment) {
    return new RuntimeJob.RuntimeJobGateway({
        cancellableFactory: createCancellableFactory(environment),
        sendText: (text, options, callback) => submitRuntimeJobText(
            text, options, callback, environment,
        ),
        sendResultText: (text, options, callback) => requestRuntimeJobResultText(
            text, options, callback, environment,
        ),
        sendCancelText: (text, options, callback) => cancelRuntimeJobText(
            text, options, callback, environment,
        ),
    });
}

function createRuntimeControlGateway(environment) {
    return new RuntimeControl.RuntimeControlGateway({
        cancellableFactory: createCancellableFactory(environment),
        sendText: (text, options, callback) => sendRuntimeCommandText(
            text, options, callback, environment,
        ),
    });
}

module.exports = {
    CANCEL_JOB_METHOD,
    CONTRACT_METHOD,
    CONTROL_METHOD,
    CONTROL_PROTOCOL_VERSION,
    CONTROL_SOCKET_ENV,
    CONTROL_TIMEOUT_MS,
    JOB_RESULT_METHOD,
    MAX_FRAME_BYTES,
    PLUGIN_INVENTORY_METHOD,
    SUBMIT_JOB_METHOD,
    callRuntimeMethod,
    cancelRuntimeJobText,
    controlSocketPath,
    createControlServiceWatch,
    createPluginInventoryGateway,
    createRuntimeContractGateway,
    createRuntimeControlGateway,
    createRuntimeJobGateway,
    frameRequest,
    requestPluginInventoryText,
    requestRuntimeContractText,
    requestRuntimeJobResultText,
    sendRuntimeCommandText,
    submitRuntimeJobText,
    unpackReply,
};
