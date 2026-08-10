"use strict";

const assert = require("node:assert/strict");
const {describe, it} = require("node:test");

const Encoder = require("../../files/cinnamon-tpuwm@geraldo-netto/lib/tensor-encoder.js");

const CAFFE = Object.freeze({
    shape: [1, 3, 2, 2],
    dtype: "float32",
    layout: "NCHW",
    preprocess: {channelOrder: "BGR", mean: [104, 117, 123], scale: [1, 1, 1]},
});

// A padded rowstride with an unpadded final row: exactly the buffer GdkPixbuf
// returns, and the shape that makes `height * rowstride` read off the end.
function paddedImage() {
    const rowstride = 8;
    const pixels = new Uint8Array([
        10, 20, 30, 40, 50, 60, 0, 0,
        70, 80, 90, 100, 110, 120,
    ]);
    return {width: 2, height: 2, channels: 3, rowstride, pixels};
}

function solidImage({width, height, channels = 3, value = 0}) {
    const rowstride = width * channels;
    return {
        width,
        height,
        channels,
        rowstride,
        pixels: new Uint8Array(rowstride * height).fill(value),
    };
}

function spec(overrides = {}) {
    return {...CAFFE, ...overrides};
}

function preprocess(overrides) {
    return spec({preprocess: {...CAFFE.preprocess, ...overrides}});
}

describe("tensor encoder geometry", () => {
    it("reads the picture size a planar contract implies", () => {
        assert.deepEqual(
            Encoder.targetGeometry(spec({shape: [1, 3, 227, 227]})),
            {channels: 3, height: 227, width: 227},
        );
    });

    it("reads the picture size an interleaved contract implies", () => {
        assert.deepEqual(
            Encoder.targetGeometry(spec({shape: [1, 224, 224, 3], layout: "NHWC"})),
            {height: 224, width: 224, channels: 3},
        );
    });

    it("describes no picture when the contract describes no picture", () => {
        assert.equal(Encoder.targetGeometry(null), null);
        assert.equal(Encoder.targetGeometry("contract"), null);
        assert.equal(Encoder.targetGeometry([1, 3, 2, 2]), null);
        assert.equal(Encoder.targetGeometry(spec({shape: [1, 1000]})), null);
        assert.equal(Encoder.targetGeometry(spec({shape: [1, 3, 0, 2]})), null);
        assert.equal(Encoder.targetGeometry(spec({layout: "NC"})), null);
        assert.equal(Encoder.targetGeometry(spec({shape: "1x3x2x2"})), null);
        assert.equal(Encoder.targetGeometry(spec({shape: []})), null);
    });
});

describe("tensor encoder refusals", () => {
    it("accepts a contract it can honour", () => {
        assert.equal(Encoder.encodingRefusal(CAFFE), null);
        assert.equal(Encoder.shapeRefusal(CAFFE), null);
    });

    it("names why a contract cannot be honoured", () => {
        const cases = [
            [null, "contract-absent"],
            [spec({shape: [0]}), "contract-absent"],
            [spec({dtype: "uint8"}), "dtype-unsupported"],
            [spec({shape: [1, 3, 2]}), "rank-unsupported"],
            [spec({shape: [2, 3, 2, 2]}), "batch-unsupported"],
            [spec({layout: undefined}), "layout-unsupported"],
            [spec({layout: "NHWC", shape: [1, 2, 2, 5]}), "channels-unsupported"],
            [spec({preprocess: undefined}), "preprocess-undeclared"],
            [preprocess({channelOrder: "YUV"}), "preprocess-undeclared"],
            [preprocess({mean: "104"}), "preprocess-undeclared"],
            [preprocess({scale: [Number.NaN, 1, 1]}), "preprocess-undeclared"],
            [preprocess({mean: [104, 117]}), "normalisation-mismatch"],
            [preprocess({scale: [1, 1, 1, 1]}), "normalisation-mismatch"],
            [spec({shape: [1, 3, 1024, 1024]}), "tensor-too-large"],
        ];
        for (const [candidate, code] of cases) {
            assert.equal(Encoder.encodingRefusal(candidate), code, JSON.stringify(candidate));
        }
    });

    it("explains every refusal it can raise", () => {
        for (const code of Object.keys(Encoder.REFUSAL_KINDS)) {
            assert.equal(typeof Encoder.REFUSAL_KINDS[code], "string");
            assert.ok(Encoder.REFUSAL_KINDS[code].length > 0);
        }
    });

    it("refuses a grayscale contract asked for three channels and vice versa", () => {
        assert.equal(
            Encoder.normalisationRefusal({channelOrder: "GRAY", mean: [0], scale: [1]}, 3),
            "channels-unsupported",
        );
        assert.equal(
            Encoder.normalisationRefusal({channelOrder: "RGB", mean: [0], scale: [1]}, 1),
            "channels-unsupported",
        );
    });

    it("broadcasts one normalisation value across every channel", () => {
        assert.ok(Encoder.matchesChannels([0.5], 3));
        assert.ok(Encoder.matchesChannels([0, 0, 0], 3));
        assert.ok(!Encoder.matchesChannels([0, 0], 3));
        assert.equal(Encoder.channelValue(2, [0.5]), 0.5);
        assert.equal(Encoder.channelValue(2, [1, 2, 3]), 3);
    });
});

