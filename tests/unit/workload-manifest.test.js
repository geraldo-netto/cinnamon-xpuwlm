"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const Ajv2020 = require("ajv/dist/2020").default;
const Contract = require("../../files/cinnamon-xpuwlm@geraldo-netto/lib/workload-manifest.js");
const Fixtures = require("../helpers/workload-manifest-fixtures.js");

const schema = JSON.parse(fs.readFileSync(path.resolve(
    __dirname,
    "../../files/cinnamon-xpuwlm@geraldo-netto/workload-manifest.schema.json",
), "utf8"));
const oracle = new Ajv2020({strict: true}).compile(schema);

function nested(overrides) {
    const value = Fixtures.validWorkloadManifest();
    for (const [section, changes] of Object.entries(overrides)) {
        value[section] = {...value[section], ...changes};
    }
    return value;
}

test("version 1 workload manifest matches authoritative schema boundaries", () => {
    const valid = Fixtures.validWorkloadManifest();
    const cases = [
        ["valid", valid, true],
        ["not object", null, false],
        ["unknown root", {...valid, unknown: true}, false],
        ["missing root", (({id: _id, ...rest}) => rest)(valid), false],
        ["version 2 without the plug-in subtree", {...valid, manifestVersion: 2}, false],
        ["version 3", {...valid, manifestVersion: 3}, false],
        ["identifier", {...valid, id: "Bad ID"}, false],
        ["identifier length", {...valid, id: "a".repeat(81)}, false],
        ["version", {...valid, version: "01.0.0"}, false],
        ["capability empty", {...valid, capabilities: []}, false],
        ["capability duplicate", {...valid, capabilities: ["classify", "classify"]}, false],
        ["capability invalid", {...valid, capabilities: ["Bad"]}, false],
        ["runtime api", nested({requirements: {runtimeApi: 2}}), false],
        ["accelerator legacy edge-tpu", nested({requirements: {accelerator: "edge-tpu"}}), false],
        ["accelerator cpu rejected", nested({requirements: {accelerator: "cpu"}}), false],
        ["accelerator gpu", nested({requirements: {accelerator: "gpu"}}), true],
        ["preference optional", (({requirements, ...rest}) => ({
            ...rest,
            requirements: (({acceleratorPreference: _p, ...kept}) => kept)(requirements),
        }))(valid), true],
        ["preference reordered", nested({requirements: {acceleratorPreference: ["gpu", "tpu"]}}), true],
        ["preference empty", nested({requirements: {acceleratorPreference: []}}), false],
        ["preference duplicate", nested({requirements: {acceleratorPreference: ["tpu", "tpu"]}}), false],
        ["preference unknown item", nested({requirements: {acceleratorPreference: ["tpu", "cpu"]}}), false],
        ["preference non-array", nested({requirements: {acceleratorPreference: "tpu"}}), false],
        ["device count", nested({requirements: {minimumDevices: 17}}), false],
        ["no model", nested({requirements: {model: null}}), true],
        ["model id", nested({requirements: {model: {...valid.requirements.model, id: "Bad"}}}), false],
        ["model version", nested({requirements: {model: {...valid.requirements.model, version: "1"}}}), false],
        ["tpu rejects plain tflite", nested({requirements: {model: {...valid.requirements.model, format: "tflite"}}}), false],
        ["tpu rejects onnx", nested({requirements: {model: {...valid.requirements.model, format: "onnx"}}}), false],
        ["model format unknown", nested({requirements: {accelerator: "gpu", model: {...valid.requirements.model, format: "coreml"}}}), false],
        ["gpu accepts onnx float", nested({requirements: {
            accelerator: "gpu",
            model: {...valid.requirements.model, format: "onnx", fullyQuantized: false},
        }}), true],
        ["npu accepts openvino", nested({requirements: {
            accelerator: "npu",
            model: {...valid.requirements.model, format: "openvino"},
        }}), true],
        ["gpu accepts ncnn", nested({requirements: {
            accelerator: "gpu",
            model: {...valid.requirements.model, format: "ncnn", fullyQuantized: false},
        }}), true],
        ["tpu rejects ncnn", nested({requirements: {model: {...valid.requirements.model, format: "ncnn"}}}), false],
        ["model quantization", nested({requirements: {model: {...valid.requirements.model, fullyQuantized: false}}}), false],
        ["model compiler", nested({requirements: {model: {...valid.requirements.model, minimumCompilerVersion: ""}}}), false],
        ["model runtime", nested({requirements: {model: {...valid.requirements.model, minimumRuntimeVersion: ""}}}), false],
        ["title", nested({ui: {title: ""}}), false],
        ["group", nested({ui: {group: ""}}), false],
        ["description", nested({ui: {description: ""}}), false],
        ["icon", nested({ui: {icon: "image.png"}}), false],
        ["order", nested({ui: {order: 1001}}), false],
        ["enabled", nested({defaults: {enabled: "yes"}}), false],
        ["weight", nested({defaults: {weight: 6}}), false],
        ["pipeline duplicate", nested({pipeline: {hostResponsibilities: ["Decode", "Decode"]}}), false],
        ["pipeline length", nested({pipeline: {hostResponsibilities: ["x".repeat(161)]}}), false],
        ["acceptance type", {...valid, acceptance: {}}, false],
        ["acceptance metric", {...valid, acceptance: [{...valid.acceptance[0], metric: "Bad"}]}, false],
        ["acceptance comparator", {...valid, acceptance: [{...valid.acceptance[0], comparator: "around"}]}, false],
        ["acceptance target", {...valid, acceptance: [{...valid.acceptance[0], target: null}]}, false],
        ["acceptance unit", {...valid, acceptance: [{...valid.acceptance[0], unit: ""}]}, false],
        ["acceptance description", {...valid, acceptance: [{...valid.acceptance[0], description: ""}]}, false],
    ];

    for (const [name, value, expected] of cases) {
        assert.equal(Contract.isWorkloadManifest(value), expected, name);
        assert.equal(Boolean(oracle(value)), expected, `${name}: schema`);
    }
});

