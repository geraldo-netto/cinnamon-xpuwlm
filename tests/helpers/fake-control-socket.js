"use strict";

// A fake control socket for any fake Gio environment: overlays the socket
// classes the adapter uses and answers every request from one scripted
// responder. The trace records each decoded request envelope, so a test can
// assert which method traveled without re-implementing the framing.

const Msgpack = require("../../files/cinnamon-xpuwlm@geraldo-netto/lib/msgpack-codec.js");

function frameDocument(document) {
    const payload = Msgpack.encode(document);
    const framed = new Uint8Array(4 + payload.length);
    new DataView(framed.buffer).setUint32(0, payload.length, false);
    framed.set(payload, 4);
    return framed;
}

// respond(request) returns the reply envelope's contents: either
// {result: {...}} or {error: {...}}; version and id are filled in here.
function installControlSocket(env, respond) {
    const trace = {requests: [], connects: 0, closed: 0};

    class InputStream {
        constructor() {
            this.remaining = new Uint8Array(0);
        }

        read_bytes_async(count, _priority, _cancellable, callback) {
            const served = this.remaining.subarray(0, count);
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
            const request = Msgpack.decode(framedRequest.subarray(4));
            trace.requests.push(request);
            const body = respond(request);
            this.connection.input.remaining = frameDocument({
                version: 1,
                id: request.id,
                ...body,
            });
            callback(this, {});
        }

        write_all_finish() {}
    }

    class Connection {
        constructor() {
            this.input = new InputStream();
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
        set_timeout() {}

        connect_async(_address, _cancellable, callback) {
            trace.connects += 1;
            callback(this, {});
        }

        connect_finish() {
            return new Connection();
        }
    }

    env.Gio.SocketClient = SocketClient;
    env.Gio.UnixSocketAddress = {new: (path) => ({path})};
    env.GLib.PRIORITY_DEFAULT = env.GLib.PRIORITY_DEFAULT ?? 0;
    if (typeof env.GLib.getenv !== "function") {
        env.GLib.getenv = () => null;
    }
    if (typeof env.GLib.get_user_runtime_dir !== "function") {
        env.GLib.get_user_runtime_dir = () => "/run/user/1000";
    }
    return trace;
}

module.exports = {
    frameDocument,
    installControlSocket,
};