describe("tensor encoding", () => {
    it("produces the planar buffer a Caffe classifier declares", () => {
        const values = Encoder.encodeTensor(paddedImage(), CAFFE);

        assert.equal(values.length, 12);
        assert.deepEqual([...values.slice(0, 4)], [-74, -44, -14, 16], "blue plane");
        assert.deepEqual([...values.slice(4, 8)], [-97, -67, -37, -7], "green plane");
        assert.deepEqual([...values.slice(8, 12)], [-113, -83, -53, -23], "red plane");
    });

    it("interleaves an NHWC contract instead of planing it", () => {
        const values = Encoder.encodeTensor(paddedImage(), spec({
            shape: [1, 2, 2, 3],
            layout: "NHWC",
            preprocess: {channelOrder: "RGB", mean: [0], scale: [1]},
        }));

        assert.deepEqual([...values], [10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 110, 120]);
    });

    it("applies the declared scale as a multiplier after the mean", () => {
        const values = Encoder.encodeTensor(paddedImage(), spec({
            preprocess: {channelOrder: "RGB", mean: [10], scale: [0.5]},
        }));

        assert.equal(values[0], 0, "(10 - 10) * 0.5");
        assert.equal(values[1], 15, "(40 - 10) * 0.5");
    });

    it("flattens colour to one channel by Rec. 601 luma", () => {
        const values = Encoder.encodeTensor(solidImage({width: 1, height: 1, value: 200}), spec({
            shape: [1, 1, 1, 1],
            preprocess: {channelOrder: "GRAY", mean: [0], scale: [1]},
        }));

        const expected = (Encoder.LUMA_RED + Encoder.LUMA_GREEN + Encoder.LUMA_BLUE) * 200;
        assert.ok(Math.abs(values[0] - expected) < 1e-3);
    });

    it("reads an alpha channel's picture without reading its alpha", () => {
        const image = solidImage({width: 1, height: 1, channels: 4});
        image.pixels.set([10, 20, 30, 255]);

        const values = Encoder.encodeTensor(image, spec({
            shape: [1, 3, 1, 1],
            preprocess: {channelOrder: "RGB", mean: [0], scale: [1]},
        }));

        assert.deepEqual([...values], [10, 20, 30]);
    });

    it("reads a padded rowstride without walking off the final row", () => {
        const image = paddedImage();
        const needed = ((image.height - 1) * image.rowstride) + (image.width * image.channels);

        assert.equal(image.pixels.length, needed, "the fixture is the short-last-row shape");
        assert.doesNotThrow(() => Encoder.encodeTensor(image, CAFFE));
    });
});

