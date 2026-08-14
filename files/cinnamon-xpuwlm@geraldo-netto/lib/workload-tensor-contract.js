"use strict";

const Validation = require("./validation.js");

const TENSOR_CONTRACT_PROPERTIES = new Set(["inputs"]);
const TENSOR_INPUT_REQUIRED = Object.freeze(["shape", "dtype"]);
const TENSOR_INPUT_PROPERTIES = new Set([...TENSOR_INPUT_REQUIRED, "layout", "preprocess"]);
const TENSOR_DTYPES = new Set(["float32", "float64", "int32", "int64", "uint8"]);
const TENSOR_LAYOUTS = new Set(["NCHW", "NHWC", "NC", "N"]);
const PREPROCESS_REQUIRED = Object.freeze(["channelOrder", "mean", "scale"]);
// `resize` is optional: a manifest written before the field still loads, and
// absent means the consumer decides — which is exactly the convention-by-
// accident the field exists to replace where a publisher cares.
const PREPROCESS_PROPERTIES = new Set([...PREPROCESS_REQUIRED, "resize"]);
const RESIZE_REQUIRED = Object.freeze(["filter", "fit"]);
const RESIZE_PROPERTIES = new Set(RESIZE_REQUIRED);
const RESIZE_FILTERS = new Set(["nearest", "bilinear", "bicubic"]);
const RESIZE_FITS = new Set(["exact", "cover"]);
const CHANNEL_ORDERS = new Set(["RGB", "BGR", "GRAY"]);
const MAX_TENSOR_INPUTS = 8;
const MAX_TENSOR_RANK = 6;
const MAX_TENSOR_DIMENSION = 65536;
const MAX_CHANNELS = 4;
const OUTPUT_CONTRACT_REQUIRED = Object.freeze(["kind"]);
const OUTPUT_CONTRACT_PROPERTIES = new Set([...OUTPUT_CONTRACT_REQUIRED, "topK", "labels"]);
const OUTPUT_KINDS = new Set(["classification", "embedding", "raw"]);
const LABELS_FILENAME = /^[a-z0-9][a-z0-9._-]{0,63}$/u;
const MAX_TOP_K = 100;
const FEATURE_CONTRACT_REQUIRED = Object.freeze([
    "version", "recipe", "featureNames", "targetFeature", "window", "horizon",
    "observationOrder", "flattenOrder",
]);
const FEATURE_CONTRACT_PROPERTIES = new Set(FEATURE_CONTRACT_REQUIRED);
const FORECAST_INPUT_PROPERTIES = new Set(["shape", "dtype", "layout"]);
const RAW_OUTPUT_PROPERTIES = new Set(["kind"]);
const MAX_FORECAST_FEATURES = 128;
const MAX_FORECAST_FEATURE_NAME = 64;
const MAX_FORECAST_WINDOW = 128;
const MAX_FORECAST_INPUT_WIDTH = 512;

const {boundedText, exactKeys, isRecord} = Validation;

// An exact key count is wrong wherever the contract has optional properties:
// every required name must be present, and no name outside the allowed set.
function boundedProperties(value, required, allowed) {
    return isRecord(value)
        && required.every((name) => Object.hasOwn(value, name))
        && Object.keys(value).every((name) => allowed.has(name));
}

// JSON Schema treats a property whose value is `undefined` as absent, so an
// optional-property mirror has to agree or it rejects documents the contract
// accepts.
function declared(value, name) {
    return Object.hasOwn(value, name) && value[name] !== undefined;
}

function uniqueBoundedTextList(value, maximumItems, maximumLength) {
    return Array.isArray(value)
        && value.length <= maximumItems
        && new Set(value).size === value.length
        && value.every((item) => boundedText(item, 1, maximumLength));
}

function isFiniteNumberArray(value, minimum, maximum, positive) {
    return Array.isArray(value)
        && value.length >= minimum
        && value.length <= maximum
        && value.every((item) => typeof item === "number"
            && Number.isFinite(item)
            && (!positive || item > 0));
}

function isResize(value) {
    return exactKeys(value, RESIZE_PROPERTIES)
        && RESIZE_FILTERS.has(value.filter)
        && RESIZE_FITS.has(value.fit);
}

function isPreprocess(value) {
    return boundedProperties(value, PREPROCESS_REQUIRED, PREPROCESS_PROPERTIES)
        && CHANNEL_ORDERS.has(value.channelOrder)
        && isFiniteNumberArray(value.mean, 1, MAX_CHANNELS, false)
        && isFiniteNumberArray(value.scale, 1, MAX_CHANNELS, true)
        && (!declared(value, "resize") || isResize(value.resize));
}