function pluginCase(overrides) {
    const value = Fixtures.validPluginWorkloadManifest();
    value.plugin = {...value.plugin, ...overrides};
    return value;
}

test("version 2 workload manifest matches authoritative schema boundaries", () => {
    const valid = Fixtures.validPluginWorkloadManifest();
    const subtree = valid.plugin;
    const cases = [
        ["valid", valid, true],
        ["version 1 may not carry the subtree", {...valid, manifestVersion: 1}, false],
        ["unknown plug-in key", pluginCase({unexpected: true}), false],
        ["missing plug-in key", pluginCase({permissions: undefined}), false],
        ["entry point identifier", pluginCase({entryPoint: "Bad Entry"}), false],
        ["protocol optional capabilities", pluginCase({protocol: {minimum: 1, maximum: 2}}), true],
        ["protocol capability trailing hyphen", pluginCase({protocol: {...subtree.protocol, capabilities: ["stream-"]}}), true],
        ["protocol capability leading digit", pluginCase({protocol: {...subtree.protocol, capabilities: ["1stream"]}}), false],
        ["protocol capability duplicate", pluginCase({protocol: {...subtree.protocol, capabilities: ["a", "a"]}}), false],
        ["protocol lower bound", pluginCase({protocol: {minimum: 0, maximum: 2}}), false],
        ["protocol upper bound", pluginCase({protocol: {minimum: 1, maximum: 65536}}), false],
        ["protocol fractional", pluginCase({protocol: {minimum: 1.5, maximum: 2}}), false],
        ["protocol missing maximum", pluginCase({protocol: {minimum: 1}}), false],
        ["schemas incomplete", pluginCase({schemas: {configuration: {}, input: {}}}), false],
        ["schemas carry opaque JSON", pluginCase({schemas: {configuration: {type: "object"}, input: {}, output: {}}}), true],
        ["schemas non-object member", pluginCase({schemas: {configuration: [], input: {}, output: {}}}), false],
        ["triggers empty", pluginCase({triggers: []}), false],
        ["triggers unknown", pluginCase({triggers: ["startup"]}), false],
        ["triggers duplicate", pluginCase({triggers: ["manual", "manual"]}), false],
        ["artifacts empty", pluginCase({artifacts: []}), true],
        ["artifact digest", pluginCase({artifacts: [{...subtree.artifacts[0], sha256: "z".repeat(64)}]}), false],
        ["artifact digest length", pluginCase({artifacts: [{...subtree.artifacts[0], sha256: "a".repeat(63)}]}), false],
        ["artifact format", pluginCase({artifacts: [{...subtree.artifacts[0], format: "coreml"}]}), false],
        ["artifact version", pluginCase({artifacts: [{...subtree.artifacts[0], version: "1"}]}), false],
        ["artifact unknown key", pluginCase({artifacts: [{...subtree.artifacts[0], extra: 1}]}), false],
        ["artifact duplicate", pluginCase({artifacts: [subtree.artifacts[0], {...subtree.artifacts[0]}]}), false],
        ["permission shape", pluginCase({permissions: ["fsread"]}), false],
        ["permission duplicate", pluginCase({permissions: ["fs:read/a", "fs:read/a"]}), false],
        ["permissions empty", pluginCase({permissions: []}), true],
    ];

    for (const [name, value, expected] of cases) {
        if (value.plugin.permissions === undefined) {
            delete value.plugin.permissions;
        }
        assert.equal(Contract.isWorkloadManifest(value), expected, name);
        assert.equal(Boolean(oracle(value)), expected, `${name}: schema`);
    }
});

test("plug-in artifacts accept GGUF and authenticated companion files", () => {
    const digest = "b".repeat(64);
    const artifact = {
        id: "qwen3-0-6b-q8-0",
        version: "1.0.0",
        format: "gguf",
        sha256: "a".repeat(64),
    };
    const cases = [
        ["GGUF", artifact, true],
        ["empty companions", {...artifact, companions: {}}, true],
        ["authenticated companions", {
            ...artifact,
            companions: {"model.bin": digest, "tokenizer.json": digest},
        }, true],
        ["undefined companions", {...artifact, companions: undefined}, true],
        ["unknown format", {...artifact, format: "safetensors"}, false],
        ["missing digest", (({sha256: _digest, ...kept}) => kept)(artifact), false],
        ["untrusted companion path", {...artifact, companions: {"../model.bin": digest}}, false],
        ["invalid companion digest", {...artifact, companions: {"model.bin": "b".repeat(63)}}, false],
        ["unknown property", {...artifact, path: "/tmp/model.gguf"}, false],
    ];

    for (const [name, candidate, expected] of cases) {
        const manifest = Fixtures.validPluginWorkloadManifest();
        manifest.plugin.artifacts = [candidate];
        assert.equal(Contract.isPluginArtifact(candidate), expected, name);
        assert.equal(Contract.isWorkloadManifest(manifest), expected, `${name}: manifest`);
        assert.equal(Boolean(oracle(manifest)), expected, `${name}: schema`);
    }
});

