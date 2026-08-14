"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const Ajv2020 = require("ajv/dist/2020").default;
const Contract = require("../../files/cinnamon-xpuwlm@geraldo-netto/lib/runtime-control-contract.js");

const root = path.resolve(__dirname, "../../files/cinnamon-xpuwlm@geraldo-netto");
const commandOracle = new Ajv2020({strict: true}).compile(JSON.parse(
    fs.readFileSync(path.join(root, "runtime-command.schema.json"), "utf8"),
));
const acknowledgementOracle = new Ajv2020({strict: true}).compile(JSON.parse(
    fs.readFileSync(path.join(root, "runtime-acknowledgement.schema.json"), "utf8"),
));

function command(overrides = {}) {
    return {
        version: 2,
        id: "command-1",
        issuedAt: 1_700_000_000_000,
        expectedRevision: 0,
        operation: "set-profile-enabled",
        profileId: "hardware-health",
        value: false,
        ...overrides,
    };
}

function acknowledgement(overrides = {}) {
    return {
        version: 2,
        commandId: "command-1",
        status: "applied",
        revision: 1,
        appliedAt: 1_700_000_000_001,
        message: "",
        portfolio: {
            paused: false,
            profiles: {"hardware-health": {enabled: false, weight: 2}},
            deviceChoices: {},
        },
        ...overrides,
    };
}

test("runtime commands match schema for every operation and boundary", () => {
    const cases = [
        ["enabled", command(), true],
        ["weight", command({operation: "set-profile-weight", value: 5}), true],
        ["device", command({operation: "set-profile-device", value: "gpu-renderD128"}), true],
        ["automatic device", command({operation: "set-profile-device", value: null}), true],
        ["paused", command({operation: "set-paused", profileId: null, value: true}), true],
        ["not object", null, false],
        ["extra", {...command(), extra: true}, false],
        ["version", command({version: 1}), false],
        ["id", command({id: "bad id"}), false],
        ["issuedAt", command({issuedAt: 0}), false],
        ["revision", command({expectedRevision: -1}), false],
        ["operation", command({operation: "unknown"}), false],
        ["enabled profile", command({profileId: null}), false],
        ["enabled value", command({value: 1}), false],
        ["weight value", command({operation: "set-profile-weight", value: 6}), false],
        ["device value", command({operation: "set-profile-device", value: "gpu-card0"}), false],
        ["pause profile", command({operation: "set-paused", value: true}), false],
        ["pause value", command({operation: "set-paused", profileId: null, value: 1}), false],
    ];
    for (const [name, value, expected] of cases) {
        assert.equal(Contract.isRuntimeCommand(value), expected, name);
        assert.equal(Boolean(commandOracle(value)), expected, `${name}: schema`);
    }
});

test("runtime acknowledgements match schema boundaries", () => {
    const valid = acknowledgement();
    const cases = [
        ["applied", valid, true],
        ["rejected", acknowledgement({status: "rejected", message: "Conflict"}), true],
        ["not object", null, false],
        ["extra", {...valid, extra: true}, false],
        ["version", acknowledgement({version: 1}), false],
        ["command id", acknowledgement({commandId: "bad id"}), false],
        ["status", acknowledgement({status: "pending"}), false],
        ["revision", acknowledgement({revision: -1}), false],
        ["time", acknowledgement({appliedAt: 0}), false],
        ["message", acknowledgement({message: "x".repeat(241)}), false],
        ["portfolio", acknowledgement({portfolio: null}), false],
        ["paused", acknowledgement({portfolio: {paused: "no", profiles: {}}}), false],
        ["profile", acknowledgement({portfolio: {paused: false, profiles: {x: {enabled: true, weight: 9}}}}), false],
        ["device choices", acknowledgement({portfolio: {paused: false, profiles: {}, deviceChoices: {x: "gpu-card0"}}}), false],
    ];
    for (const [name, value, expected] of cases) {
        assert.equal(Contract.isRuntimeAcknowledgement(value), expected, name);
        assert.equal(Boolean(acknowledgementOracle(value)), expected, `${name}: schema`);
    }
});

test("runtime control predicates and gateway port remain closed", () => {
    assert.equal(Contract.commandIdentity("a.B_1-2"), true);
    assert.equal(Contract.commandIdentity(""), false);
    assert.equal(Contract.commandIdentity("x".repeat(121)), false);
    assert.equal(Contract.boundedProfileId("profile"), true);
    assert.equal(Contract.boundedProfileId(null), false);
    assert.equal(Contract.isEnabledCommand(command()), true);
    assert.equal(Contract.isWeightCommand(command({profileId: null})), false);
    assert.equal(Contract.isDeviceCommand(command({operation: "set-profile-device", value: null})), true);
    assert.equal(Contract.isDeviceChoice("gpu-renderD123456"), true);
    assert.equal(Contract.isDeviceChoice("gpu-renderD1234567"), false);
    assert.equal(Contract.isPauseCommand(command({operation: "set-paused", profileId: null})), true);
    assert.equal(Contract.isCommandOperation(command({operation: "unknown"})), false);
    assert.equal(Contract.hasCommandEnvelope(command()), true);
    assert.equal(Contract.hasAcknowledgementEnvelope(acknowledgement()), true);
    assert.equal(Contract.isProfilePreference({enabled: true, weight: 1}), true);
    assert.equal(Contract.isPortfolio({paused: false, profiles: {}, deviceChoices: {}}), true);
    assert.equal(Contract.exactRecord({a: 1}, new Set(["a"])), true);
    const gateway = {send() {}, cancel() {}};
    assert.equal(Contract.requireControlGateway(gateway), gateway);
    assert.throws(() => Contract.requireControlGateway(null), /gateway/u);
    assert.throws(() => Contract.requireControlGateway({send() {}}), /send\/cancel/u);
});

test("device choice maps and batch fields share exact schema bounds", () => {
    const choices = Object.fromEntries(Array.from(
        {length: 128},
        (_value, index) => [`profile-${index}`, `gpu-renderD${128 + index}`],
    ));
    const exact = acknowledgement({
        portfolio: {paused: false, profiles: {}, deviceChoices: choices},
    });
    assert.equal(Contract.isRuntimeAcknowledgement(exact), true);
    assert.equal(Boolean(acknowledgementOracle(exact)), true);
    const overflow = structuredClone(exact);
    overflow.portfolio.deviceChoices.overflow = "gpu-renderD999";
    assert.equal(Contract.isRuntimeAcknowledgement(overflow), false);
    assert.equal(Boolean(acknowledgementOracle(overflow)), false);

    const batch = command({
        operation: "apply-profiles",
        profileId: null,
        value: null,
        changes: [{profileId: "visual-library", deviceId: "gpu-renderD128"}],
    });
    assert.equal(Contract.isRuntimeCommand(batch), true);
    assert.equal(Boolean(commandOracle(batch)), true);
    assert.equal(Contract.changesSomething({profileId: "x", deviceId: null}), true);
    assert.equal(Contract.changesSomething({profileId: "x"}), false);
});

module.exports = {acknowledgement, command};
