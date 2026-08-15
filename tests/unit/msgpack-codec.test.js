"use strict";

const assert = require("node:assert/strict");
const {test} = require("node:test");

const Msgpack = require("../../files/cinnamon-xpuwlm@geraldo-netto/lib/msgpack-codec.js");

function bytes(...values) {
    return new Uint8Array(values);
}

function roundTrip(value) {
    return Msgpack.decode(Msgpack.encode(value));
}

test("scalars round-trip and take their smallest wire form", () => {
    assert.deepEqual(Msgpack.encode(null), bytes(0xc0));
    assert.deepEqual(Msgpack.encode(undefined), bytes(0xc0));
    assert.deepEqual(Msgpack.encode(false), bytes(0xc2));
    assert.deepEqual(Msgpack.encode(true), bytes(0xc3));
    assert.equal(roundTrip(null), null);
    assert.equal(roundTrip(true), true);
    assert.equal(roundTrip(false), false);
});

test("integers use the exact boundary formats in both directions", () => {
    const boundaries = [
        [0, bytes(0x00)],
        [127, bytes(0x7f)],
        [128, bytes(0xcc, 0x80)],
        [255, bytes(0xcc, 0xff)],
        [256, bytes(0xcd, 0x01, 0x00)],
        [65535, bytes(0xcd, 0xff, 0xff)],
        [65536, bytes(0xce, 0x00, 0x01, 0x00, 0x00)],
        [4294967295, bytes(0xce, 0xff, 0xff, 0xff, 0xff)],
        [4294967296, bytes(0xcf, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x00)],
        [-1, bytes(0xff)],
        [-32, bytes(0xe0)],
        [-33, bytes(0xd0, 0xdf)],
        [-128, bytes(0xd0, 0x80)],
        [-129, bytes(0xd1, 0xff, 0x7f)],
        [-32768, bytes(0xd1, 0x80, 0x00)],
        [-32769, bytes(0xd2, 0xff, 0xff, 0x7f, 0xff)],
        [-2147483648, bytes(0xd2, 0x80, 0x00, 0x00, 0x00)],
    ];
    for (const [value, wire] of boundaries) {
        assert.deepEqual(Msgpack.encode(value), wire, `encode ${value}`);
        assert.equal(Msgpack.decode(wire), value, `decode ${value}`);
    }
});

test("64-bit integers carry timestamps and stay exact to the safe range", () => {
    for (const value of [
        1786760956830, // an appliedAt observed live
        Number.MAX_SAFE_INTEGER,
        -1786760956830,
        -4294967296,
        -4294967297,
        -Number.MAX_SAFE_INTEGER,
    ]) {
        assert.equal(roundTrip(value), value);
    }
});

test("a uint64 beyond the safe integer range is refused, not rounded", () => {
    // 2^63: valid msgpack, unrepresentable as an exact JS number.
    const wire = bytes(0xcf, 0x80, 0, 0, 0, 0, 0, 0, 0);
    assert.throws(() => Msgpack.decode(wire), /safe integer range/u);
});

test("doubles and float32 decode; non-finite numbers are refused", () => {
    assert.equal(roundTrip(3.14), 3.14);
    assert.equal(roundTrip(-2.5e-8), -2.5e-8);
    // float32 1.5 from another encoder still decodes.
    assert.equal(Msgpack.decode(bytes(0xca, 0x3f, 0xc0, 0x00, 0x00)), 1.5);
    assert.throws(() => Msgpack.encode(Infinity), /non-finite/u);
    assert.throws(() => Msgpack.encode(NaN), /non-finite/u);
});

test("strings cross every length format and stay UTF-8 exact", () => {
    const hebrew = "שלום עולם";
    assert.equal(roundTrip(hebrew), hebrew);
    assert.equal(roundTrip(""), "");
    for (const length of [31, 32, 255, 256, 65535, 65536]) {
        const value = "x".repeat(length);
        assert.equal(roundTrip(value), value, `string length ${length}`);
    }
    // fixstr boundary bytes.
    assert.deepEqual(Msgpack.encode("a"), bytes(0xa1, 0x61));
    assert.equal(Msgpack.encode("x".repeat(32))[0], 0xd9);
});

test("invalid UTF-8 in a string is an error, not replacement characters", () => {
    assert.throws(() => Msgpack.decode(bytes(0xa2, 0xff, 0xfe)), RangeError);
});

test("binary decodes as Uint8Array across its length formats", () => {
    for (const length of [0, 255, 256, 65536]) {
        const value = new Uint8Array(length).map((_, index) => index % 256);
        const decoded = roundTrip(value);
        assert.ok(decoded instanceof Uint8Array);
        assert.deepEqual(Array.from(decoded), Array.from(value), `bin length ${length}`);
    }
    assert.equal(Msgpack.encode(new Uint8Array(1))[0], 0xc4);
});