test("a version 2 descriptor carries an immutable, independent plug-in subtree", () => {
    const source = Fixtures.validPluginWorkloadManifest();
    const descriptor = new Contract.WorkloadDescriptor(source);
    source.plugin.triggers.push("event");
    source.plugin.artifacts[0].id = "mutated";
    source.plugin.schemas.input.injected = true;

    const plugin = descriptor.manifest().plugin;
    assert.deepEqual(plugin.triggers, ["manual", "periodic"]);
    assert.equal(plugin.artifacts[0].id, "sample-model");
    assert.deepEqual(plugin.schemas.input, {});
    assert.equal(Object.isFrozen(plugin), true);
    assert.equal(Object.isFrozen(plugin.protocol), true);
    assert.equal(Object.isFrozen(plugin.protocol.capabilities), true);
    assert.equal(Object.isFrozen(plugin.schemas), true);
    assert.equal(Object.isFrozen(plugin.triggers), true);
    assert.equal(Object.isFrozen(plugin.artifacts), true);
    assert.equal(Object.isFrozen(plugin.artifacts[0]), true);
    assert.equal(Object.isFrozen(plugin.permissions), true);
    // The profile projection is version-independent: the popup shows the same
    // fields whichever manifest version declared them.
    assert.equal(descriptor.profileDefinition().id, "sample-workload");

    const withoutCapabilities = Fixtures.validPluginWorkloadManifest();
    delete withoutCapabilities.plugin.protocol.capabilities;
    const frozen = new Contract.WorkloadDescriptor(withoutCapabilities).manifest();
    assert.equal(Object.hasOwn(frozen.plugin.protocol, "capabilities"), false);
    assert.equal(Object.isFrozen(frozen.plugin.protocol), true);
});

test("an optional property explicitly set to undefined counts as absent", () => {
    const cases = [
        ["accelerator preference", (value) => { value.requirements.acceleratorPreference = undefined; }],
        ["model digest", (value) => { value.requirements.model.sha256 = undefined; }],
    ];
    for (const [name, mutate] of cases) {
        const value = Fixtures.validWorkloadManifest();
        mutate(value);
        assert.equal(Contract.isWorkloadManifest(value), true, name);
        assert.equal(Boolean(oracle(value)), true, `${name}: schema`);
        assert.doesNotThrow(() => new Contract.WorkloadDescriptor(value), name);
    }

    const plugin = Fixtures.validPluginWorkloadManifest();
    plugin.plugin.protocol.capabilities = undefined;
    assert.equal(Contract.isWorkloadManifest(plugin), true);
    assert.equal(Boolean(oracle(plugin)), true);
    const frozen = new Contract.WorkloadDescriptor(plugin).manifest();
    assert.equal(frozen.plugin.protocol.capabilities, undefined);

    assert.equal(Contract.declared({a: 1}, "a"), true);
    assert.equal(Contract.declared({a: undefined}, "a"), false);
    assert.equal(Contract.declared({}, "a"), false);
});

test("record uniqueness compares structure, not key order or identity", () => {
    assert.equal(Contract.uniqueItems([{a: 1, b: 2}, {b: 2, a: 1}]), false);
    assert.equal(Contract.uniqueItems([{a: 1}, {a: 2}]), true);
    assert.equal(Contract.uniqueItems([[1, 2], [1, 2]]), false);
    assert.equal(Contract.uniqueItems([]), true);
    assert.equal(Contract.canonicalJson(undefined), "null");
    assert.equal(Contract.canonicalJson([{b: 1, a: 2}]), '[{"a":2,"b":1}]');
});

test("workload descriptor owns immutable contract data and profile projection", () => {
    const source = Fixtures.validWorkloadManifest();
    const descriptor = new Contract.WorkloadDescriptor(source);
    source.ui.title = "Changed";
    source.capabilities.push("mutated");

    assert.equal(descriptor.id, "sample-workload");
    assert.equal(descriptor.version, "1.0.0");
    assert.equal(descriptor.manifest().ui.title, "Sample workload");
    assert.equal(descriptor.manifest().capabilities.includes("mutated"), false);
    assert.equal(Object.isFrozen(descriptor.manifest()), true);
    assert.equal(Object.isFrozen(descriptor.manifest().requirements.model), true);
    assert.equal(Object.isFrozen(descriptor.manifest().pipeline.hostResponsibilities), true);
    assert.equal(Object.isFrozen(descriptor.manifest().acceptance[0]), true);
    assert.deepEqual(descriptor.profileDefinition(), {
        id: "sample-workload",
        title: "Sample workload",
        group: "Examples",
        description: "Classifies bounded sample inputs",
        icon: "applications-science-symbolic",
        order: 10,
        defaultEnabled: false,
        defaultWeight: 2,
        executable: true,
    });
    assert.equal(Object.isFrozen(descriptor.profileDefinition()), true);
    assert.throws(() => new Contract.WorkloadDescriptor({}), /version 1 or 2 contract/u);
});

