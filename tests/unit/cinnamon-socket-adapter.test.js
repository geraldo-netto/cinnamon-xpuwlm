"use strict";

const assert = require("node:assert/strict");
const {test} = require("node:test");

const Msgpack = require("../../files/cinnamon-xpuwlm@geraldo-netto/lib/msgpack-codec.js");
const Socket = require("../../files/cinnamon-xpuwlm@geraldo-netto/lib/cinnamon-socket-adapter.js");

// A fake Gio socket stack: one scripted service reply, delivered through the
// same connect/write/read seams GJS provides, chunked however the test asks.
function fakeSocketEnvironment({reply, chunkSize = 1024, connectError, writeError} = {}) {
    const trace = {connects: [], written: null, closed: 0};

    function replyBytes(requestBytes) {
        if (typeof reply === "function") {
            return reply(requestBytes);
        }
        return reply;
    }

    class InputStream {
        constructor(bytesToServe) {
            this.remaining = bytesToServe;
        }

        read_bytes_async(count, _priority, _cancellable, callback) {
            const served = this.remaining.subarray(0, Math.min(count, chunkSize));
            this.remaining = this.remaining.subarray(served.length);
            callback(this, {served});
        }

        read_bytes_finish(result) {
            return {get_data: () => (result.served.length === 0 ? null : result.served)};
        }
    }

    class OutputStream {
        constructor(connection) {
            this.connection = connection;
        }

        write_all_async(framedRequest, _priority, _cancellable, callback) {
            trace.written = framedRequest;
            this.connection.input.remaining = replyBytes(framedRequest);
            callback(this, {});
        }

        write_all_finish() {
            if (writeError) {
                throw writeError;
            }
        }
    }

    class Connection {
        constructor() {
            this.input = new InputStream(new Uint8Array(0));
        }

        get_output_stream() {
            return new OutputStream(this);
        }

        get_input_stream() {
            return this.input;
        }

        close() {
            trace.closed += 1;
        }
    }

    class SocketClient {
        set_timeout(seconds) {
            trace.timeoutSeconds = seconds;
        }

        connect_async(address, _cancellable, callback) {
            trace.connects.push(address.path);
            callback(this, {});
        }

        connect_finish() {
            if (connectError) {
                throw connectError;
            }
            return new Connection();
        }
    }

    return {
        trace,
        environment: {
            Gio: {
                SocketClient,
                UnixSocketAddress: {new: (path) => ({path})},
                IOErrorEnum: {CANCELLED: 19},
            },
            GLib: {
                PRIORITY_DEFAULT: 0,
                getenv: () => null,
                get_user_runtime_dir: () => "/run/user/1000",
            },
        },
    };
}

function frame(document) {
    const payload = Msgpack.encode(document);
    const framed = new Uint8Array(4 + payload.length);
    new DataView(framed.buffer).setUint32(0, payload.length, false);
    framed.set(payload, 4);
    return framed;
}

function sentEnvelope(trace) {
    return Msgpack.decode(trace.written.subarray(4));
}

test("the socket path prefers the override, then the runtime directory", () => {
    const {environment} = fakeSocketEnvironment({});
    assert.equal(
        Socket.controlSocketPath(environment),
        "/run/user/1000/omnitensor/control.sock",
    );
    environment.GLib.getenv = (name) => (
        name === Socket.CONTROL_SOCKET_ENV ? "/custom/control.sock" : null
    );
    assert.equal(Socket.controlSocketPath(environment), "/custom/control.sock");
});

test("a command travels as a version-1 envelope and the result returns as text", () => {
    const {trace, environment} = fakeSocketEnvironment({
        reply: (written) => {
            const request = Msgpack.decode(written.subarray(4));
            return frame({version: 1, id: request.id, result: {status: "applied", revision: 3}});
        },
    });
    const completions = [];
    Socket.sendRuntimeCommandText(
        JSON.stringify({version: 2, commandId: "c-1"}),
        {cancellable: null},
        (...args) => completions.push(args),
        environment,
    );

    const request = sentEnvelope(trace);
    assert.equal(request.version, 1);
    assert.equal(request.method, "apply-command");
    assert.deepEqual(request.params, {version: 2, commandId: "c-1"});
    assert.ok(Number.isInteger(request.id));
    assert.deepEqual(completions, [[null, JSON.stringify({status: "applied", revision: 3})]]);
    assert.equal(trace.connects[0], "/run/user/1000/omnitensor/control.sock");
    assert.equal(trace.closed, 1);
    assert.equal(trace.timeoutSeconds, Math.ceil(Socket.CONTROL_TIMEOUT_MS / 1000));
});

test("methods that take no request send empty params rather than an empty string", () => {
    const {trace, environment} = fakeSocketEnvironment({
        reply: (written) => {
            const request = Msgpack.decode(written.subarray(4));
            return frame({version: 1, id: request.id, result: {version: 1}});
        },
    });
    const completions = [];
    Socket.requestRuntimeContractText(
        {cancellable: null},
        (...args) => completions.push(args),
        environment,
    );

    assert.equal(sentEnvelope(trace).method, "describe-contract");
    assert.deepEqual(sentEnvelope(trace).params, {});
    assert.deepEqual(completions, [[null, JSON.stringify({version: 1})]]);
});

