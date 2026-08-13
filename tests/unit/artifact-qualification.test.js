"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const Qualification = require("../../files/cinnamon-xpuwlm@geraldo-netto/lib/artifact-qualification.js");
const {A, SIGNATURE, valid} = require("../helpers/artifact-qualification-fixture.js");

function changed(root, section, patch) {
    return {...root, [section]: {...root[section], ...patch}};
}

test("qualification owns a closed signed record and deterministic unsigned payload", () => {
    const source = valid();
    const record = Qualification.createQualification(source);
    source.recipe.id = "mutated";
    source.signature.value = `${"B".repeat(86)}==`;

    assert.equal(record.recipe.id, "forecast-recipe");
    assert.equal(record.signature.value, SIGNATURE);
    assert.equal(Object.isFrozen(record), true);
    assert.equal(Object.isFrozen(record.hardwareEvidence), true);
    const unsigned = Qualification.unsignedQualification(record);
    assert.equal(Object.hasOwn(unsigned, "signature"), false);
    assert.equal(Object.isFrozen(unsigned.recipe), true);

    const reordered = Object.fromEntries(Object.entries(valid()).reverse());
    assert.equal(
        Qualification.canonicalUnsignedQualification(reordered),
        Qualification.canonicalUnsignedQualification(valid()),
    );
    assert.equal(Qualification.canonicalUnsignedQualification(record).includes("release-key"), false);
});

test("qualification accepts explicit accepted and rejected named-hardware decisions", () => {
    assert.equal(Qualification.isQualification(valid()), true);
    assert.equal(Qualification.isQualification(changed(
        valid(), "hardwareEvidence", {decision: "rejected"},
    )), true);
    assert.deepEqual(Qualification.DECISIONS, ["accepted", "rejected"]);
});

test("qualification rejects every malformed identity, review, export, binding, and digest", () => {
    const base = valid();
    const invalid = [
        null,
        [],
        {...base, extra: true},
        {...base, version: 2},
        {...base, artifactId: "Bad id"},
        {...base, artifactVersion: "1.2"},
        changed(base, "recipe", {id: "bad id"}),
        changed(base, "recipe", {revision: "v1"}),
        changed(base, "recipe", {sha256: A.toUpperCase()}),
        changed(base, "recipe", {reviewedBy: ""}),
        changed(base, "recipe", {reviewedAt: -1}),
        changed(base, "portableExport", {format: "tflite"}),
        changed(base, "portableExport", {sha256: "a"}),
        changed(base, "nativeBinding", {backend: "ncnn-cpu"}),
        changed(base, "nativeBinding", {paramSha256: "b"}),
        changed(base, "nativeBinding", {weightsSha256: "c"}),
        changed(base, "nativeBinding", {minimumNcnnVersion: ""}),
        changed(base, "nativeBinding", {vulkanRequired: false}),
        {...base, tensorContractSha256: "c"},
    ];
    for (const candidate of invalid) {
        assert.equal(Qualification.isQualification(candidate), false);
        assert.throws(() => Qualification.createQualification(candidate), Qualification.QualificationError);
    }
});

test("qualification rejects malformed licenses, signatures, and hardware evidence", () => {
    const base = valid();
    const invalid = [
        changed(base, "license", {spdxId: "bad id"}),
        changed(base, "license", {sourceUrl: "http://example.invalid"}),
        changed(base, "license", {noticeSha256: "a"}),
        changed(base, "signature", {algorithm: "rsa"}),
        changed(base, "signature", {keyId: "Bad key"}),
        changed(base, "signature", {value: "A".repeat(88)}),
        changed(base, "hardwareEvidence", {deviceName: ""}),
        changed(base, "hardwareEvidence", {driverVersion: ""}),
        changed(base, "hardwareEvidence", {runtimeVersion: ""}),
        changed(base, "hardwareEvidence", {benchmarkVersion: 2}),
        changed(base, "hardwareEvidence", {benchmarkRecordSha256: "b"}),
        changed(base, "hardwareEvidence", {measuredAt: 1.5}),
        changed(base, "hardwareEvidence", {decision: "ready"}),
    ];
    for (const candidate of invalid) {
        assert.equal(Qualification.isQualification(candidate), false);
    }
});
