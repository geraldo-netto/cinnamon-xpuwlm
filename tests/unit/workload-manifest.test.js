"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const Ajv2020 = require("ajv/dist/2020").default;
const Contract = require("../../files/cinnamon-tpuwm@geraldo-netto/lib/workload-manifest.js");
const Fixtures = require("../helpers/workload-manifest-fixtures.js");

const schema = JSON.parse(fs.readFileSync(path.resolve(
    __dirname,
    "../../files/cinnamon-tpuwm@geraldo-netto/workload-manifest.schema.json",
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