test("arrays and maps cross the fix-format boundaries", () => {
    for (const length of [0, 15, 16, 65535]) {
        const value = Array.from({length}, (_, index) => index);
        assert.deepEqual(roundTrip(value), value, `array length ${length}`);
    }
    const flat = {};
    for (let index = 0; index < 16; index += 1) {
        flat[`k${index}`] = index;
    }
    assert.deepEqual(roundTrip(flat), flat);
    assert.equal(Msgpack.encode(flat)[0], 0xde);
    assert.equal(Msgpack.encode({a: 1})[0], 0x81);
});

test("nested documents round-trip exactly", () => {
    const document = {
        version: 1,
        id: 42,
        method: "apply-command",
        params: {
            profiles: {a: {enabled: true, weight: 2}},
            values: [1, -1, 2.5, null, "text"],
        },
    };
    assert.deepEqual(roundTrip(document), document);
});

test("nesting beyond the depth limit is refused in both directions", () => {
    let nested = 0;
    for (let index = 0; index <= Msgpack.MAX_DEPTH; index += 1) {
        nested = [nested];
    }
    assert.throws(() => Msgpack.encode(nested), /nesting deeper/u);
    const wire = new Uint8Array(Msgpack.MAX_DEPTH + 2).fill(0x91);
    wire[wire.length - 1] = 0x00;
    assert.throws(() => Msgpack.decode(wire), /nesting deeper/u);
});

test("extension markers are refused rather than skipped", () => {
    for (const marker of [0xc1, 0xc7, 0xc8, 0xc9, 0xd4, 0xd5, 0xd6, 0xd7, 0xd8]) {
        assert.throws(
            () => Msgpack.decode(bytes(marker, 0x00, 0x00)),
            /not part of the protocol/u,
            `marker 0x${marker.toString(16)}`,
        );
    }
});

test("a declared length past the end of the frame is refused", () => {
    assert.throws(() => Msgpack.decode(bytes(0xa5, 0x61)), /runs past the end/u);
    assert.throws(() => Msgpack.decode(bytes(0xc4, 0x05, 0x00)), /runs past the end/u);
    assert.throws(() => Msgpack.decode(bytes(0xcd, 0x01)), /runs past the end/u);
    assert.throws(() => Msgpack.decode(bytes()), /runs past the end/u);
});

test("trailing bytes after the value are refused", () => {
    assert.throws(() => Msgpack.decode(bytes(0xc0, 0x00)), /trailing bytes/u);
});

test("a map key that is not a string is refused", () => {
    // {1: 2} — legal msgpack, not a JSON document.
    assert.throws(() => Msgpack.decode(bytes(0x81, 0x01, 0x02)), /not a string/u);
});

test("a __proto__ key cannot rewrite the prototype", () => {
    const wire = Msgpack.encode({attack: true});
    // Hand-build {"__proto__": {"polluted": true}}.
    const key = new TextEncoder().encode("__proto__");
    const evil = new Uint8Array([0x81, 0xa0 | key.length, ...key, 0x81, 0xa8,
        ...new TextEncoder().encode("polluted"), 0xc3]);
    assert.throws(() => Msgpack.decode(evil), /prototype/u);
    assert.equal({}.polluted, undefined);
    assert.deepEqual(Msgpack.decode(wire), {attack: true});
});

test("non-encodable JavaScript values are refused by type", () => {
    assert.throws(() => Msgpack.encode(() => {}), /cannot encode a function/u);
    assert.throws(() => Msgpack.encode(Symbol("x")), /cannot encode a symbol/u);
    assert.throws(() => Msgpack.encode(10n), /cannot encode a bigint/u);
});

test("decode refuses anything that is not a byte array", () => {
    assert.throws(() => Msgpack.decode("c0"), /not a byte array/u);
    assert.throws(() => Msgpack.decode([0xc0]), /not a byte array/u);
});


test("foreign encoders' wider-than-needed integer forms still decode", () => {
    // Our encoder always picks the smallest form; another encoder may not.
    assert.equal(Msgpack.decode(bytes(0xd0, 0x05)), 5);
    assert.equal(Msgpack.decode(bytes(0xd1, 0x00, 0x07)), 7);
    assert.equal(Msgpack.decode(bytes(0xd2, 0x00, 0x00, 0x00, 0x09)), 9);
    // Positive int64: high word below the sign bit.
    assert.equal(
        Msgpack.decode(bytes(0xd3, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x02)),
        4294967298,
    );
    // Negative int64 with a zero low word exercises the borrow.
    assert.equal(
        Msgpack.decode(bytes(0xd3, 0xff, 0xff, 0xff, 0xff, 0x00, 0x00, 0x00, 0x00)),
        -4294967296,
    );
});

test("an array beyond 65535 entries takes the 32-bit form", () => {
    const value = new Array(65536).fill(0);
    const wire = Msgpack.encode(value);
    assert.equal(wire[0], 0xdd);
    assert.equal(Msgpack.decode(wire).length, 65536);
});


test("a map beyond 65535 keys takes the 32-bit form", () => {
    const value = {};
    for (let index = 0; index < 65536; index += 1) {
        value[`k${index}`] = 1;
    }
    const wire = Msgpack.encode(value);
    assert.equal(wire[0], 0xdf);
    assert.equal(Object.keys(Msgpack.decode(wire)).length, 65536);
});