test("manifest primitives enforce code-point, collection, and numeric contracts", () => {
    const valid = Fixtures.validWorkloadManifest();
    assert.equal(Contract.isRecord({}), true);
    assert.equal(Contract.isRecord([]), false);
    assert.equal(Contract.isRecord(() => {}), false);
    assert.equal(Contract.exactProperties({a: 1}, new Set(["a"])), true);
    assert.equal(Contract.exactProperties({a: 1, b: 2}, new Set(["a"])), false);
    assert.equal(Contract.codePointLength("a💡"), 2);
    assert.equal(Contract.codePointLength(2), -1);
    assert.equal(Contract.boundedText("abc", 1, 3), true);
    assert.equal(Contract.boundedText("", 1, 3), false);
    assert.equal(Contract.identifier("valid-id"), true);
    assert.equal(Contract.identifier("Bad"), false);
    assert.equal(Contract.semanticVersion("0.1.20"), true);
    assert.equal(Contract.semanticVersion("1.0"), false);
    assert.equal(Contract.uniqueBoundedTextList(["a", "b"], 2, 1), true);
    assert.equal(Contract.uniqueBoundedTextList(["a", "a"], 2, 1), false);
    assert.equal(Contract.uniqueBoundedTextList(["a"], 2, 1, () => false), false);
    assert.equal(Contract.isModel(null), true);
    assert.equal(Contract.isAcceptance([]), true);
    assert.equal(Contract.hasUiText(valid.ui), true);
    assert.equal(Contract.hasUiIdentity(valid.ui), true);
    assert.equal(Contract.hasUiOrder(valid.ui), true);
    assert.equal(Contract.hasUiText({...valid.ui, group: ""}), false);
    assert.equal(Contract.hasUiIdentity({...valid.ui, icon: "bad"}), false);
    assert.equal(Contract.hasUiOrder({...valid.ui, order: -1}), false);
    assert.equal(Contract.hasManifestIdentity(valid), true);
    assert.equal(Contract.hasManifestIdentity({...valid, capabilities: []}), false);
    assert.equal(Contract.hasManifestDetails(valid), true);
    assert.equal(Contract.hasManifestDetails({...valid, acceptance: null}), false);
});

test("cloning and freezing support model-free manifests", () => {
    const source = nested({requirements: {model: null}});
    const clone = Contract.cloneManifest(source);
    assert.notEqual(clone, source);
    assert.equal(clone.requirements.model, null);
    assert.notEqual(clone.pipeline.hostResponsibilities, source.pipeline.hostResponsibilities);
    assert.equal(Contract.freezeManifest(clone), clone);
    assert.equal(Object.isFrozen(clone.requirements), true);

    const withoutPreference = nested({requirements: {model: null}});
    delete withoutPreference.requirements.acceleratorPreference;
    assert.doesNotThrow(() => Contract.freezeManifest(Contract.cloneManifest(withoutPreference)));
});

test("a singular model and preference are independently cloned and frozen", () => {
    const source = Fixtures.validWorkloadManifest();
    const expectedModel = JSON.parse(JSON.stringify(source.requirements.model));
    const expectedPreference = [...source.requirements.acceleratorPreference];
    const clone = Contract.cloneManifest(source);

    source.requirements.model.id = "changed-model";
    source.requirements.acceleratorPreference.push("gpu");
    Contract.freezeManifest(clone);

    assert.deepEqual(clone.requirements.model, expectedModel);
    assert.deepEqual(clone.requirements.acceleratorPreference, expectedPreference);
    assert.equal(Object.isFrozen(clone.requirements.model), true);
    assert.equal(Object.isFrozen(clone.requirements.acceleratorPreference), true);
});

// An optional property makes an exact key count the wrong rule: a manifest
// that pins its artifact digest was rejected outright, and one that omits it
// must still load.
test("optional model digests load, and malformed ones are still rejected", () => {
    const withDigest = Fixtures.validWorkloadManifest();
    withDigest.requirements.model.sha256 = "b".repeat(64);
    const descriptor = new Contract.WorkloadDescriptor(withDigest);
    assert.equal(descriptor.manifest().requirements.model.sha256, "b".repeat(64));
    assert.equal(Object.isFrozen(descriptor.manifest().requirements.model), true);

    const without = Fixtures.validWorkloadManifest();
    assert.equal(Contract.isWorkloadManifest(without), true);
    const bare = new Contract.WorkloadDescriptor(without).manifest();
    assert.equal(Object.hasOwn(bare.requirements.model, "sha256"), false);

    for (const value of ["B".repeat(64), "b".repeat(63), "b".repeat(65), "", null, 7]) {
        const invalid = Fixtures.validWorkloadManifest();
        invalid.requirements.model.sha256 = value;
        assert.equal(Contract.isWorkloadManifest(invalid), false, `digest ${JSON.stringify(value)}`);
    }

    assert.equal(Contract.boundedProperties({a: 1}, ["a"], new Set(["a", "b"])), true);
    assert.equal(Contract.boundedProperties({a: 1, b: 2}, ["a"], new Set(["a", "b"])), true);
    assert.equal(Contract.boundedProperties({b: 2}, ["a"], new Set(["a", "b"])), false);
    assert.equal(Contract.boundedProperties({a: 1, c: 3}, ["a"], new Set(["a", "b"])), false);
    assert.equal(Contract.boundedProperties(null, [], new Set()), false);
});

function withModel(extra) {
    // ncnn is a GPU format, and a tpu profile may declare nothing else.
    const manifest = Fixtures.validWorkloadManifest();
    manifest.requirements.accelerator = "gpu";
    manifest.requirements.model = {...manifest.requirements.model, ...extra};
    return manifest;
}