test("each job method reaches its kebab-case name", () => {
    const seen = [];
    const {environment} = fakeSocketEnvironment({
        reply: (written) => {
            const request = Msgpack.decode(written.subarray(4));
            seen.push(request.method);
            return frame({version: 1, id: request.id, result: {}});
        },
    });
    const done = () => {};
    Socket.submitRuntimeJobText("{}", {cancellable: null}, done, environment);
    Socket.requestRuntimeJobResultText("{}", {cancellable: null}, done, environment);
    Socket.cancelRuntimeJobText("{}", {cancellable: null}, done, environment);
    Socket.requestPluginInventoryText({cancellable: null}, done, environment);

    assert.deepEqual(seen, ["submit-job", "get-job-result", "cancel-job", "describe-plugins"]);
});

test("an envelope error surfaces its code instead of a fake success", () => {
    const {environment} = fakeSocketEnvironment({
        reply: (written) => frame({
            version: 1,
            id: Msgpack.decode(written.subarray(4)).id,
            error: {code: "method-unknown", message: "this service does not export it"},
        }),
    });
    const completions = [];
    Socket.sendRuntimeCommandText("{}", {cancellable: null}, (...args) => completions.push(args), environment);

    assert.equal(completions.length, 1);
    assert.equal(completions[0][0].code, "method-unknown");
    assert.match(completions[0][0].message, /does not export/u);
    assert.equal(completions[0][1], null);
});

test("a reply answering a different request is refused", () => {
    const {environment} = fakeSocketEnvironment({
        reply: () => frame({version: 1, id: 999999999, result: {}}),
    });
    const completions = [];
    Socket.sendRuntimeCommandText("{}", {cancellable: null}, (...args) => completions.push(args), environment);

    assert.equal(completions[0][0].code, "reply-mismatched");
});

test("an undecodable or truncated reply fails with a stable code", () => {
    const garbage = new Uint8Array(8);
    new DataView(garbage.buffer).setUint32(0, 4, false);
    garbage.set([0xc1, 0xc1, 0xc1, 0xc1], 4);
    const {environment} = fakeSocketEnvironment({reply: () => garbage});
    const completions = [];
    Socket.sendRuntimeCommandText("{}", {cancellable: null}, (...args) => completions.push(args), environment);
    assert.equal(completions[0][0].code, "reply-undecodable");

    const truncated = frame({version: 1, id: 1, result: {}}).subarray(0, 6);
    const {environment: shortEnvironment} = fakeSocketEnvironment({reply: () => truncated});
    const shortCompletions = [];
    Socket.sendRuntimeCommandText(
        "{}", {cancellable: null}, (...args) => shortCompletions.push(args), shortEnvironment,
    );
    assert.equal(shortCompletions[0][0].code, "connection-closed");
});

test("a declared reply length beyond the cap is refused before it is read", () => {
    const oversized = new Uint8Array(4);
    new DataView(oversized.buffer).setUint32(0, Socket.MAX_FRAME_BYTES + 1, false);
    const {environment} = fakeSocketEnvironment({reply: () => oversized});
    const completions = [];
    Socket.sendRuntimeCommandText("{}", {cancellable: null}, (...args) => completions.push(args), environment);
    assert.equal(completions[0][0].code, "frame-length-invalid");
});

test("a chunked reply is reassembled exactly", () => {
    const {environment} = fakeSocketEnvironment({
        chunkSize: 3,
        reply: (written) => frame({
            version: 1,
            id: Msgpack.decode(written.subarray(4)).id,
            result: {text: "chunked delivery holds"},
        }),
    });
    const completions = [];
    Socket.sendRuntimeCommandText("{}", {cancellable: null}, (...args) => completions.push(args), environment);
    assert.deepEqual(completions, [[null, JSON.stringify({text: "chunked delivery holds"})]]);
});

test("an argument that is not JSON is refused before any connection", () => {
    const {trace, environment} = fakeSocketEnvironment({});
    const completions = [];
    Socket.sendRuntimeCommandText("not-json", {cancellable: null}, (...args) => completions.push(args), environment);

    assert.equal(completions[0][0].code, "request-invalid");
    assert.deepEqual(trace.connects, []);
});

test("a connect failure reaches the callback; a cancellation is swallowed", () => {
    const failure = new Error("connection refused");
    const {environment} = fakeSocketEnvironment({connectError: failure});
    const completions = [];
    Socket.sendRuntimeCommandText("{}", {cancellable: null}, (...args) => completions.push(args), environment);
    assert.deepEqual(completions, [[failure, null]]);

    const cancelled = new Error("operation cancelled");
    cancelled.matches = (enumeration, code) => code === enumeration.CANCELLED;
    const {environment: cancelledEnvironment} = fakeSocketEnvironment({connectError: cancelled});
    const cancelledCompletions = [];
    Socket.sendRuntimeCommandText(
        "{}", {cancellable: null}, (...args) => cancelledCompletions.push(args), cancelledEnvironment,
    );
    assert.deepEqual(cancelledCompletions, []);
});

