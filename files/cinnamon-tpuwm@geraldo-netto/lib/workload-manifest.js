"use strict";

const MANIFEST_VERSION = 1;
const RUNTIME_API_VERSION = 1;
const MIN_WEIGHT = 1;
const MAX_WEIGHT = 5;
const IDENTIFIER = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const SEMANTIC_VERSION = /^(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)$/u;
const COMPARATORS = new Set(["at-least", "at-most", "equal"]);
const ROOT_PROPERTIES = new Set([
    "manifestVersion", "id", "version", "capabilities", "requirements", "ui",
    "defaults", "pipeline", "acceptance",
]);
const REQUIRED_REQUIREMENT_PROPERTIES = Object.freeze(["runtimeApi", "accelerator", "minimumDevices", "model"]);
const REQUIREMENT_PROPERTIES = new Set([...REQUIRED_REQUIREMENT_PROPERTIES, "acceleratorPreference"]);
const ACCELERATORS = new Set(["tpu", "npu", "gpu"]);
const MODEL_FORMATS = new Set(["tflite-edgetpu", "tflite", "onnx", "openvino", "ncnn"]);
const MODEL_PROPERTIES = new Set([
    "id", "version", "format", "fullyQuantized", "minimumCompilerVersion",
    "minimumRuntimeVersion",
]);
const UI_PROPERTIES = new Set(["title", "group", "description", "icon", "order"]);
const DEFAULT_PROPERTIES = new Set(["enabled", "weight"]);
const PIPELINE_PROPERTIES = new Set(["hostResponsibilities"]);
const ACCEPTANCE_PROPERTIES = new Set([
    "metric", "comparator", "target", "unit", "description",
]);

function isRecord(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value);
}

function exactProperties(value, expected) {
    return isRecord(value)
        && expected.size === Object.keys(value).length
        && Object.keys(value).every((name) => expected.has(name));
}

function codePointLength(value) {
    return typeof value === "string" ? [...value].length : -1;
}

function boundedText(value, minimum, maximum) {
    const length = codePointLength(value);
    return length >= minimum && length <= maximum;
}

function identifier(value, maximum = 80) {
    return boundedText(value, 1, maximum) && IDENTIFIER.test(value);
}

function semanticVersion(value) {
    return boundedText(value, 1, 32) && SEMANTIC_VERSION.test(value);
}

function uniqueBoundedTextList(value, maximumItems, maximumLength, predicate = null) {
    return Array.isArray(value)
        && value.length <= maximumItems
        && new Set(value).size === value.length
        && value.every((item) => boundedText(item, 1, maximumLength)
            && (predicate === null || predicate(item)));
}

// The Edge TPU executes only fully quantized, edgetpu-compiled TFLite models,
// so a tpu-designed workload may not declare any other model format.
function isModelFormat(value, accelerator) {
    if (accelerator === "tpu") {
        return value.format === "tflite-edgetpu" && value.fullyQuantized === true;
    }
    return MODEL_FORMATS.has(value.format) && typeof value.fullyQuantized === "boolean";
}

function isModel(value, accelerator) {
    if (value === null) {
        return true;
    }
    return exactProperties(value, MODEL_PROPERTIES)
        && identifier(value.id, 120)
        && semanticVersion(value.version)
        && isModelFormat(value, accelerator)
        && boundedText(value.minimumCompilerVersion, 1, 80)
        && boundedText(value.minimumRuntimeVersion, 1, 80);
}

function hasRequirementProperties(value) {
    return isRecord(value)
        && REQUIRED_REQUIREMENT_PROPERTIES.every((name) => Object.hasOwn(value, name))
        && Object.keys(value).every((name) => REQUIREMENT_PROPERTIES.has(name));
}

function isAcceleratorPreference(value) {
    return uniqueBoundedTextList(value, ACCELERATORS.size, 8, (item) => ACCELERATORS.has(item))
        && value.length >= 1;
}

function hasBoundedMinimumDevices(value) {
    return Number.isInteger(value.minimumDevices)
        && value.minimumDevices >= 0
        && value.minimumDevices <= 16;
}

function isRequirements(value) {
    return hasRequirementProperties(value)
        && value.runtimeApi === RUNTIME_API_VERSION
        && ACCELERATORS.has(value.accelerator)
        && (!Object.hasOwn(value, "acceleratorPreference") || isAcceleratorPreference(value.acceleratorPreference))
        && hasBoundedMinimumDevices(value)
        && isModel(value.model, value.accelerator);
}

function hasUiText(value) {
    return boundedText(value.title, 1, 120)
        && boundedText(value.group, 1, 120)
        && boundedText(value.description, 1, 240);
}

function hasUiIdentity(value) {
    return boundedText(value.icon, 10, 120)
        && IDENTIFIER.test(value.icon.slice(0, -9))
        && value.icon.endsWith("-symbolic");
}

function hasUiOrder(value) {
    return Number.isInteger(value.order)
        && value.order >= 0
        && value.order <= 1000;
}

