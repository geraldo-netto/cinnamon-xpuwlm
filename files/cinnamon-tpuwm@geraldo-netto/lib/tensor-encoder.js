"use strict";

// Turn a decoded picture into the exact buffer a model says it wants.
//
// The runtime decodes nothing, deliberately: it reads raw little-endian
// numbers from a file whose shape, dtype, and digest the caller declares, and
// it never learns what a PNG is. Something has to stand between a user's
// picture and that buffer. It is this applet, because the applet is the only
// party that already holds the picture, already parses the manifest that
// states `tensorContract`, and has no accelerator to protect from an image
// decoder.
//
// Everything in this module is arithmetic: pixels in, floats out. The
// GdkPixbuf decode and the file write are adapters elsewhere, so the step that
// decides what a model actually sees stays testable without a display server —
// which matters, because a tensor normalised the wrong way infers perfectly
// and means nothing.
//
// Nothing here guesses. A profile that states a shape but not how to normalise
// a picture for it is refused with a code the popup can explain, rather than
// fed a plausible default: RGB where the model wanted BGR is a wrong answer
// that looks exactly like a right one.

// The runtime's own per-job element budget (`MAX_TENSOR_ELEMENTS`). Restated
// here so an oversized tensor is refused before a megabyte of floats is built
// and written, rather than after the service reads the file back.
const MAX_ELEMENTS = 1 << 20;
const BYTES_PER_FLOAT = 4;
const RANK = 4;
const BATCH = 1;

const LAYOUTS = new Set(["NCHW", "NHWC"]);
const CHANNEL_ORDERS = new Set(["RGB", "BGR", "GRAY"]);
const ORDER_CHANNELS = Object.freeze({RGB: 3, BGR: 3, GRAY: 1});

// Rec. 601 luma, the coefficients every common toolchain uses to flatten a
// colour picture to one channel. Stated rather than assumed, so a model
// trained against a different weighting is a known difference and not a
// mystery.
const LUMA_RED = 0.299;
const LUMA_GREEN = 0.587;
const LUMA_BLUE = 0.114;

// Why a picture cannot be turned into this model's input. Codes rather than
// sentences: the popup chooses what to tell the user, and rewording an
// explanation must not silently cost somebody their remedy.
const REFUSAL_KINDS = Object.freeze({
    "contract-absent": "the profile declares no input contract",
    "dtype-unsupported": "the profile wants a dtype this applet cannot produce from a picture",
    "rank-unsupported": "the profile wants an input that is not a single image",
    "batch-unsupported": "the profile wants more than one image at a time",
    "layout-unsupported": "the profile does not say how its input is laid out",
    "channels-unsupported": "the profile wants a channel count a picture cannot fill",
    "preprocess-undeclared": "the profile does not say how a picture becomes its input",
    "normalisation-mismatch": "the profile's normalisation does not match its channel count",
    "tensor-too-large": "the profile wants an input larger than the runtime accepts",
});

class TensorEncodingError extends Error {
    constructor(code, detail) {
        super(`${code}: ${detail}`);
        this.name = "TensorEncodingError";
        this.code = code;
        this.detail = detail;
        this.tensorEncodingRefusal = true;
    }
}

function isRefusal(error) {
    return error !== null
        && typeof error === "object"
        && error.tensorEncodingRefusal === true;
}