function withFeatureContract(contractChanges = {}, modelChanges = {}) {
    return withModel({
        tensorContract: {
            inputs: [{shape: [1, 9], dtype: "float32", layout: "NC"}],
        },
        featureContract: {
            version: 1,
            recipe: "forecast-v1",
            featureNames: ["load", "queue", "memory"],
            targetFeature: "load",
            window: 3,
            horizon: 1,
            observationOrder: "oldest-first",
            flattenOrder: "observations-then-features",
            ...contractChanges,
        },
        outputContract: {kind: "raw"},
        ...modelChanges,
    });
}

const DIGEST_A = "a".repeat(64);
const DIGEST_B = "b".repeat(64);
const DIGEST_C = "c".repeat(64);

function trainingContract(changes = {}) {
    return {
        version: 1,
        profileId: "storage-intelligence",
        recipe: "backblaze-smart-risk-v1",
        reportSha256: DIGEST_A,
        taskSemanticsSha256: DIGEST_B,
        ...changes,
    };
}

function nativeEvidence(changes = {}) {
    return {
        portableSha256: DIGEST_A,
        nativeSha256: DIGEST_B,
        reportSha256: DIGEST_C,
        samples: 8,
        maximumAbsoluteError: 0.0004,
        tolerance: 0.001,
        compilerReportSha256: null,
        namedDeviceAccepted: false,
        ...changes,
    };
}

function withProvenance(trainingChanges = {}, evidenceChanges = {}) {
    return withModel({
        trainingContract: trainingContract(trainingChanges),
        nativeEvidence: nativeEvidence(evidenceChanges),
    });
}

// Both contracts are optional and both are new, so the interesting cases are
// the ones the validator and the schema could disagree about. Every candidate
// is checked against the Ajv oracle as well, because a mirror that is stricter
// or laxer than the schema rejects documents the runtime accepts, or accepts
// ones it does not.
function agree(manifest, expected, label) {
    assert.equal(oracle(manifest), expected, `${label}: schema`);
    let accepted = true;
    try {
        new Contract.WorkloadDescriptor(manifest);
    } catch {
        accepted = false;
    }
    assert.equal(accepted, expected, `${label}: validator`);
}

test("training provenance is closed, pinned, and schema-equivalent", () => {
    agree(withProvenance(), true, "complete provenance");

    const cases = [
        ["missing version", {version: undefined}],
        ["wrong version", {version: 2}],
        ["unknown field", {unknown: true}],
        ["uppercase profile", {profileId: "Storage"}],
        ["empty profile", {profileId: ""}],
        ["long profile", {profileId: "a".repeat(81)}],
        ["invalid recipe", {recipe: "forecast v1"}],
        ["uppercase report digest", {reportSha256: DIGEST_A.toUpperCase()}],
        ["short report digest", {reportSha256: DIGEST_A.slice(1)}],
        ["bad semantics digest", {taskSemanticsSha256: `${DIGEST_B.slice(1)}g`}],
    ];
    for (const [label, changes] of cases) {
        agree(withProvenance(changes), false, label);
    }
});

test("native evidence proves parity without claiming named-device acceptance", () => {
    agree(withProvenance({}, {compilerReportSha256: DIGEST_C}), true, "compiler report");
    agree(withProvenance(), true, "nullable compiler report");

    const cases = [
        ["missing portable digest", {portableSha256: undefined}],
        ["unknown field", {device: "npu"}],
        ["bad portable digest", {portableSha256: DIGEST_A.toUpperCase()}],
        ["bad native digest", {nativeSha256: DIGEST_B.slice(1)}],
        ["bad report digest", {reportSha256: `${DIGEST_C.slice(1)}z`}],
        ["zero samples", {samples: 0}],
        ["fractional samples", {samples: 1.5}],
        ["negative error", {maximumAbsoluteError: -0.1}],
        ["non-finite error", {maximumAbsoluteError: Number.POSITIVE_INFINITY}],
        ["zero tolerance", {tolerance: 0}],
        ["non-finite tolerance", {tolerance: Number.NaN}],
        ["bad compiler report", {compilerReportSha256: "none"}],
        ["hardware overclaim", {namedDeviceAccepted: true}],
    ];
    for (const [label, changes] of cases) {
        agree(withProvenance({}, changes), false, label);
    }
});

test("descriptor owns and freezes training and native evidence", () => {
    const source = withProvenance({}, {compilerReportSha256: DIGEST_C});
    const expectedTraining = JSON.parse(JSON.stringify(source.requirements.model.trainingContract));
    const expectedEvidence = JSON.parse(JSON.stringify(source.requirements.model.nativeEvidence));
    const descriptor = new Contract.WorkloadDescriptor(source);
    const model = descriptor.manifest().requirements.model;

    source.requirements.model.trainingContract.recipe = "changed";
    source.requirements.model.nativeEvidence.samples = 999;

    assert.deepEqual(model.trainingContract, expectedTraining);
    assert.deepEqual(model.nativeEvidence, expectedEvidence);
    assert.equal(Object.isFrozen(model.trainingContract), true);
    assert.equal(Object.isFrozen(model.nativeEvidence), true);
});

test("lanes share training identity while keeping target-specific native evidence", () => {
    const gpu = withProvenance().requirements.model;
    gpu.id = "numeric-gpu";
    gpu.format = "ncnn";
    gpu.fullyQuantized = false;
    const npu = JSON.parse(JSON.stringify(gpu));
    npu.id = "numeric-npu";
    npu.format = "openvino";
    npu.nativeEvidence.nativeSha256 = DIGEST_C;

    assert.equal(Contract.isModelSet([gpu, npu], "gpu"), true);
    npu.trainingContract.reportSha256 = DIGEST_C;
    assert.equal(Contract.isModelSet([gpu, npu], "gpu"), false);
});

