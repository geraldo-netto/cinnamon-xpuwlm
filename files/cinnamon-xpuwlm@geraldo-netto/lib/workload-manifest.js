"use strict";

// Version 2 adds the `plugin` subtree and nothing else: the subtree is what
// the version means, so a version 1 manifest may not carry one and a version 2
// manifest must. The runtime rewrites manifests to version 2, so an applet
// that only knows version 1 rejects catalogs the runtime considers valid.
const Validation = require("./validation.js");
const Provenance = require("./workload-provenance.js");
const TensorContract = require("./workload-tensor-contract.js");

const {isModelDigest, isNativeEvidence, isTrainingContract} = Provenance;
const {isFeatureContract} = TensorContract;

const MANIFEST_VERSION = 1;
const PLUGIN_MANIFEST_VERSION = 2;
const MANIFEST_VERSIONS = new Set([MANIFEST_VERSION, PLUGIN_MANIFEST_VERSION]);
const RUNTIME_API_VERSION = 1;
const MIN_WEIGHT = 1;
const MAX_WEIGHT = 5;
const IDENTIFIER = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const SEMANTIC_VERSION = /^(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)$/u;
const COMPARATORS = new Set(["at-least", "at-most", "equal"]);
const REQUIRED_ROOT_PROPERTIES = Object.freeze([
    "manifestVersion", "id", "version", "capabilities", "requirements", "ui",
    "defaults", "pipeline", "acceptance",
]);
const ROOT_PROPERTIES = new Set([...REQUIRED_ROOT_PROPERTIES, "plugin"]);
const PLUGIN_REQUIRED = Object.freeze([
    "entryPoint", "protocol", "schemas", "triggers", "artifacts", "permissions",
]);
const PLUGIN_PROPERTIES = new Set(PLUGIN_REQUIRED);
const PROTOCOL_REQUIRED = Object.freeze(["minimum", "maximum"]);
const PROTOCOL_PROPERTIES = new Set([...PROTOCOL_REQUIRED, "capabilities"]);
const PLUGIN_SCHEMA_PROPERTIES = new Set(["configuration", "input", "output"]);
const PLUGIN_TRIGGERS = new Set(["manual", "periodic", "event"]);
const ARTIFACT_REQUIRED = Object.freeze(["id", "version", "format", "sha256"]);
const ARTIFACT_PROPERTIES = new Set([...ARTIFACT_REQUIRED, "companions"]);
// Deliberately laxer than IDENTIFIER: the runtime's protocol capability names
// permit trailing and repeated hyphens, and a mirror that is stricter than the
// contract rejects documents the runtime accepts.
const PROTOCOL_CAPABILITY = /^[a-z][a-z0-9-]*$/u;
const PERMISSION_NAME = /^[a-z][a-z0-9-]*:[a-zA-Z0-9*._/-]+$/u;
const MAX_PROTOCOL_VERSION = 65535;
const MAX_SCHEMA_PROPERTIES = 64;
// `model` is no longer required on its own: a profile that can serve more than
// one accelerator declares `models`, one per lane, because an artifact is
// format-specific and a single entry can only ever name one format.
const REQUIRED_REQUIREMENT_PROPERTIES = Object.freeze(["runtimeApi", "accelerator", "minimumDevices"]);
const REQUIREMENT_PROPERTIES = new Set([
    ...REQUIRED_REQUIREMENT_PROPERTIES, "acceleratorPreference", "model", "models",
]);
const MAX_MODELS = 5;
const ACCELERATORS = new Set(["tpu", "npu", "gpu"]);
const MODEL_FORMATS = new Set(["tflite-edgetpu", "tflite", "onnx", "openvino", "ncnn"]);
const PLUGIN_ARTIFACT_FORMATS = new Set([...MODEL_FORMATS, "gguf"]);
const MODEL_REQUIRED = Object.freeze([
    "id", "version", "format", "fullyQuantized", "minimumCompilerVersion",
    "minimumRuntimeVersion",
]);
// `sha256` pins the exact artifact a profile may run. It is optional: manifests
// written before the runtime verified the digest have none, and the runtime
// then falls back to the digest recorded at install time.
// `tensorContract` states what the model expects of its input. Optional for
// the same reason `sha256` is: manifests written before the field exist, and
// absent means the runtime checks nothing, exactly as it did.
const MODEL_PROPERTIES = new Set([
    ...MODEL_REQUIRED, "sha256", "companions", "tensorContract", "featureContract",
    "trainingContract", "nativeEvidence", "outputContract",
]);
// Digests for the files that travel with the primary one. Optional in the
// contract and load-bearing at dispatch: a format that keeps its weights in a
// companion has vouched for half its model without them.
const COMPANION_FILENAME = /^[a-z0-9][a-z0-9._-]{0,63}$/u;
const MAX_COMPANIONS = 8;
const MODEL_DIGEST = Validation.DIGEST;
const UI_PROPERTIES = new Set(["title", "group", "description", "icon", "order"]);
const DEFAULT_PROPERTIES = new Set(["enabled", "weight"]);
const PIPELINE_PROPERTIES = new Set(["hostResponsibilities"]);
const ACCEPTANCE_PROPERTIES = new Set([
    "metric", "comparator", "target", "unit", "description",
]);

