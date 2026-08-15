"use strict";

// msgpack, exactly as much of it as the control socket speaks.
//
// The runtime service frames every control-plane document as msgpack
// (omnitensor's `socket_transport.py`, msgpack-python with `use_bin_type`),
// and GJS has no msgpack engine to lean on, so this codec is hand-written
// against the specification for the value space the wire contracts allow:
// nil, booleans, integers within JavaScript's safe range, doubles, UTF-8
// strings, binary (decoded as Uint8Array), arrays, and string-keyed maps.
// Extension types are refused rather than skipped — a frame carrying one is
// from a different protocol, and guessing at its meaning would turn a wire
// error into silent corruption.
//
// Decoding is bounds-checked everywhere and depth-limited, because the bytes
// come from a socket: a declared length must fit inside the buffer before it
// is trusted, and a map key must be a string before it becomes a property.

const MAX_DEPTH = 64;

// 2^32 and 2^31 as constants: bit operators in JavaScript work on 32-bit
// signed integers, so 64-bit halves are combined with arithmetic instead.
const TWO_32 = 0x100000000;

function encoderError(detail) {
    return new TypeError(`msgpack cannot encode ${detail}`);
}

function decoderError(detail) {
    return new RangeError(`msgpack frame is invalid: ${detail}`);
}

class Writer {
    constructor() {
        this.buffer = new Uint8Array(256);
        this.length = 0;
    }

    reserve(count) {
        if (this.length + count <= this.buffer.length) {
            return;
        }
        let capacity = this.buffer.length * 2;
        while (capacity < this.length + count) {
            capacity *= 2;
        }
        const grown = new Uint8Array(capacity);
        grown.set(this.buffer.subarray(0, this.length));
        this.buffer = grown;
    }

    byte(value) {
        this.reserve(1);
        this.buffer[this.length] = value;
        this.length += 1;
    }

    bytes(values) {
        this.reserve(values.length);
        this.buffer.set(values, this.length);
        this.length += values.length;
    }

    uint16(value) {
        this.byte((value >>> 8) & 0xff);
        this.byte(value & 0xff);
    }

    uint32(value) {
        this.byte((value >>> 24) & 0xff);
        this.byte((value >>> 16) & 0xff);
        this.byte((value >>> 8) & 0xff);
        this.byte(value & 0xff);
    }

    take() {
        return this.buffer.slice(0, this.length);
    }
}

function encodeUnsignedInteger(writer, value) {
    if (value < 0x80) {
        writer.byte(value);
    } else if (value < 0x100) {
        writer.byte(0xcc);
        writer.byte(value);
    } else if (value < 0x10000) {
        writer.byte(0xcd);
        writer.uint16(value);
    } else if (value < TWO_32) {
        writer.byte(0xce);
        writer.uint32(value);
    } else {
        writer.byte(0xcf);
        writer.uint32(Math.floor(value / TWO_32));
        writer.uint32(value % TWO_32);
    }
}

function encodeNegativeInteger(writer, value) {
    if (value >= -0x20) {
        writer.byte(0x100 + value);
    } else if (value >= -0x80) {
        writer.byte(0xd0);
        writer.byte(0x100 + value);
    } else if (value >= -0x8000) {
        writer.byte(0xd1);
        writer.uint16(0x10000 + value);
    } else if (value >= -0x80000000) {
        writer.byte(0xd2);
        writer.uint32(value >>> 0);
    } else {
        // int64: two's complement across the 32-bit halves.
        writer.byte(0xd3);
        const high = Math.floor(value / TWO_32);
        writer.uint32((high + TWO_32) % TWO_32);
        writer.uint32(((value % TWO_32) + TWO_32) % TWO_32);
    }
}

function encodeDouble(writer, value) {
    writer.byte(0xcb);
    const scratch = new DataView(new ArrayBuffer(8));
    scratch.setFloat64(0, value, false);
    for (let index = 0; index < 8; index += 1) {
        writer.byte(scratch.getUint8(index));
    }
}

function encodeString(writer, value) {
    const encoded = new TextEncoder().encode(value);
    if (encoded.length < 0x20) {
        writer.byte(0xa0 | encoded.length);
    } else if (encoded.length < 0x100) {
        writer.byte(0xd9);
        writer.byte(encoded.length);
    } else if (encoded.length < 0x10000) {
        writer.byte(0xda);
        writer.uint16(encoded.length);
    } else {
        writer.byte(0xdb);
        writer.uint32(encoded.length);
    }
    writer.bytes(encoded);
}