test("a declared tensor contract is accepted exactly as the schema accepts it", () => {
    const full = {
        inputs: [{
            shape: [1, 3, 227, 227],
            dtype: "float32",
            layout: "NCHW",
            preprocess: {channelOrder: "BGR", mean: [104, 117, 123], scale: [1, 1, 1]},
        }],
    };
    agree(withModel({tensorContract: full}), true, "full");
    agree(withModel({tensorContract: {inputs: [{shape: [4], dtype: "uint8"}]}}), true, "minimal");

    const cases = [
        ["no inputs", {inputs: []}],
        ["unknown property", {inputs: [{shape: [1], dtype: "uint8"}], extra: 1}],
        ["missing dtype", {inputs: [{shape: [1]}]}],
        ["unknown dtype", {inputs: [{shape: [1], dtype: "float16"}]}],
        ["unknown layout", {inputs: [{shape: [1], dtype: "uint8", layout: "WHCN"}]}],
        ["zero dimension", {inputs: [{shape: [0], dtype: "uint8"}]}],
        ["fractional dimension", {inputs: [{shape: [1.5], dtype: "uint8"}]}],
        ["oversized dimension", {inputs: [{shape: [65537], dtype: "uint8"}]}],
        ["rank too high", {inputs: [{shape: [1, 1, 1, 1, 1, 1, 1], dtype: "uint8"}]}],
        ["empty shape", {inputs: [{shape: [], dtype: "uint8"}]}],
        ["shape not an array", {inputs: [{shape: 227, dtype: "uint8"}]}],
        ["inputs not an array", {inputs: {shape: [1], dtype: "uint8"}}],
        ["contract not an object", "float32"],
    ];
    for (const [label, tensorContract] of cases) {
        agree(withModel({tensorContract}), false, label);
    }
});

test("a feature contract is closed, bounded, and preserves exact sequence meaning", () => {
    agree(withFeatureContract(), true, "full feature contract");
    agree(withFeatureContract({horizon: 128}), true, "maximum horizon");

    const schemaCases = [
        ["unknown property", {unknown: true}],
        ["wrong version", {version: 2}],
        ["wrong recipe", {recipe: "forecast-v2"}],
        ["no features", {featureNames: []}],
        ["duplicate feature", {featureNames: ["load", "load"]}],
        ["empty feature", {featureNames: [""]}],
        ["long feature", {featureNames: ["x".repeat(65)]}],
        ["zero window", {window: 0}],
        ["boolean window", {window: true}],
        ["large window", {window: 129}],
        ["zero horizon", {horizon: 0}],
        ["large horizon", {horizon: 129}],
        ["wrong observation order", {observationOrder: "newest-first"}],
        ["wrong flatten order", {flattenOrder: "features-then-observations"}],
    ];
    for (const [label, change] of schemaCases) {
        agree(withFeatureContract(change), false, label);
    }
});

test("feature semantics must agree with the exact model tensor and output", () => {
    const semanticCases = [
        ["target not first", withFeatureContract({targetFeature: "queue"})],
        ["wrong width", withFeatureContract({}, {
            tensorContract: {inputs: [{shape: [1, 8], dtype: "float32", layout: "NC"}]},
        })],
        ["wrong dtype", withFeatureContract({}, {
            tensorContract: {inputs: [{shape: [1, 9], dtype: "float64", layout: "NC"}]},
        })],
        ["wrong layout", withFeatureContract({}, {
            tensorContract: {inputs: [{shape: [1, 9], dtype: "float32", layout: "N"}]},
        })],
        ["non-raw output", withFeatureContract({}, {
            outputContract: {kind: "classification"},
        })],
    ];
    for (const [label, manifest] of semanticCases) {
        assert.equal(oracle(manifest), true, `${label}: schema leaves cross-fields to runtime`);
        assert.equal(Contract.isWorkloadManifest(manifest), false, label);
    }

    const features = ["a", "b", "c", "d", "e"];
    const overWidth = withFeatureContract(
        {featureNames: features, targetFeature: "a", window: 128},
        {tensorContract: {
            inputs: [{shape: [1, 640], dtype: "float32", layout: "NC"}],
        }},
    );
    assert.equal(oracle(overWidth), true, "product bounds need a semantic check");
    assert.equal(Contract.isWorkloadManifest(overWidth), false);

    const boundary = withFeatureContract(
        {featureNames: ["a", "b", "c", "d"], targetFeature: "a", window: 128},
        {tensorContract: {
            inputs: [{shape: [1, 512], dtype: "float32", layout: "NC"}],
        }},
    );
    agree(boundary, true, "512-value boundary");

    const featureContract = withFeatureContract().requirements.model.featureContract;
    const outputContract = {kind: "raw"};
    assert.equal(Contract.isFeatureContract(featureContract, {
        tensorContract: null, outputContract,
    }), false, "tensor contract must be an object");
    assert.equal(Contract.isFeatureContract(featureContract, {
        tensorContract: {inputs: {}}, outputContract,
    }), false, "tensor inputs must be an array");
    assert.equal(Contract.isFeatureContract(featureContract, {
        tensorContract: {inputs: [
            {shape: [1, 9], dtype: "float32", layout: "NC"},
            {shape: [1, 9], dtype: "float32", layout: "NC"},
        ]},
        outputContract,
    }), false, "forecast models have exactly one input");
});