describe("tensor encoding refuses rather than half-honours", () => {
    function refusalCode(image, candidate = CAFFE) {
        try {
            Encoder.encodeTensor(image, candidate);
        } catch (error) {
            assert.ok(Encoder.isRefusal(error));
            return error.code;
        }
        return null;
    }

    it("refuses a contract it cannot honour before touching the picture", () => {
        assert.equal(refusalCode(paddedImage(), spec({dtype: "int32"})), "dtype-unsupported");
    });

    it("refuses a picture that is not the size the model wants", () => {
        assert.equal(
            refusalCode(solidImage({width: 4, height: 4})),
            "image-size-mismatch",
        );
    });

    it("refuses a buffer shorter than its own declared rows", () => {
        const image = paddedImage();
        image.pixels = image.pixels.slice(0, 10);

        assert.equal(refusalCode(image), "image-truncated");
    });

    it("refuses anything that is not a decoded picture", () => {
        assert.equal(refusalCode(null), "image-invalid");
        assert.equal(refusalCode({width: 2, height: 2, channels: 3, rowstride: 6, pixels: []}), "image-invalid");
        assert.equal(refusalCode({...solidImage({width: 2, height: 2}), channels: 1}), "image-invalid");
    });

    it("carries a code a caller can branch on without reading English", () => {
        const error = new Encoder.TensorEncodingError("dtype-unsupported", "detail");

        assert.equal(error.code, "dtype-unsupported");
        assert.equal(error.name, "TensorEncodingError");
        assert.ok(Encoder.isRefusal(error));
        assert.ok(!Encoder.isRefusal(new Error("plain")));
        assert.ok(!Encoder.isRefusal(null));
    });
});

describe("tensor bytes", () => {
    it("writes little-endian floats whatever the host prefers", () => {
        const bytes = Encoder.tensorBytes(Float32Array.from([1]));

        assert.equal(bytes.length, 4);
        assert.deepEqual([...bytes], [0, 0, 128, 63], "1.0 as little-endian IEEE-754");
    });

    it("round-trips through the same reader the service uses", () => {
        const values = Float32Array.from([-74, 0.5, 16, -113.25]);
        const bytes = Encoder.tensorBytes(values);
        const view = new DataView(bytes.buffer);

        assert.equal(bytes.length, values.length * Encoder.BYTES_PER_FLOAT);
        for (let index = 0; index < values.length; index += 1) {
            assert.equal(view.getFloat32(index * 4, true), values[index]);
        }
    });

    it("refuses anything that is not a float buffer", () => {
        assert.throws(() => Encoder.tensorBytes([1, 2, 3]), TypeError);
        assert.throws(() => Encoder.tensorBytes(new Uint8Array(4)), TypeError);
    });
});

describe("the declared resize", () => {
    it("reads the policy a publisher stated", () => {
        assert.deepEqual(
            Encoder.declaredResize(spec({
                preprocess: {...CAFFE.preprocess, resize: {filter: "bicubic", fit: "cover"}},
            })),
            {filter: "bicubic", fit: "cover", declared: true},
        );
    });

    it("falls back to a default that says it is one", () => {
        // A default nobody agreed to is the disagreement the field removes, so
        // the caller can tell an agreement from an assumption.
        for (const candidate of [
            CAFFE,
            null,
            spec({preprocess: {...CAFFE.preprocess, resize: {filter: "lanczos", fit: "exact"}}}),
            spec({preprocess: {...CAFFE.preprocess, resize: {filter: "bilinear", fit: "letterbox"}}}),
            spec({preprocess: {...CAFFE.preprocess, resize: "bilinear"}}),
        ]) {
            assert.deepEqual(Encoder.declaredResize(candidate), Encoder.DEFAULT_RESIZE, JSON.stringify(candidate));
        }
    });

    it("names only policies a consumer can actually carry out", () => {
        assert.deepEqual([...Encoder.RESIZE_FILTERS].sort(), ["bicubic", "bilinear", "nearest"]);
        assert.deepEqual([...Encoder.RESIZE_FITS].sort(), ["cover", "exact"]);
        assert.equal(Encoder.DEFAULT_RESIZE.declared, false);
    });

    it("does not change what a declared shape means", () => {
        // The resize decides which pixels reach the encoder, never how many.
        const withResize = spec({
            preprocess: {...CAFFE.preprocess, resize: {filter: "nearest", fit: "cover"}},
        });

        assert.equal(Encoder.encodingRefusal(withResize), null);
        assert.deepEqual(Encoder.targetGeometry(withResize), Encoder.targetGeometry(CAFFE));
    });
});
