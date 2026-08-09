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
        ["manifest version", {...valid, manifestVersion: 2}, false],
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
    });
    assert.equal(Object.isFrozen(descriptor.profileDefinition()), true);
    assert.throws(() => new Contract.WorkloadDescriptor({}), /version 1 contract/u);
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
