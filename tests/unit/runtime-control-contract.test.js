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

// A batch exists so several profile settings land as one revision: sending
// them separately spends a revision each and leaves policy half-applied when
// one fails. So the shape of a batch is the whole guarantee, and the applet's
// mirror has to agree with the schema on every part of it.
test("a batch command carries changes, no single target, and at least one edit", () => {
    const batch = (changes, overrides = {}) => command({
        operation: "apply-profiles",
        profileId: null,
        value: null,
        changes,
        ...overrides,
    });

    const agree = (candidate, expected, label) => {
        assert.equal(Contract.isRuntimeCommand(candidate), expected, label);
        assert.equal(Boolean(commandOracle(candidate)), expected, `${label}: schema`);
    };

    agree(batch([{profileId: "visual-library", enabled: false}]), true, "one enable");
    agree(batch([{profileId: "visual-library", weight: 5}]), true, "one weight");
    agree(batch([{profileId: "visual-library", deviceId: null}]), true, "clearing a device");
    agree(batch([
        {profileId: "visual-library", enabled: true, weight: 3, deviceId: "gpu-renderD128"},
        {profileId: "hardware-health", enabled: false},
    ]), true, "several profiles at once");

    // A batch names its targets inside `changes`, so the single-target fields
    // must stay empty; carrying both would leave two answers to one question.
    agree(batch([{profileId: "a", enabled: true}], {profileId: "a"}), false, "target as well");
    agree(batch([{profileId: "a", enabled: true}], {value: true}), false, "value as well");

    // An empty batch spends a revision to change nothing.
    agree(batch([]), false, "no changes");

    // A change that names a profile without editing it is the same waste, and
    // the mirror refuses it where the schema does not. That is deliberate on
    // both sides: the runtime rejects it in domain code so it can say which
    // fields were missing ("neither enabled nor weight"), which a schema
    // keyword would replace with the generic contract message. The mirror
    // matches the runtime's behaviour, not merely its schema.
    const noop = batch([{profileId: "visual-library"}]);
    assert.equal(Contract.isRuntimeCommand(noop), false, "the mirror refuses a no-op change");
    assert.equal(Boolean(commandOracle(noop)), true, "the schema leaves it to the runtime");

    agree(batch([{profileId: "", enabled: true}]), false, "empty profile id");
    agree(batch([{profileId: "visual-library", unknown: true}]), false, "unknown property");
    agree(batch([{profileId: "visual-library", enabled: "yes"}]), false, "enabled not boolean");
    agree(batch([{profileId: "visual-library", weight: 0}]), false, "weight under the floor");
    agree(batch([{profileId: "visual-library", weight: 6}]), false, "weight over the ceiling");
    agree(batch([{profileId: "visual-library", weight: 2.5}]), false, "fractional weight");
    agree(batch([{profileId: "visual-library", deviceId: "renderD128"}]), false, "device id shape");
    agree(batch(["visual-library"]), false, "change is not a record");
    agree(batch("visual-library"), false, "changes is not an array");

    // The batch is bounded, so one command cannot become an unbounded write.
    const one = {profileId: "visual-library", enabled: true};
    agree(batch(new Array(Contract.MAX_CHANGES).fill(one)), true, "at the bound");
    agree(batch(new Array(Contract.MAX_CHANGES + 1).fill(one)), false, "over the bound");
});

test("optional profile values are checked only when the change carries them", () => {
    assert.equal(Contract.validOptionalProfileValues({}), true, "nothing to check");
    assert.equal(Contract.validOptionalProfileValues({enabled: true}), true);
    assert.equal(Contract.validOptionalProfileValues({enabled: 1}), false);
    assert.equal(Contract.validOptionalProfileValues({weight: 3}), true);
    assert.equal(Contract.validOptionalProfileValues({weight: 9}), false);
    assert.equal(Contract.validOptionalProfileValues({deviceId: null}), true);
    assert.equal(Contract.validOptionalProfileValues({deviceId: "gpu-renderD128"}), true);
    assert.equal(Contract.validOptionalProfileValues({deviceId: "nonsense"}), false);
    // One bad value spoils the change even when the others are fine.
    assert.equal(
        Contract.validOptionalProfileValues({enabled: true, weight: 3, deviceId: "bad"}),
        false,
    );
});

// A refusal the applet raises itself must be distinguishable from a transport
// error, or the menu reports "the runtime refused this" for a bus that never
// carried the command.
test("a contract violation is marked and recognised, and nothing else is", () => {
    const violation = Contract.contractViolation(Error, "command does not match version 2");
    assert.equal(violation instanceof Error, true);
    assert.equal(violation.message, "command does not match version 2");
    assert.equal(Contract.isContractViolation(violation), true);

    const typed = Contract.contractViolation(TypeError, "bad type");
    assert.equal(typed instanceof TypeError, true);
    assert.equal(Contract.isContractViolation(typed), true);

    for (const candidate of [
        null, undefined, "violation", 7, {},
        new Error("bus is gone"),
        {controlContractViolation: false},
        {controlContractViolation: "true"},
    ]) {
        assert.equal(Contract.isContractViolation(candidate), false, JSON.stringify(candidate));
    }
});

test("a control gateway is refused unless it can both send and cancel", () => {
    const complete = {send() {}, cancel() {}};
    assert.equal(Contract.requireControlGateway(complete), complete);

    for (const candidate of [
        null, undefined, 0, "", {}, {send() {}}, {cancel() {}},
        {send: true, cancel() {}}, {send() {}, cancel: "no"},
    ]) {
        assert.throws(
            () => Contract.requireControlGateway(candidate),
            /gateway/iu,
            JSON.stringify(candidate),
        );
    }
});