function isTensorShape(value) {
    return Array.isArray(value)
        && value.length >= 1
        && value.length <= MAX_TENSOR_RANK
        && value.every((item) => Number.isInteger(item)
            && item >= 1
            && item <= MAX_TENSOR_DIMENSION);
}

function isTensorInput(value) {
    return boundedProperties(value, TENSOR_INPUT_REQUIRED, TENSOR_INPUT_PROPERTIES)
        && isTensorShape(value.shape)
        && TENSOR_DTYPES.has(value.dtype)
        && (!declared(value, "layout") || TENSOR_LAYOUTS.has(value.layout))
        && (!declared(value, "preprocess") || isPreprocess(value.preprocess));
}

function isTensorContract(value) {
    return exactKeys(value, TENSOR_CONTRACT_PROPERTIES)
        && Array.isArray(value.inputs)
        && value.inputs.length >= 1
        && value.inputs.length <= MAX_TENSOR_INPUTS
        && value.inputs.every(isTensorInput);
}

function isTopK(value) {
    return !declared(value, "topK")
        || (Number.isInteger(value.topK) && value.topK >= 1 && value.topK <= MAX_TOP_K);
}

function isLabelsFilename(value) {
    return !declared(value, "labels")
        || (typeof value.labels === "string" && LABELS_FILENAME.test(value.labels));
}

function isOutputContract(value) {
    return boundedProperties(value, OUTPUT_CONTRACT_REQUIRED, OUTPUT_CONTRACT_PROPERTIES)
        && OUTPUT_KINDS.has(value.kind)
        && isTopK(value)
        && isLabelsFilename(value);
}

function canonicalJson(value) {
    if (Array.isArray(value)) {
        return `[${value.map(canonicalJson).join(",")}]`;
    }
    if (isRecord(value)) {
        return `{${Object.keys(value).sort(Validation.compareText)
            .map((name) => `${JSON.stringify(name)}:${canonicalJson(value[name])}`)
            .join(",")}}`;
    }
    return JSON.stringify(value) ?? "null";
}

function isForecastInput(value, width) {
    return exactKeys(value, FORECAST_INPUT_PROPERTIES)
        && canonicalJson(value) === canonicalJson({
            shape: [1, width], dtype: "float32", layout: "NC",
        });
}

function hasForecastTensor(model, width) {
    const tensor = model.tensorContract;
    return isRecord(tensor)
        && Array.isArray(tensor.inputs)
        && tensor.inputs.length === 1
        && isForecastInput(tensor.inputs[0], width)
        && exactKeys(model.outputContract, RAW_OUTPUT_PROPERTIES)
        && model.outputContract.kind === "raw";
}

function hasFeatureIdentity(value) {
    return exactKeys(value, FEATURE_CONTRACT_PROPERTIES)
        && value.version === 1
        && value.recipe === "forecast-v1"
        && uniqueBoundedTextList(
            value.featureNames,
            MAX_FORECAST_FEATURES,
            MAX_FORECAST_FEATURE_NAME,
        )
        && value.featureNames.length >= 1
        && value.targetFeature === value.featureNames[0];
}

function boundedForecastCount(value) {
    return Number.isInteger(value) && value >= 1 && value <= MAX_FORECAST_WINDOW;
}

function isFeatureContract(value, model) {
    if (!hasFeatureIdentity(value)) {
        return false;
    }
    const width = value.featureNames.length * value.window;
    return boundedForecastCount(value.window)
        && boundedForecastCount(value.horizon)
        && value.observationOrder === "oldest-first"
        && value.flattenOrder === "observations-then-features"
        && width <= MAX_FORECAST_INPUT_WIDTH
        && hasForecastTensor(model, width);
}

function hasInferenceContracts(value) {
    return (!declared(value, "tensorContract") || isTensorContract(value.tensorContract))
        && (!declared(value, "outputContract") || isOutputContract(value.outputContract))
        && (!declared(value, "featureContract")
            || isFeatureContract(value.featureContract, value));
}

module.exports = {
    FEATURE_CONTRACT_PROPERTIES,
    OUTPUT_CONTRACT_PROPERTIES,
    PREPROCESS_PROPERTIES,
    RESIZE_PROPERTIES,
    TENSOR_CONTRACT_PROPERTIES,
    TENSOR_INPUT_PROPERTIES,
    hasInferenceContracts,
    isFeatureContract,
    isOutputContract,
    isPreprocess,
    isResize,
    isTensorContract,
    isTensorInput,
};