function encodeBinary(writer, value) {
    if (value.length < 0x100) {
        writer.byte(0xc4);
        writer.byte(value.length);
    } else if (value.length < 0x10000) {
        writer.byte(0xc5);
        writer.uint16(value.length);
    } else {
        writer.byte(0xc6);
        writer.uint32(value.length);
    }
    writer.bytes(value);
}

function encodeNumber(writer, value) {
    if (Number.isInteger(value) && Math.abs(value) <= Number.MAX_SAFE_INTEGER) {
        if (value >= 0) {
            encodeUnsignedInteger(writer, value);
        } else {
            encodeNegativeInteger(writer, value);
        }
    } else if (Number.isFinite(value)) {
        encodeDouble(writer, value);
    } else {
        throw encoderError("a non-finite number");
    }
}

function encodeArray(writer, value, depth) {
    if (value.length < 0x10) {
        writer.byte(0x90 | value.length);
    } else if (value.length < 0x10000) {
        writer.byte(0xdc);
        writer.uint16(value.length);
    } else {
        writer.byte(0xdd);
        writer.uint32(value.length);
    }
    for (const entry of value) {
        encodeValue(writer, entry, depth + 1);
    }
}

function encodeMap(writer, value, depth) {
    const keys = Object.keys(value);
    if (keys.length < 0x10) {
        writer.byte(0x80 | keys.length);
    } else if (keys.length < 0x10000) {
        writer.byte(0xde);
        writer.uint16(keys.length);
    } else {
        writer.byte(0xdf);
        writer.uint32(keys.length);
    }
    for (const key of keys) {
        encodeString(writer, key);
        encodeValue(writer, value[key], depth + 1);
    }
}

function encodeObject(writer, value, depth) {
    if (value instanceof Uint8Array) {
        encodeBinary(writer, value);
    } else if (Array.isArray(value)) {
        encodeArray(writer, value, depth);
    } else {
        encodeMap(writer, value, depth);
    }
}

// One encoder per JavaScript type; null lands in "object" and undefined has
// its own typeof, so both spellings of nothing become nil.
const TYPE_ENCODERS = {
    boolean: (writer, value) => writer.byte(value ? 0xc3 : 0xc2),
    number: encodeNumber,
    object: (writer, value, depth) => (
        value === null ? writer.byte(0xc0) : encodeObject(writer, value, depth)
    ),
    string: (writer, value) => encodeString(writer, value),
    undefined: (writer) => writer.byte(0xc0),
};

function encodeValue(writer, value, depth) {
    if (depth > MAX_DEPTH) {
        throw encoderError(`nesting deeper than ${MAX_DEPTH}`);
    }
    const encoder = TYPE_ENCODERS[typeof value];
    if (encoder === undefined) {
        throw encoderError(`a ${typeof value}`);
    }
    encoder(writer, value, depth);
}

function encode(value) {
    const writer = new Writer();
    encodeValue(writer, value, 0);
    return writer.take();
}

class Reader {
    constructor(bytes) {
        this.bytes = bytes;
        this.offset = 0;
    }

    need(count) {
        if (this.offset + count > this.bytes.length) {
            throw decoderError("a declared length runs past the end of the frame");
        }
    }

    byte() {
        this.need(1);
        const value = this.bytes[this.offset];
        this.offset += 1;
        return value;
    }

    uint16() {
        return this.byte() * 0x100 + this.byte();
    }

    uint32() {
        return this.uint16() * 0x10000 + this.uint16();
    }

    slice(count) {
        this.need(count);
        const value = this.bytes.subarray(this.offset, this.offset + count);
        this.offset += count;
        return value;
    }

    double() {
        this.need(8);
        const view = new DataView(
            this.bytes.buffer,
            this.bytes.byteOffset + this.offset,
            8,
        );
        this.offset += 8;
        return view.getFloat64(0, false);
    }

    float() {
        this.need(4);
        const view = new DataView(
            this.bytes.buffer,
            this.bytes.byteOffset + this.offset,
            4,
        );
        this.offset += 4;
        return view.getFloat32(0, false);
    }
}

function safeInteger(value, detail) {
    if (value > Number.MAX_SAFE_INTEGER) {
        throw decoderError(`${detail} exceeds JavaScript's safe integer range`);
    }
    return value;
}