test("the control watch tracks the socket file and releases its monitor", () => {
    const handlers = [];
    let exists = false;
    let cancelled = 0;
    let disconnected = null;
    const monitor = {
        connect: (signal, handler) => {
            handlers.push({signal, handler});
            return 7;
        },
        disconnect: (id) => {
            disconnected = id;
        },
        cancel: () => {
            cancelled += 1;
        },
    };
    const environment = {
        Gio: {
            File: {
                new_for_path: (path) => ({
                    path,
                    monitor: () => monitor,
                    query_exists: () => exists,
                }),
            },
            FileMonitorFlags: {NONE: 0},
            FileMonitorEvent: {CREATED: 1, DELETED: 2, CHANGED: 3},
        },
        GLib: {
            getenv: () => null,
            get_user_runtime_dir: () => "/run/user/1000",
        },
    };

    const reported = [];
    const unwatch = Socket.createControlServiceWatch(environment)
        .watch((value) => reported.push(value));

    assert.deepEqual(reported, [false]);
    exists = true;
    handlers[0].handler(null, null, null, environment.Gio.FileMonitorEvent.CREATED);
    handlers[0].handler(null, null, null, environment.Gio.FileMonitorEvent.CHANGED);
    handlers[0].handler(null, null, null, environment.Gio.FileMonitorEvent.DELETED);
    assert.deepEqual(reported, [false, true, false]);

    unwatch();
    assert.equal(disconnected, 7);
    assert.equal(cancelled, 1);
});

test("an environment without the monitor API reports nothing rather than absence", () => {
    const bare = {
        Gio: {},
        GLib: {getenv: () => null, get_user_runtime_dir: () => "/run/user/1000"},
    };
    assert.equal(Socket.createControlServiceWatch(bare).watch(() => {}), null);
    assert.equal(Socket.createControlServiceWatch({Gio: undefined}).watch(() => {}), null);
    const refusing = {
        Gio: {
            File: {
                new_for_path: () => ({
                    monitor: () => {
                        throw new Error("no monitor backend");
                    },
                }),
            },
            FileMonitorFlags: {NONE: 0},
        },
        GLib: {getenv: () => null, get_user_runtime_dir: () => "/run/user/1000"},
    };
    assert.equal(Socket.createControlServiceWatch(refusing).watch(() => {}), null);
});

test("request ids differ between consecutive calls", () => {
    const ids = [];
    const {environment} = fakeSocketEnvironment({
        reply: (written) => {
            const request = Msgpack.decode(written.subarray(4));
            ids.push(request.id);
            return frame({version: 1, id: request.id, result: {}});
        },
    });
    Socket.sendRuntimeCommandText("{}", {cancellable: null}, () => {}, environment);
    Socket.sendRuntimeCommandText("{}", {cancellable: null}, () => {}, environment);
    assert.equal(ids.length, 2);
    assert.notEqual(ids[0], ids[1]);
});


test("every malformed envelope shape is refused with its own reason", () => {
    const wire = (document) => Msgpack.encode(document);
    const cases = [
        [wire([1, 2]), "reply-invalid", /not an envelope/u],
        [wire({version: 2, id: 1, result: {}}), "reply-invalid", /version is not 1/u],
        [wire({version: 1, id: 2, result: {}}), "reply-mismatched", /different request/u],
        [wire({version: 1, id: 1, result: "text"}), "reply-invalid", /no result document/u],
        [wire({version: 1, id: 1, result: [1]}), "reply-invalid", /no result document/u],
        [wire({version: 1, id: 1}), "reply-invalid", /no result document/u],
    ];
    for (const [bytes, code, message] of cases) {
        const {error} = Socket.unpackReply(bytes, 1);
        assert.equal(error.code, code);
        assert.match(error.message, message);
    }
});

test("a service error without usable fields still fails with a stable shape", () => {
    const encoded = Msgpack.encode({version: 1, id: 1, error: {}});
    const {error} = Socket.unpackReply(encoded, 1);
    assert.equal(error.code, "reply-invalid");
    assert.match(error.message, /refused the envelope/u);

    const nonsense = Msgpack.encode({version: 1, id: 1, error: {code: 7, message: null}});
    const {error: coerced} = Socket.unpackReply(nonsense, 1);
    assert.equal(coerced.code, "reply-invalid");
    assert.match(coerced.message, /refused the envelope/u);
});


test("a connection whose close fails still delivers the reply", () => {
    const {environment} = fakeSocketEnvironment({
        reply: (written) => frame({
            version: 1,
            id: Msgpack.decode(written.subarray(4)).id,
            result: {status: "applied"},
        }),
    });
    const OriginalClient = environment.Gio.SocketClient;
    environment.Gio.SocketClient = class extends OriginalClient {
        connect_finish() {
            const connection = super.connect_finish();
            connection.close = () => {
                throw new Error("close failed");
            };
            return connection;
        }
    };
    const completions = [];
    Socket.sendRuntimeCommandText(
        "{}", {cancellable: null}, (...args) => completions.push(args), environment,
    );
    assert.deepEqual(completions, [[null, JSON.stringify({status: "applied"})]]);
});