const isRecord = Validation.isRecord;
const exactProperties = Validation.exactKeys;

// An exact key count is wrong wherever the contract has optional properties:
// every required name must be present, and no name outside the allowed set.
function boundedProperties(value, required, allowed) {
    return isRecord(value)
        && required.every((name) => Object.hasOwn(value, name))
        && Object.keys(value).every((name) => allowed.has(name));
}

function codePointLength(value) {
    return typeof value === "string" ? [...value].length : -1;
}

function boundedText(value, minimum, maximum) {
    return Validation.boundedText(value, minimum, maximum);
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

function isCompanions(value) {
    if (!isRecord(value)) {
        return false;
    }
    const names = Object.keys(value);
    return names.length <= MAX_COMPANIONS
        && names.every((name) => COMPANION_FILENAME.test(name))
        && names.every((name) => boundedText(value[name], 64, 64) && MODEL_DIGEST.test(value[name]));
}

function isModelArtifact(value) {
    return boundedText(value.minimumCompilerVersion, 1, 80)
        && boundedText(value.minimumRuntimeVersion, 1, 80)
        && (!declared(value, "sha256")
            || (boundedText(value.sha256, 64, 64) && MODEL_DIGEST.test(value.sha256)))
        && (!declared(value, "companions") || isCompanions(value.companions));
}

// Optional model contracts stay together so `isModel` has one validation path.
function hasModelContracts(value) {
    return TensorContract.hasInferenceContracts(value)
        && Provenance.hasProvenanceContracts(value);
}

function isModel(value, accelerator) {
    if (value === null) {
        return true;
    }
    return boundedProperties(value, MODEL_REQUIRED, MODEL_PROPERTIES)
        && identifier(value.id, 120)
        && semanticVersion(value.version)
        && isModelFormat(value, accelerator)
        && isModelArtifact(value)
        && hasModelContracts(value);
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

// Every entry describes the same network in a different format, so two entries
// for one format leave the runtime choosing with no rule, and entries that
// disagree about their contracts are two networks sharing a profile.
function isModelSet(value, accelerator) {
    if (!Array.isArray(value) || value.length < 1 || value.length > MAX_MODELS) {
        return false;
    }
    if (!value.every((model) => isModel(model, accelerator))) {
        return false;
    }
    const formats = value.map((model) => model.format);
    return new Set(formats).size === formats.length && agreeOnContracts(value);
}

// Compared by value, not by spelling. The service decides this with
// `json.dumps(sort_keys=True)`, so comparing raw JSON.stringify output made
// this mirror stricter than the contract: two entries stating the same
// contract in a different property order would be refused here and accepted
// there, and a mirror that rejects what the runtime loads is the one failure
// mode a mirror must not have.
function canonical(value) {
    if (Array.isArray(value)) {
        return value.map(canonical);
    }
    if (!isRecord(value)) {
        return value;
    }
    const ordered = {};
    for (const key of Object.keys(value).sort()) {
        ordered[key] = canonical(value[key]);
    }
    return ordered;
}

function agreeOnContracts(models) {
    // Native evidence is deliberately lane-specific: it records each target's
    // compiler output. Training identity must match because all lanes still
    // describe one network and one task.
    return ["featureContract", "trainingContract", "tensorContract", "outputContract"].every((field) => {
        const stated = new Set(models.map((model) => JSON.stringify(canonical(model[field] ?? null))));
        return stated.size === 1;
    });
}

// Exactly one spelling per manifest: two ways to say which model a profile runs
// is two sources of truth with no rule for which wins.
function hasOneModelDeclaration(value) {
    const single = declared(value, "model");
    const several = declared(value, "models");
    if (single && several) {
        return value.model === null;
    }
    return single || several;
}

function isRequirements(value) {
    return hasRequirementProperties(value)
        && value.runtimeApi === RUNTIME_API_VERSION
        && ACCELERATORS.has(value.accelerator)
        && (!declared(value, "acceleratorPreference") || isAcceleratorPreference(value.acceleratorPreference))
        && hasBoundedMinimumDevices(value)
        && hasOneModelDeclaration(value)
        && declaresValidModels(value);
}

function declaresValidModels(value) {
    return declared(value, "models")
        ? isModelSet(value.models, value.accelerator)
        : isModel(value.model, value.accelerator);
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

// JSON Schema treats a property whose value is `undefined` as absent, so an
// optional-property mirror has to agree or it rejects documents the contract
// accepts.
function declared(value, name) {
    return Object.hasOwn(value, name) && value[name] !== undefined;
}

// Ajv compares array members structurally; a mirror that compared references
// would accept duplicate records the contract forbids.
function canonicalJson(value) {
    if (Array.isArray(value)) {
        return `[${value.map(canonicalJson).join(",")}]`;
    }
    if (isRecord(value)) {
        return `{${Object.keys(value).sort()
            .map((name) => `${JSON.stringify(name)}:${canonicalJson(value[name])}`)
            .join(",")}}`;
    }
    return JSON.stringify(value) ?? "null";
}

function uniqueItems(values) {
    return new Set(values.map(canonicalJson)).size === values.length;
}

function isProtocolRange(value) {
    return boundedProperties(value, PROTOCOL_REQUIRED, PROTOCOL_PROPERTIES)
        && isProtocolVersion(value.minimum)
        && isProtocolVersion(value.maximum)
        && (!declared(value, "capabilities")
            || uniqueBoundedTextList(value.capabilities, 32, 64, (item) => PROTOCOL_CAPABILITY.test(item)));
}

function isProtocolVersion(value) {
    return Number.isInteger(value) && value >= 1 && value <= MAX_PROTOCOL_VERSION;
}

function isBoundedSchemaRecord(value) {
    return isRecord(value) && Object.keys(value).length <= MAX_SCHEMA_PROPERTIES;
}

function isPluginSchemas(value) {
    return exactProperties(value, PLUGIN_SCHEMA_PROPERTIES)
        && isBoundedSchemaRecord(value.configuration)
        && isBoundedSchemaRecord(value.input)
        && isBoundedSchemaRecord(value.output);
}

function isPluginTriggers(value) {
    return Array.isArray(value)
        && value.length >= 1
        && value.length <= 8
        && uniqueItems(value)
        && value.every((item) => PLUGIN_TRIGGERS.has(item));
}

function isPluginArtifact(value) {
    return boundedProperties(value, ARTIFACT_REQUIRED, ARTIFACT_PROPERTIES)
        && identifier(value.id, 120)
        && semanticVersion(value.version)
        && PLUGIN_ARTIFACT_FORMATS.has(value.format)
        && boundedText(value.sha256, 64, 64)
        && MODEL_DIGEST.test(value.sha256)
        && (!declared(value, "companions") || isCompanions(value.companions));
}

function isPluginArtifacts(value) {
    return Array.isArray(value)
        && value.length <= 16
        && uniqueItems(value)
        && value.every(isPluginArtifact);
}

function isPluginPermissions(value) {
    return uniqueBoundedTextList(value, 32, 160, (item) => (
        [...item].length >= 3 && PERMISSION_NAME.test(item)
    ));
}

function isPlugin(value) {
    return boundedProperties(value, PLUGIN_REQUIRED, PLUGIN_PROPERTIES)
        && identifier(value.entryPoint)
        && isProtocolRange(value.protocol)
        && isPluginSchemas(value.schemas)
        && isPluginTriggers(value.triggers)
        && isPluginArtifacts(value.artifacts)
        && isPluginPermissions(value.permissions);
}

// The subtree is the version discriminator, so its presence and the declared
// version have to agree in both directions.
function hasPluginSubtree(value) {
    const present = declared(value, "plugin");
    return value.manifestVersion === PLUGIN_MANIFEST_VERSION
        ? present && isPlugin(value.plugin)
        : !present;
}

function hasManifestIdentity(value) {
    return MANIFEST_VERSIONS.has(value.manifestVersion)
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
    return boundedProperties(value, REQUIRED_ROOT_PROPERTIES, ROOT_PROPERTIES)
        && hasManifestIdentity(value)
        && hasManifestDetails(value)
        && hasPluginSubtree(value);
}

function clonePlugin(plugin) {
    return {
        ...plugin,
        protocol: {
            ...plugin.protocol,
            ...(declared(plugin.protocol, "capabilities")
                ? {capabilities: [...plugin.protocol.capabilities]}
                : {}),
        },
        schemas: {
            configuration: structuredCloneRecord(plugin.schemas.configuration),
            input: structuredCloneRecord(plugin.schemas.input),
            output: structuredCloneRecord(plugin.schemas.output),
        },
        triggers: [...plugin.triggers],
        artifacts: plugin.artifacts.map((artifact) => ({...artifact})),
        permissions: [...plugin.permissions],
    };
}

// The plug-in schemas are opaque JSON the applet only carries; a structural
// copy keeps a caller from reaching back into the descriptor through them.
function structuredCloneRecord(value) {
    return JSON.parse(JSON.stringify(value));
}

function freezePlugin(plugin) {
    if (declared(plugin.protocol, "capabilities")) {
        Object.freeze(plugin.protocol.capabilities);
    }
    Object.freeze(plugin.protocol);
    Object.freeze(plugin.schemas);
    Object.freeze(plugin.triggers);
    for (const artifact of plugin.artifacts) {
        Object.freeze(artifact);
    }
    Object.freeze(plugin.artifacts);
    Object.freeze(plugin.permissions);
    return Object.freeze(plugin);
}

// The model subtree is cloned and frozen all the way down, not one level: it
// now carries `tensorContract`, which a descriptor hands out, and a shallow
// copy would hand out a live reference into the caller's own manifest.
function freezeDeep(value) {
    if (value === null || typeof value !== "object") {
        return value;
    }
    for (const item of Object.values(value)) {
        freezeDeep(item);
    }
    return Object.freeze(value);
}

function cloneManifest(manifest) {
    return {
        ...manifest,
        ...(declared(manifest, "plugin") ? {plugin: clonePlugin(manifest.plugin)} : {}),
        capabilities: [...manifest.capabilities],
        requirements: {
            ...manifest.requirements,
            ...(declared(manifest.requirements, "acceleratorPreference")
                ? {acceleratorPreference: [...manifest.requirements.acceleratorPreference]}
                : {}),
            ...(declared(manifest.requirements, "model")
                ? {model: manifest.requirements.model === null
                    ? null
                    : structuredCloneRecord(manifest.requirements.model)}
                : {}),
            ...(declared(manifest.requirements, "models")
                ? {models: manifest.requirements.models.map(structuredCloneRecord)}
                : {}),
        },
        ui: {...manifest.ui},
        defaults: {...manifest.defaults},
        pipeline: {hostResponsibilities: [...manifest.pipeline.hostResponsibilities]},
        acceptance: manifest.acceptance.map((criterion) => ({...criterion})),
    };
}

function freezeManifest(manifest) {
    Object.freeze(manifest.capabilities);
    if (declared(manifest, "plugin")) {
        freezePlugin(manifest.plugin);
    }
    for (const model of declaredModels(manifest.requirements)) {
        freezeDeep(model);
    }
    if (declared(manifest.requirements, "models")) {
        Object.freeze(manifest.requirements.models);
    }
    if (declared(manifest.requirements, "acceleratorPreference")) {
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
            throw new TypeError("Workload manifest does not match the version 1 or 2 contract");
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

    // A workload that declares no model has no inference stage, so the runtime
    // refuses to build a pipeline for it (`profile-has-no-model`). That is a
    // fact the manifest already states, and the popup has to state it too
    // rather than offering the same controls for a profile that can never run.
    get executable() {
        return declaredModels(this._manifest.requirements).length > 0;
    }

    // What this profile expects of its first input, or null when it declares
    // nothing. Read from the manifest rather than projected into the catalog:
    // the catalog describes what to render and what the user may change, and
    // this describes how to build a tensor — two different questions with two
    // different consumers.
    inputContract() {
        const [model] = declaredModels(this._manifest.requirements);
        const contract = model === undefined ? null : model.tensorContract;
        if (!isRecord(contract) || !Array.isArray(contract.inputs)) {
            return null;
        }
        return contract.inputs[0];
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
            executable: this.executable,
        });
    }
}

function declaredModels(requirements) {
    if (declared(requirements, "models")) {
        return requirements.models;
    }
    return declared(requirements, "model") && requirements.model !== null
        ? [requirements.model]
        : [];
}

const MANIFEST_ALLOWLISTS = Object.freeze({
    featureContract: TensorContract.FEATURE_CONTRACT_PROPERTIES,
    model: MODEL_PROPERTIES,
    nativeEvidence: Provenance.NATIVE_EVIDENCE_PROPERTIES,
    outputContract: TensorContract.OUTPUT_CONTRACT_PROPERTIES,
    trainingContract: Provenance.TRAINING_CONTRACT_PROPERTIES,
    tensorContract: TensorContract.TENSOR_CONTRACT_PROPERTIES,
    tensorInput: TensorContract.TENSOR_INPUT_PROPERTIES,
    preprocess: TensorContract.PREPROCESS_PROPERTIES,
    resize: TensorContract.RESIZE_PROPERTIES,
    requirements: REQUIREMENT_PROPERTIES,
    ui: UI_PROPERTIES,
    defaults: DEFAULT_PROPERTIES,
    pipeline: PIPELINE_PROPERTIES,
});

module.exports = {
    ACCELERATORS,
    canonical,
    isModelSet,
    MAX_MODELS,
    hasOneModelDeclaration,
    isCompanions,
    freezeDeep,
    MANIFEST_ALLOWLISTS,
    MANIFEST_VERSION,
    MANIFEST_VERSIONS,
    MODEL_FORMATS,
    MAX_WEIGHT,
    MIN_WEIGHT,
    PLUGIN_MANIFEST_VERSION,
    RUNTIME_API_VERSION,
    WorkloadDescriptor,
    boundedProperties,
    boundedText,
    canonicalJson,
    cloneManifest,
    clonePlugin,
    codePointLength,
    declared,
    declaredModels,
    exactProperties,
    freezeManifest,
    freezePlugin,
    hasManifestDetails,
    hasManifestIdentity,
    hasPluginSubtree,
    hasUiIdentity,
    hasUiOrder,
    hasUiText,
    identifier,
    isAcceleratorPreference,
    isAcceptance,
    isAcceptanceCriterion,
    isBoundedSchemaRecord,
    isDefaults,
    isFeatureContract,
    isModel,
    isModelArtifact,
    isModelDigest,
    isNativeEvidence,
    isPipeline,
    isPlugin,
    isPluginArtifact,
    isPluginArtifacts,
    isPluginPermissions,
    isPluginSchemas,
    isPluginTriggers,
    isProtocolRange,
    isProtocolVersion,
    isRecord,
    isRequirements,
    isTrainingContract,
    isUi,
    isWorkloadManifest,
    semanticVersion,
    uniqueBoundedTextList,
    uniqueItems,
};