function decodeString(reader, length) {
    const encoded = reader.slice(length);
    try {
        return new TextDecoder("utf-8", {fatal: true}).decode(encoded);
    } catch {
        throw decoderError("a string is not valid UTF-8");
    }
}

function decodeMap(reader, count, depth) {
    const value = {};
    for (let index = 0; index < count; index += 1) {
        const key = decodeValue(reader, depth + 1);
        if (typeof key !== "string") {
            throw decoderError("a map key is not a string");
        }
        if (key === "__proto__") {
            throw decoderError("a map key would rewrite the prototype");
        }
        value[key] = decodeValue(reader, depth + 1);
    }
    return value;
}

function decodeArray(reader, count, depth) {
    const value = [];
    for (let index = 0; index < count; index += 1) {
        value.push(decodeValue(reader, depth + 1));
    }
    return value;
}

function decodeInt64(reader) {
    const high = reader.uint32();
    const low = reader.uint32();
    if (high < 0x80000000) {
        return safeInteger(high * TWO_32 + low, "an int64");
    }
    return -safeInteger((TWO_32 - 1 - high) * TWO_32 + (TWO_32 - low), "an int64");
}

// One decoder per non-fix marker; 0xc1 is never used and 0xc7-0xc9 plus
// 0xd4-0xd8 are extension types, so their absence here is the refusal.
const MARKER_DECODERS = {
    0xc0: () => null,
    0xc2: () => false,
    0xc3: () => true,
    0xc4: (reader) => reader.slice(reader.byte()).slice(),
    0xc5: (reader) => reader.slice(reader.uint16()).slice(),
    0xc6: (reader) => reader.slice(reader.uint32()).slice(),
    0xca: (reader) => reader.float(),
    0xcb: (reader) => reader.double(),
    0xcc: (reader) => reader.byte(),
    0xcd: (reader) => reader.uint16(),
    0xce: (reader) => reader.uint32(),
    0xcf: (reader) => safeInteger(reader.uint32() * TWO_32 + reader.uint32(), "a uint64"),
    0xd0: (reader) => {
        const value = reader.byte();
        return value < 0x80 ? value : value - 0x100;
    },
    0xd1: (reader) => {
        const value = reader.uint16();
        return value < 0x8000 ? value : value - 0x10000;
    },
    0xd2: (reader) => {
        const value = reader.uint32();
        return value < 0x80000000 ? value : value - TWO_32;
    },
    0xd3: decodeInt64,
    0xd9: (reader) => decodeString(reader, reader.byte()),
    0xda: (reader) => decodeString(reader, reader.uint16()),
    0xdb: (reader) => decodeString(reader, reader.uint32()),
    0xdc: (reader, depth) => decodeArray(reader, reader.uint16(), depth),
    0xdd: (reader, depth) => decodeArray(reader, reader.uint32(), depth),
    0xde: (reader, depth) => decodeMap(reader, reader.uint16(), depth),
    0xdf: (reader, depth) => decodeMap(reader, reader.uint32(), depth),
};

function decodeValue(reader, depth) {
    if (depth > MAX_DEPTH) {
        throw decoderError(`nesting deeper than ${MAX_DEPTH}`);
    }
    const marker = reader.byte();
    if (marker < 0x80) {
        return marker;
    }
    if (marker >= 0xe0) {
        return marker - 0x100;
    }
    if (marker < 0x90) {
        return decodeMap(reader, marker & 0x0f, depth);
    }
    if (marker < 0xa0) {
        return decodeArray(reader, marker & 0x0f, depth);
    }
    if (marker < 0xc0) {
        return decodeString(reader, marker & 0x1f);
    }
    const decoder = MARKER_DECODERS[marker];
    if (decoder === undefined) {
        throw decoderError(`marker 0x${marker.toString(16)} is not part of the protocol`);
    }
    return decoder(reader, depth);
}

function decode(bytes) {
    if (!(bytes instanceof Uint8Array)) {
        throw decoderError("input is not a byte array");
    }
    const reader = new Reader(bytes);
    const value = decodeValue(reader, 0);
    if (reader.offset !== bytes.length) {
        throw decoderError(`${bytes.length - reader.offset} trailing bytes after the value`);
    }
    return value;
}

module.exports = {
    MAX_DEPTH,
    decode,
    encode,
};