test("same-shape lanes with different feature order are not one model", () => {
    const gpu = withFeatureContract().requirements.model;
    const npu = JSON.parse(JSON.stringify(gpu));
    npu.id = "sample-model-npu";
    npu.format = "openvino";
    npu.featureContract.featureNames = ["load", "memory", "queue"];

    assert.equal(Contract.isModel(gpu, "gpu"), true);
    assert.equal(Contract.isModel(npu, "gpu"), true);
    assert.equal(Contract.isModelSet([gpu, npu], "gpu"), false);
});

test("the preprocessing block is all-or-nothing and bounded", () => {
    const input = {shape: [1, 3, 2, 2], dtype: "float32"};
    const contract = (preprocess) => ({inputs: [{...input, preprocess}]});

    agree(
        withModel({tensorContract: contract({channelOrder: "GRAY", mean: [0], scale: [255]})}),
        true,
        "single channel",
    );

    const cases = [
        ["partial", {channelOrder: "BGR", mean: [1, 2, 3]}],
        ["unknown order", {channelOrder: "YUV", mean: [1], scale: [1]}],
        ["zero scale", {channelOrder: "RGB", mean: [1], scale: [0]}],
        ["negative scale", {channelOrder: "RGB", mean: [1], scale: [-1]}],
        ["empty mean", {channelOrder: "RGB", mean: [], scale: [1]}],
        ["too many channels", {channelOrder: "RGB", mean: [1, 2, 3, 4, 5], scale: [1]}],
        ["mean not numbers", {channelOrder: "RGB", mean: ["1"], scale: [1]}],
        ["extra property", {channelOrder: "RGB", mean: [1], scale: [1], gamma: 2.2}],
    ];
    for (const [label, preprocess] of cases) {
        agree(withModel({tensorContract: contract(preprocess)}), false, label);
    }
});

test("a declared output contract is accepted exactly as the schema accepts it", () => {
    agree(withModel({outputContract: {kind: "classification"}}), true, "kind only");
    agree(
        withModel({outputContract: {kind: "classification", topK: 5, labels: "labels.txt"}}),
        true,
        "full",
    );
    for (const kind of ["embedding", "raw"]) {
        agree(withModel({outputContract: {kind}}), true, kind);
    }

    const cases = [
        ["no kind", {topK: 5}],
        ["unknown kind", {kind: "detection"}],
        ["extra property", {kind: "raw", reduction: "mean"}],
        ["topK zero", {kind: "classification", topK: 0}],
        ["topK too large", {kind: "classification", topK: 101}],
        ["topK fractional", {kind: "classification", topK: 1.5}],
        ["labels uppercase", {kind: "classification", labels: "Labels.txt"}],
        ["labels with a path", {kind: "classification", labels: "../labels.txt"}],
        ["labels empty", {kind: "classification", labels: ""}],
        ["labels not text", {kind: "classification", labels: 7}],
        ["contract not an object", "classification"],
    ];
    for (const [label, outputContract] of cases) {
        agree(withModel({outputContract}), false, label);
    }
});

test("a model declaring neither contract is unchanged", () => {
    // Every manifest written before either field still loads.
    agree(Fixtures.validWorkloadManifest(), true, "no contracts");
});

test("companion digests are bounded, named, and lower-case hex", () => {
    const digest = "a".repeat(64);

    assert.equal(Contract.isCompanions({}), true, "vouching for nothing is still a statement");
    assert.equal(Contract.isCompanions({"model.bin": digest}), true);
    assert.equal(Contract.isCompanions({"labels.txt": digest, "model.bin": digest}), true);

    assert.equal(Contract.isCompanions(null), false);
    assert.equal(Contract.isCompanions([digest]), false);
    assert.equal(Contract.isCompanions({"model.bin": digest.toUpperCase()}), false);
    assert.equal(Contract.isCompanions({"model.bin": "abc"}), false);
    assert.equal(Contract.isCompanions({"model.bin": 1}), false);
    assert.equal(Contract.isCompanions({"Model.bin": digest}), false, "installed names are lower case");
    assert.equal(Contract.isCompanions({"../etc/passwd": digest}), false);
    assert.equal(Contract.isCompanions({[`${"x".repeat(65)}`]: digest}), false);

    const many = {};
    for (let index = 0; index < 9; index += 1) {
        many[`file${index}.bin`] = digest;
    }
    assert.equal(Contract.isCompanions(many), false, "bounded like every mirrored collection");
});

test("a model may vouch for its companions or for nothing beyond itself", () => {
    const digest = "b".repeat(64);

    // ncnn is a GPU format, and a tpu profile may declare nothing else.
    const manifest = Fixtures.validWorkloadManifest();
    manifest.requirements.accelerator = "gpu";
    manifest.requirements.model = {
        id: "sample-model",
        version: "1.0.0",
        format: "ncnn",
        fullyQuantized: false,
        minimumCompilerVersion: "1.0",
        minimumRuntimeVersion: "1.0",
        sha256: digest,
        companions: {"model.bin": digest},
    };
    assert.equal(Contract.isWorkloadManifest(manifest), true);

    manifest.requirements.model.companions = {"model.bin": "not-a-digest"};
    assert.equal(Contract.isWorkloadManifest(manifest), false);

    delete manifest.requirements.model.companions;
    assert.equal(Contract.isWorkloadManifest(manifest), true, "absent is still valid");
});