function isRecord(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isPositiveIntegerList(value, maximumLength) {
    return Array.isArray(value)
        && value.length >= 1
        && value.length <= maximumLength
        && value.every((item) => Number.isInteger(item) && item >= 1);
}

function isFiniteNumberList(value) {
    return Array.isArray(value)
        && value.length >= 1
        && value.every((item) => Number.isFinite(item));
}

// The picture size and channel count this contract implies, or null when the
// contract does not describe a picture at all.
function targetGeometry(spec) {
    if (!isRecord(spec) || !isPositiveIntegerList(spec.shape, 6)) {
        return null;
    }
    const shape = spec.shape;
    if (shape.length !== RANK || !LAYOUTS.has(spec.layout)) {
        return null;
    }
    const [, first, second, third] = shape;
    return spec.layout === "NCHW"
        ? {channels: first, height: second, width: third}
        : {height: first, width: second, channels: third};
}

function shapeRefusal(spec) {
    if (!isRecord(spec) || !isPositiveIntegerList(spec.shape, 6)) {
        return "contract-absent";
    }
    if (spec.dtype !== "float32") {
        // uint8 and the integer dtypes are real model inputs; producing one
        // means knowing the quantisation the manifest does not state, so the
        // honest answer is that this applet cannot make that buffer.
        return "dtype-unsupported";
    }
    if (spec.shape.length !== RANK) {
        return "rank-unsupported";
    }
    if (spec.shape[0] !== BATCH) {
        return "batch-unsupported";
    }
    return LAYOUTS.has(spec.layout) ? null : "layout-unsupported";
}

function normalisationRefusal(preprocess, channels) {
    if (!isRecord(preprocess) || !CHANNEL_ORDERS.has(preprocess.channelOrder)) {
        return "preprocess-undeclared";
    }
    if (ORDER_CHANNELS[preprocess.channelOrder] !== channels) {
        return "channels-unsupported";
    }
    if (!isFiniteNumberList(preprocess.mean) || !isFiniteNumberList(preprocess.scale)) {
        return "preprocess-undeclared";
    }
    return matchesChannels(preprocess.mean, channels) && matchesChannels(preprocess.scale, channels)
        ? null
        : "normalisation-mismatch";
}

// One value broadcasts across every channel, which is how a grayscale mean is
// usually written; anything else must name every channel exactly once.
function matchesChannels(values, channels) {
    return values.length === 1 || values.length === channels;
}

// Why this contract cannot be honoured, or null when it can. Separate from the
// encoder so the popup can grey out a profile with an explanation before the
// user picks a file and waits for a refusal.
function encodingRefusal(spec) {
    const shaped = shapeRefusal(spec);
    if (shaped !== null) {
        return shaped;
    }
    const geometry = targetGeometry(spec);
    if (geometry.width * geometry.height * geometry.channels > MAX_ELEMENTS) {
        return "tensor-too-large";
    }
    return normalisationRefusal(spec.preprocess, geometry.channels);
}

function channelValue(index, values) {
    return values.length === 1 ? values[0] : values[index];
}

// GdkPixbuf hands back RGB or RGBA; a model asks for RGB, BGR, or one grey
// channel. Reading the source triple once and permuting here keeps the pixel
// loop free of per-pixel branching on the order.
function sourceValue(order, channel, red, green, blue) {
    if (order === "GRAY") {
        return (LUMA_RED * red) + (LUMA_GREEN * green) + (LUMA_BLUE * blue);
    }
    const triple = order === "BGR" ? [blue, green, red] : [red, green, blue];
    return triple[channel];
}

function requireImage(image, geometry) {
    if (!isRecord(image) || !(image.pixels instanceof Uint8Array)) {
        throw new TensorEncodingError("image-invalid", "the decoded image carries no pixels");
    }
    if (image.width !== geometry.width || image.height !== geometry.height) {
        throw new TensorEncodingError(
            "image-size-mismatch",
            `the image is ${image.width}x${image.height} and the model wants `
            + `${geometry.width}x${geometry.height}`,
        );
    }
    if (image.channels < 3) {
        throw new TensorEncodingError(
            "image-invalid",
            `a decoded image must carry at least three channels, not ${image.channels}`,
        );
    }
    requireCompleteRows(image);
}

// GdkPixbuf reports its last row without the rowstride padding every earlier
// row carries, so the buffer is `(height - 1) * rowstride + width * channels`
// bytes and never `height * rowstride`. Reading on the arithmetic that looks
// obviously right walks off the end of the final row.
function requireCompleteRows(image) {
    const needed = ((image.height - 1) * image.rowstride) + (image.width * image.channels);
    if (image.pixels.length < needed) {
        throw new TensorEncodingError(
            "image-truncated",
            `the decoded image holds ${image.pixels.length} bytes and needs ${needed}`,
        );
    }
}

function writePlanes(image, spec, geometry) {
    const {width, height, channels} = geometry;
    const order = spec.preprocess.channelOrder;
    const mean = spec.preprocess.mean;
    const scale = spec.preprocess.scale;
    const planar = spec.layout === "NCHW";
    const values = new Float32Array(width * height * channels);
    for (let y = 0; y < height; y += 1) {
        const row = y * image.rowstride;
        for (let x = 0; x < width; x += 1) {
            const pixel = row + (x * image.channels);
            writePixel({image, pixel, values, geometry, planar, order, mean, scale, x, y});
        }
    }
    return values;
}

function writePixel(context) {
    const {image, pixel, values, geometry, planar, order, mean, scale, x, y} = context;
    const red = image.pixels[pixel];
    const green = image.pixels[pixel + 1];
    const blue = image.pixels[pixel + 2];
    const plane = geometry.width * geometry.height;
    for (let channel = 0; channel < geometry.channels; channel += 1) {
        const raw = sourceValue(order, channel, red, green, blue);
        const value = (raw - channelValue(channel, mean)) * channelValue(channel, scale);
        const index = planar
            ? (channel * plane) + (y * geometry.width) + x
            : (((y * geometry.width) + x) * geometry.channels) + channel;
        values[index] = value;
    }
}

// The buffer this model declares, built from this picture. Throws a coded
// refusal rather than returning a half-honoured tensor: every failure here
// would otherwise reach the accelerator as numbers that infer successfully.
function encodeTensor(image, spec) {
    const refusal = encodingRefusal(spec);
    if (refusal !== null) {
        throw new TensorEncodingError(refusal, REFUSAL_KINDS[refusal]);
    }
    const geometry = targetGeometry(spec);
    requireImage(image, geometry);
    return writePlanes(image, spec, geometry);
}

// Little-endian explicitly, never by borrowing the host's byte order: the
// service unpacks with `struct.unpack("<f")` on whatever machine it runs, and
// a big-endian host that agreed with itself would produce a file that is
// digest-valid, correctly sized, and numerically meaningless.
function tensorBytes(values) {
    if (!(values instanceof Float32Array)) {
        throw new TypeError("Tensor bytes require a Float32Array");
    }
    const bytes = new Uint8Array(values.length * BYTES_PER_FLOAT);
    const view = new DataView(bytes.buffer);
    for (let index = 0; index < values.length; index += 1) {
        view.setFloat32(index * BYTES_PER_FLOAT, values[index], true);
    }
    return bytes;
}

module.exports = {
    BYTES_PER_FLOAT,
    CHANNEL_ORDERS,
    LAYOUTS,
    LUMA_BLUE,
    LUMA_GREEN,
    LUMA_RED,
    MAX_ELEMENTS,
    ORDER_CHANNELS,
    REFUSAL_KINDS,
    TensorEncodingError,
    channelValue,
    encodeTensor,
    encodingRefusal,
    isRefusal,
    matchesChannels,
    normalisationRefusal,
    shapeRefusal,
    sourceValue,
    targetGeometry,
    tensorBytes,
};