function isUi(value) {
    return exactProperties(value, UI_PROPERTIES)
        && hasUiText(value)
        && hasUiIdentity(value)
        && hasUiOrder(value);
}

function isDefaults(value) {
    return exactProperties(value, DEFAULT_PROPERTIES)
        && typeof value.enabled === "boolean"
        && Number.isInteger(value.weight)
        && value.weight >= MIN_WEIGHT
        && value.weight <= MAX_WEIGHT;
}

function isPipeline(value) {
    return exactProperties(value, PIPELINE_PROPERTIES)
        && uniqueBoundedTextList(value.hostResponsibilities, 32, 160);
}

function isAcceptanceCriterion(value) {
    return exactProperties(value, ACCEPTANCE_PROPERTIES)
        && identifier(value.metric)
        && COMPARATORS.has(value.comparator)
        && typeof value.target === "number"
        && Number.isFinite(value.target)
        && boundedText(value.unit, 1, 40)
        && boundedText(value.description, 1, 240);
}

function isAcceptance(value) {
    return Array.isArray(value)
        && value.length <= 32
        && value.every(isAcceptanceCriterion);
}

function hasManifestIdentity(value) {
    return value.manifestVersion === MANIFEST_VERSION
        && identifier(value.id)
        && semanticVersion(value.version)
        && uniqueBoundedTextList(value.capabilities, 32, 80, (item) => IDENTIFIER.test(item))
        && value.capabilities.length >= 1;
}

function hasManifestDetails(value) {
    return isRequirements(value.requirements)
        && isUi(value.ui)
        && isDefaults(value.defaults)
        && isPipeline(value.pipeline)
        && isAcceptance(value.acceptance);
}

function isWorkloadManifest(value) {
    return exactProperties(value, ROOT_PROPERTIES)
        && hasManifestIdentity(value)
        && hasManifestDetails(value);
}

function cloneManifest(manifest) {
    return {
        ...manifest,
        capabilities: [...manifest.capabilities],
        requirements: {
            ...manifest.requirements,
            ...(Object.hasOwn(manifest.requirements, "acceleratorPreference")
                ? {acceleratorPreference: [...manifest.requirements.acceleratorPreference]}
                : {}),
            model: manifest.requirements.model === null ? null : {...manifest.requirements.model},
        },
        ui: {...manifest.ui},
        defaults: {...manifest.defaults},
        pipeline: {hostResponsibilities: [...manifest.pipeline.hostResponsibilities]},
        acceptance: manifest.acceptance.map((criterion) => ({...criterion})),
    };
}

function freezeManifest(manifest) {
    Object.freeze(manifest.capabilities);
    if (manifest.requirements.model !== null) {
        Object.freeze(manifest.requirements.model);
    }
    if (Object.hasOwn(manifest.requirements, "acceleratorPreference")) {
        Object.freeze(manifest.requirements.acceleratorPreference);
    }
    Object.freeze(manifest.requirements);
    Object.freeze(manifest.ui);
    Object.freeze(manifest.defaults);
    Object.freeze(manifest.pipeline.hostResponsibilities);
    Object.freeze(manifest.pipeline);
    for (const criterion of manifest.acceptance) {
        Object.freeze(criterion);
    }
    Object.freeze(manifest.acceptance);
    return Object.freeze(manifest);
}

class WorkloadDescriptor {
    constructor(manifest) {
        if (!isWorkloadManifest(manifest)) {
            throw new TypeError("Workload manifest does not match version 1 contract");
        }
        this._manifest = freezeManifest(cloneManifest(manifest));
    }

    get id() {
        return this._manifest.id;
    }

    get version() {
        return this._manifest.version;
    }

    manifest() {
        return this._manifest;
    }

    profileDefinition() {
        return Object.freeze({
            id: this._manifest.id,
            title: this._manifest.ui.title,
            group: this._manifest.ui.group,
            description: this._manifest.ui.description,
            icon: this._manifest.ui.icon,
            order: this._manifest.ui.order,
            defaultEnabled: this._manifest.defaults.enabled,
            defaultWeight: this._manifest.defaults.weight,
        });
    }
}

module.exports = {
    ACCELERATORS,
    MANIFEST_VERSION,
    MODEL_FORMATS,
    MAX_WEIGHT,
    MIN_WEIGHT,
    RUNTIME_API_VERSION,
    WorkloadDescriptor,
    boundedText,
    cloneManifest,
    codePointLength,
    exactProperties,
    freezeManifest,
    hasManifestDetails,
    hasManifestIdentity,
    hasUiIdentity,
    hasUiOrder,
    hasUiText,
    identifier,
    isAcceleratorPreference,
    isAcceptance,
    isAcceptanceCriterion,
    isDefaults,
    isModel,
    isPipeline,
    isRecord,
    isRequirements,
    isUi,
    isWorkloadManifest,
    semanticVersion,
    uniqueBoundedTextList,
};