test("a profile may declare one model per accelerator lane", () => {
    const gpu = {
        id: "sample-model",
        version: "1.0.0",
        format: "ncnn",
        fullyQuantized: false,
        minimumCompilerVersion: "1.0",
        minimumRuntimeVersion: "1.0",
    };
    const npu = {...gpu, id: "sample-model-npu", format: "openvino"};

    const manifest = Fixtures.validWorkloadManifest();
    manifest.requirements.accelerator = "gpu";
    manifest.requirements.acceleratorPreference = ["npu", "gpu"];
    delete manifest.requirements.model;
    manifest.requirements.models = [gpu, npu];
    assert.equal(Contract.isWorkloadManifest(manifest), true);

    // Two entries for one format leave the runtime choosing with no rule.
    assert.equal(Contract.isModelSet([gpu, {...gpu, id: "other"}], "gpu"), false);
    // Entries that disagree are two networks sharing a profile.
    assert.equal(Contract.isModelSet(
        [{...gpu, outputContract: {kind: "classification"}}, npu], "gpu",
    ), false);
    assert.equal(Contract.isModelSet([], "gpu"), false);
    assert.equal(Contract.isModelSet(new Array(Contract.MAX_MODELS + 1).fill(gpu), "gpu"), false);
    assert.equal(Contract.isModelSet(gpu, "gpu"), false);
});

test("a multi-lane descriptor owns and reads every declared model", () => {
    const gpu = {
        id: "sample-model-gpu",
        version: "1.0.0",
        format: "ncnn",
        fullyQuantized: false,
        minimumCompilerVersion: "1.0",
        minimumRuntimeVersion: "1.0",
        tensorContract: {inputs: [{shape: [1, 3], dtype: "float32", layout: "NC"}]},
    };
    const npu = {...gpu, id: "sample-model-npu", format: "openvino"};
    const manifest = Fixtures.validWorkloadManifest();
    manifest.requirements.accelerator = "gpu";
    manifest.requirements.acceleratorPreference = ["npu", "gpu"];
    delete manifest.requirements.model;
    manifest.requirements.models = [gpu, npu];

    const descriptor = new Contract.WorkloadDescriptor(manifest);
    gpu.tensorContract.inputs[0].shape[1] = 99;
    manifest.requirements.acceleratorPreference.push("tpu");

    assert.equal(descriptor.executable, true);
    assert.deepEqual(descriptor.inputContract(), {
        shape: [1, 3], dtype: "float32", layout: "NC",
    });
    assert.equal(Object.hasOwn(descriptor.manifest().requirements, "model"), false);
    assert.equal(Object.isFrozen(descriptor.manifest().requirements.models), true);
    assert.equal(Object.isFrozen(descriptor.manifest().requirements.models[0]), true);
    assert.equal(Object.isFrozen(descriptor.manifest().requirements.acceleratorPreference), true);
    assert.deepEqual(
        descriptor.manifest().requirements.acceleratorPreference,
        ["npu", "gpu"],
    );
    assert.equal(Object.isFrozen(descriptor.inputContract()), true);
    assert.deepEqual(
        Contract.declaredModels(descriptor.manifest().requirements).map((model) => model.format),
        ["ncnn", "openvino"],
    );
});

test("exactly one spelling states which model a profile runs", () => {
    const model = {id: "m", version: "1.0.0", format: "ncnn"};

    assert.equal(Contract.hasOneModelDeclaration({model}), true);
    assert.equal(Contract.hasOneModelDeclaration({model: null}), true);
    assert.equal(Contract.hasOneModelDeclaration({models: [model]}), true);
    assert.equal(Contract.hasOneModelDeclaration({model: null, models: [model]}), true);
    assert.equal(Contract.hasOneModelDeclaration({model, models: [model]}), false);
    assert.equal(Contract.hasOneModelDeclaration({}), false);
});

test("two entries state one contract however they spell it", () => {
    // The service compares with json.dumps(sort_keys=True). Comparing raw
    // JSON.stringify made this mirror stricter than the contract, and a mirror
    // that refuses what the runtime loads is the one failure it must not have.
    const gpu = {
        id: "m",
        version: "1.0.0",
        format: "ncnn",
        fullyQuantized: false,
        minimumCompilerVersion: "1.0",
        minimumRuntimeVersion: "1.0",
        tensorContract: {inputs: [{shape: [1, 3, 8, 8], dtype: "float32"}]},
    };
    const reordered = {
        ...gpu,
        id: "n",
        format: "openvino",
        tensorContract: {inputs: [{dtype: "float32", shape: [1, 3, 8, 8]}]},
    };

    assert.equal(Contract.isModelSet([gpu, reordered], "gpu"), true);

    const different = {
        ...reordered,
        tensorContract: {inputs: [{dtype: "float32", shape: [1, 3, 9, 9]}]},
    };
    assert.equal(Contract.isModelSet([gpu, different], "gpu"), false);
});

test("canonical ordering reaches nested objects and survives arrays", () => {
    assert.deepEqual(
        JSON.stringify(Contract.canonical({b: 1, a: {d: 2, c: [{f: 3, e: 4}]}})),
        JSON.stringify({a: {c: [{e: 4, f: 3}], d: 2}, b: 1}),
    );
    assert.equal(Contract.canonical(null), null);
    assert.equal(Contract.canonical(7), 7);
    assert.deepEqual(Contract.canonical([2, 1]), [2, 1], "array order is meaning, not spelling");
});
