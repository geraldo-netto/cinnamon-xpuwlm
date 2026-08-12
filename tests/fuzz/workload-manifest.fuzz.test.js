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

function random(seed) {
    let state = seed >>> 0;
    return () => {
        state = ((state * 1664525) + 1013904223) >>> 0;
        return state / 0x100000000;
    };
}

test("fuzz: manifest predicate stays equivalent to authoritative schema", () => {
    const next = random(0x35c0ffee);
    const paths = [
        ["manifestVersion"], ["id"], ["version"], ["capabilities"],
        ["requirements", "runtimeApi"], ["requirements", "accelerator"],
        ["requirements", "minimumDevices"], ["requirements", "model"],
        // Optional properties: JSON Schema treats an explicit `undefined` as
        // absent, and the mirror has to agree in both directions.
        ["requirements", "acceleratorPreference"], ["requirements", "model", "sha256"],
        ["ui", "title"], ["ui", "group"], ["ui", "description"], ["ui", "icon"],
        ["defaults", "enabled"], ["defaults", "weight"],
        ["pipeline", "hostResponsibilities"], ["acceptance"],
    ];
    const hostile = [null, undefined, true, false, -1, 0, 1.5, "", "Bad Value", [], {}, () => {}];

    for (let iteration = 0; iteration < 1000; iteration += 1) {
        const candidate = Fixtures.validWorkloadManifest();
        const pathParts = paths[Math.floor(next() * paths.length)];
        let owner = candidate;
        for (const part of pathParts.slice(0, -1)) {
            owner = owner[part];
        }
        owner[pathParts.at(-1)] = hostile[Math.floor(next() * hostile.length)];
        assert.equal(
            Contract.isWorkloadManifest(candidate),
            Boolean(oracle(candidate)),
            `iteration ${iteration}`,
        );
    }
});

test("fuzz: the plug-in subtree predicate stays equivalent to the schema", () => {
    const next = random(0x21b10c);
    const paths = [
        ["manifestVersion"], ["plugin"],
        ["plugin", "entryPoint"], ["plugin", "protocol"],
        ["plugin", "protocol", "minimum"], ["plugin", "protocol", "maximum"],
        ["plugin", "protocol", "capabilities"],
        ["plugin", "schemas"], ["plugin", "schemas", "configuration"],
        ["plugin", "schemas", "input"], ["plugin", "schemas", "output"],
        ["plugin", "triggers"], ["plugin", "artifacts"],
        ["plugin", "artifacts", 0], ["plugin", "permissions"],
    ];
    const hostile = [
        null, undefined, true, false, -1, 0, 1, 2, 3, 1.5, 65535, 65536,
        "", "Bad Value", "manual", "stream-", "1stream", "fs:read/tmp", "fsread",
        [], ["manual"], ["manual", "manual"], {}, {unexpected: true}, () => {},
    ];

    for (let iteration = 0; iteration < 3000; iteration += 1) {
        const candidate = Fixtures.validPluginWorkloadManifest();
        const pathParts = paths[Math.floor(next() * paths.length)];
        let owner = candidate;
        for (const part of pathParts.slice(0, -1)) {
            owner = owner[part];
        }
        owner[pathParts.at(-1)] = hostile[Math.floor(next() * hostile.length)];
        assert.equal(
            Contract.isWorkloadManifest(candidate),
            Boolean(oracle(candidate)),
            `iteration ${iteration}: ${pathParts.join(".")}`,
        );
    }
});

test("property: GGUF companion mutations stay schema-equivalent", () => {
    const next = random(0x66a7f00d);
    const formats = ["gguf", "ncnn", "onnx", "safetensors", "GGUF", ""];
    const names = ["model.bin", "tokenizer.json", "labels.txt", "../model.bin", "Model.bin", ""];
    const digests = ["a".repeat(64), "b".repeat(64), "A".repeat(64), "a".repeat(63), ""];

    for (let iteration = 0; iteration < 1000; iteration += 1) {
        const artifact = {
            id: "qwen3-0-6b-q8-0",
            version: "1.0.0",
            format: formats[Math.floor(next() * formats.length)],
            sha256: digests[Math.floor(next() * digests.length)],
        };
        if (next() < 0.8) {
            const companions = {};
            const count = Math.floor(next() * 10);
            for (let index = 0; index < count; index += 1) {
                const name = names[Math.floor(next() * names.length)];
                companions[`${index}-${name}`] = digests[Math.floor(next() * digests.length)];
            }
            artifact.companions = companions;
        }
        const manifest = Fixtures.validPluginWorkloadManifest();
        manifest.plugin.artifacts = [artifact];
        const expected = Boolean(oracle(manifest));
        assert.equal(Contract.isPluginArtifact(artifact), expected, `artifact ${iteration}`);
        assert.equal(Contract.isWorkloadManifest(manifest), expected, `manifest ${iteration}`);
    }
});

