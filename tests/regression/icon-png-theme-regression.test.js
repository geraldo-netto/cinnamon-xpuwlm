"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const zlib = require("node:zlib");

const ICON_PATH = path.resolve(
    __dirname,
    "../../files/cinnamon-xpuwlm@geraldo-netto/icon.png",
);
const PNG_SIGNATURE = Buffer.from("89504e470d0a1a0a", "hex");

function paeth(left, up, upperLeft) {
    const estimate = left + up - upperLeft;
    const distances = [
        Math.abs(estimate - left),
        Math.abs(estimate - up),
        Math.abs(estimate - upperLeft),
    ];
    const minimum = Math.min(...distances);
    return minimum === distances[0] ? left : (minimum === distances[1] ? up : upperLeft);
}

function reconstructedByte(filter, encoded, left, up, upperLeft) {
    const predictors = [0, left, up, Math.floor((left + up) / 2), paeth(left, up, upperLeft)];
    assert.ok(filter >= 0, `negative PNG filter ${filter}`);
    assert.ok(filter < predictors.length, `unsupported PNG filter ${filter}`);
    return (encoded + predictors[filter]) & 0xff;
}

function pngChunks(contents) {
    assert.equal(contents.subarray(0, 8).equals(PNG_SIGNATURE), true);
    const chunks = [];
    for (let offset = 8; offset < contents.length;) {
        const length = contents.readUInt32BE(offset);
        const type = contents.subarray(offset + 4, offset + 8).toString("ascii");
        chunks.push({type, data: contents.subarray(offset + 8, offset + 8 + length)});
        offset += length + 12;
    }
    return chunks;
}

function decodeRgba(contents) {
    const chunks = pngChunks(contents);
    const header = chunks.find((chunk) => chunk.type === "IHDR").data;
    const width = header.readUInt32BE(0);
    const height = header.readUInt32BE(4);
    assert.deepEqual([header[8], header[9], header[10], header[11], header[12]], [8, 6, 0, 0, 0]);
    const packed = Buffer.concat(chunks.filter((chunk) => chunk.type === "IDAT").map((chunk) => chunk.data));
    const encoded = zlib.inflateSync(packed);
    const stride = width * 4;
    const pixels = Buffer.alloc(stride * height);
    for (let row = 0, source = 0; row < height; row += 1) {
        const filter = encoded[source];
        source += 1;
        for (let column = 0; column < stride; column += 1) {
            const target = row * stride + column;
            pixels[target] = reconstructedByte(
                filter,
                encoded[source + column],
                column >= 4 ? pixels[target - 4] : 0,
                row > 0 ? pixels[target - stride] : 0,
                row > 0 && column >= 4 ? pixels[target - stride - 4] : 0,
            );
        }
        source += stride;
    }
    return {width, height, pixels};
}

test("regression: the applet-browser icon carries light and dark contrast cues", () => {
    const {width, height, pixels} = decodeRgba(fs.readFileSync(ICON_PATH));
    const counts = {transparent: 0, dark: 0, light: 0, magenta: 0};
    for (let offset = 0; offset < pixels.length; offset += 4) {
        const [red, green, blue, alpha] = pixels.subarray(offset, offset + 4);
        if (alpha === 0) {
            counts.transparent += 1;
        }
        if (alpha >= 240 && Math.max(red, green, blue) <= 80) {
            counts.dark += 1;
        }
        if (alpha >= 240 && Math.min(red, green, blue) >= 230) {
            counts.light += 1;
        }
        if (alpha > 20 && red >= 180 && green <= 100 && blue >= 180) {
            counts.magenta += 1;
        }
    }

    assert.deepEqual([width, height], [256, 256]);
    assert.ok(counts.transparent > 10_000, "transparent corners keep the mark theme-neutral");
    assert.ok(counts.dark > 10_000, "charcoal fill remains visible on light themes");
    assert.ok(counts.light > 1_000, "white keyline remains visible on dark themes");
    assert.equal(counts.magenta, 0, "chroma-key pixels must not leak into the final asset");
});
