"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const Readiness = require(
    "../../files/cinnamon-xpuwlm@geraldo-netto/lib/readiness-acceptance.js"
);
const {A, B, clone, valid} = require("../helpers/readiness-acceptance-fixture.js");

function changed(section, patch) {
    const evidence = valid();
    return {...evidence, [section]: {...evidence[section], ...patch}};
}

test("complete named-hardware Cinnamon evidence is immutable and accepted", () => {
    const source = valid();
    const evidence = Readiness.createReadinessEvidence(source);
    source.hardware.deviceName = "changed";
    source.scenarios[0].observedOutcome = "lost";

    assert.equal(evidence.hardware.deviceName, "AMD Radeon RX 7900 XTX");
    assert.equal(Object.isFrozen(evidence), true);
    assert.equal(Object.isFrozen(evidence.scenarios), true);
    assert.equal(Object.isFrozen(evidence.scenarios[0].errors), true);
    assert.deepEqual(Readiness.readinessDecision(evidence), {
        ready: true,
        reason: "accepted",
        workloadId: "queue-health",
        hostId: "workstation-1",
        deviceName: "AMD Radeon RX 7900 XTX",
        replaySha256: A,
        issueCount: 0,
    });
});

test("root, hardware, and recording contracts reject anonymous or synthetic evidence", () => {
    const base = valid();
    const invalid = [
        null, [], {}, {...base, extra: true}, {...base, version: 2},
        {...base, workloadId: "Bad id"}, {...base, measuredAt: -1},
        changed("hardware", {hostId: "Bad host"}),
        changed("hardware", {deviceName: ""}),
        changed("hardware", {backend: "cpu"}),
        changed("hardware", {driverVersion: ""}),
        changed("hardware", {runtimeVersion: ""}),
        changed("recording", {sessionType: "test-fixture"}),
        changed("recording", {startedAt: -1}),
        changed("recording", {endedAt: 1000}),
        changed("recording", {replaySha256: "A".repeat(64)}),
    ];
    for (const candidate of invalid) {
        assert.equal(Readiness.isReadinessEvidence(candidate), false);
        assert.deepEqual(Readiness.readinessDecision(candidate), {
            ready: false, reason: "evidence-invalid",
        });
        assert.throws(() => Readiness.createReadinessEvidence(candidate), Readiness.ReadinessError);
    }
});

test("every acceptance scenario must be unique, real, clicked, bounded, and expected", () => {
    const mutateScenario = (index, patch) => {
        const evidence = valid();
        evidence.scenarios[index] = {...evidence.scenarios[index], ...patch};
        return evidence;
    };
    const invalid = [
        {...valid(), scenarios: []},
        {...valid(), scenarios: valid().scenarios.slice(0, -1)},
        mutateScenario(0, {id: "unknown"}),
        mutateScenario(0, {execution: "simulated"}),
        mutateScenario(0, {clickControlId: ""}),
        mutateScenario(0, {startedAt: 999}),
        mutateScenario(0, {endedAt: 2001}),
        mutateScenario(0, {endedAt: 1100}),
        mutateScenario(0, {expectedOutcome: "lost"}),
        mutateScenario(0, {observedOutcome: "lost"}),
        mutateScenario(0, {resultValid: true, resultSha256: null}),
        mutateScenario(0, {resultSha256: "b".repeat(63)}),
        mutateScenario(0, {errors: {}}),
        mutateScenario(0, {warnings: Array(65).fill({code: "x", message: "x", timestamp: 1})}),
    ];
    const duplicate = valid();
    duplicate.scenarios[1] = {...duplicate.scenarios[1], id: duplicate.scenarios[0].id};
    invalid.push(duplicate);
    const noClickResult = valid();
    noClickResult.scenarios[0] = {
        ...noClickResult.scenarios[0], resultValid: false, resultSha256: null,
    };
    invalid.push(noClickResult);
    const noRecoveryResult = valid();
    noRecoveryResult.scenarios[6] = {
        ...noRecoveryResult.scenarios[6], resultValid: false, resultSha256: null,
    };
    invalid.push(noRecoveryResult);
    for (const candidate of invalid) {
        assert.equal(Readiness.isReadinessEvidence(candidate), false);
    }
});

test("issue monitoring is retained and prevents a ready decision", () => {
    const evidence = valid();
    evidence.scenarios[0].warnings = [{
        code: "driver-warning", message: "GPU reset counter changed", timestamp: 1120,
    }];
    assert.equal(Readiness.isReadinessEvidence(evidence), true);
    assert.deepEqual(Readiness.readinessDecision(evidence), {
        ready: false, reason: "issues-observed", issueCount: 1,
    });
    const malformed = clone(evidence);
    malformed.scenarios[0].warnings[0].extra = true;
    assert.equal(Readiness.isReadinessEvidence(malformed), false);
});

test("individual evidence predicates enforce boundaries without throwing", () => {
    const evidence = valid();
    assert.equal(Readiness.validHardware(evidence.hardware), true);
    assert.equal(Readiness.validRecording(evidence.recording), true);
    assert.equal(Readiness.validScenario(evidence.scenarios[0]), true);
    assert.equal(Readiness.validIssue({code: "x", message: "x", timestamp: 0}), true);
    for (const predicate of [
        Readiness.validHardware, Readiness.validRecording,
        Readiness.validScenario, Readiness.validIssue,
    ]) {
        for (const value of [null, [], {}, "x", 1]) {
            assert.doesNotThrow(() => predicate(value));
            assert.equal(predicate(value), false);
        }
    }
    assert.equal(B.length, 64);
});