// `requirements.model.sha256` is optional, so the exact key-count rule no
// longer applies to the model record. Both the schema and the predicate must
// agree on absent, well-formed, and malformed digests alike.
test("property: optional model digests stay equivalent to the authoritative schema", () => {
    const next = random(0x0d19e57);
    const digest = "a".repeat(64);
    const candidates = [
        undefined,
        digest,
        "0123456789abcdef".repeat(4),
        digest.toUpperCase(),
        digest.slice(0, 63),
        `${digest}a`,
        "",
        null,
        7,
        [digest],
        {value: digest},
        `${digest.slice(0, 63)}g`,
        `${digest.slice(0, 63)} `,
    ];

    for (const value of candidates) {
        const candidate = Fixtures.validWorkloadManifest();
        if (value === undefined) {
            delete candidate.requirements.model.sha256;
        } else {
            candidate.requirements.model.sha256 = value;
        }
        assert.equal(
            Contract.isWorkloadManifest(candidate),
            Boolean(oracle(candidate)),
            `digest ${JSON.stringify(value)}`,
        );
    }

    // Random hexadecimal noise of every length around the 64-character bound.
    for (let length = 60; length <= 68; length += 1) {
        const candidate = Fixtures.validWorkloadManifest();
        candidate.requirements.model.sha256 = Array.from(
            {length},
            () => "0123456789abcdef"[Math.floor(next() * 16)],
        ).join("");
        assert.equal(
            Contract.isWorkloadManifest(candidate),
            Boolean(oracle(candidate)),
            `length ${length}`,
        );
    }
});

test("property: ordered forecast features survive bounds and reject lane permutations", () => {
    const next = random(0xf04eca57);
    for (let iteration = 0; iteration < 500; iteration += 1) {
        const featureCount = 3 + Math.floor(next() * 14);
        const maximumWindow = Math.min(128, Math.floor(512 / featureCount));
        const window = 1 + Math.floor(next() * maximumWindow);
        const horizon = 1 + Math.floor(next() * 128);
        const featureNames = Array.from({length: featureCount}, (_item, index) => `f${index}`);
        const width = featureCount * window;
        const model = {
            id: "forecast-gpu",
            version: "1.0.0",
            format: "ncnn",
            fullyQuantized: false,
            minimumCompilerVersion: "1.0",
            minimumRuntimeVersion: "1.0",
            tensorContract: {
                inputs: [{shape: [1, width], dtype: "float32", layout: "NC"}],
            },
            featureContract: {
                version: 1,
                recipe: "forecast-v1",
                featureNames,
                targetFeature: featureNames[0],
                window,
                horizon,
                observationOrder: "oldest-first",
                flattenOrder: "observations-then-features",
            },
            outputContract: {kind: "raw"},
        };
        const manifest = Fixtures.validWorkloadManifest();
        manifest.requirements.accelerator = "gpu";
        manifest.requirements.model = model;
        assert.equal(Boolean(oracle(manifest)), true, `iteration ${iteration}: schema`);
        assert.equal(Contract.isWorkloadManifest(manifest), true, `iteration ${iteration}`);

        const permuted = JSON.parse(JSON.stringify(model));
        permuted.id = "forecast-npu";
        permuted.format = "openvino";
        [permuted.featureContract.featureNames[1], permuted.featureContract.featureNames[2]] = [
            permuted.featureContract.featureNames[2],
            permuted.featureContract.featureNames[1],
        ];
        assert.equal(Contract.isModel(permuted, "gpu"), true);
        assert.equal(Contract.isModelSet([model, permuted], "gpu"), false);
    }
});

test("property: training provenance and native evidence stay schema-equivalent", () => {
    const next = random(0x5eed0052);
    const digest = (symbol) => symbol.repeat(64);
    const training = () => ({
        version: 1,
        profileId: "storage-intelligence",
        recipe: "backblaze-smart-risk-v1",
        reportSha256: digest("a"),
        taskSemanticsSha256: digest("b"),
    });
    const evidence = () => ({
        portableSha256: digest("a"),
        nativeSha256: digest("b"),
        reportSha256: digest("c"),
        samples: 1 + Math.floor(next() * 10000),
        maximumAbsoluteError: next() * 10,
        tolerance: Number.MIN_VALUE + (next() * 10),
        compilerReportSha256: next() < 0.5 ? null : digest("d"),
        namedDeviceAccepted: false,
    });
    const paths = [
        ["trainingContract", "version"],
        ["trainingContract", "profileId"],
        ["trainingContract", "recipe"],
        ["trainingContract", "reportSha256"],
        ["trainingContract", "taskSemanticsSha256"],
        ["nativeEvidence", "portableSha256"],
        ["nativeEvidence", "nativeSha256"],
        ["nativeEvidence", "reportSha256"],
        ["nativeEvidence", "samples"],
        ["nativeEvidence", "maximumAbsoluteError"],
        ["nativeEvidence", "tolerance"],
        ["nativeEvidence", "compilerReportSha256"],
        ["nativeEvidence", "namedDeviceAccepted"],
    ];
    const hostile = [
        undefined, null, true, false, -1, 0, 1.5, Number.POSITIVE_INFINITY,
        "", "Bad Value", "A".repeat(64), "a".repeat(63), [], {},
    ];

    for (let iteration = 0; iteration < 1000; iteration += 1) {
        const candidate = Fixtures.validWorkloadManifest();
        candidate.requirements.accelerator = "gpu";
        candidate.requirements.model = {
            ...candidate.requirements.model,
            format: "ncnn",
            fullyQuantized: false,
            trainingContract: training(),
            nativeEvidence: evidence(),
        };
        assert.equal(Contract.isWorkloadManifest(candidate), true, `valid ${iteration}`);
        assert.equal(Boolean(oracle(candidate)), true, `valid ${iteration}: schema`);

        const [record, field] = paths[Math.floor(next() * paths.length)];
        candidate.requirements.model[record][field] = hostile[Math.floor(next() * hostile.length)];
        assert.equal(
            Contract.isWorkloadManifest(candidate),
            Boolean(oracle(candidate)),
            `iteration ${iteration}: ${record}.${field}`,
        );
    }
});
