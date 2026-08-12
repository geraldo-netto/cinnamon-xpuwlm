"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const Inventory = require("../../files/cinnamon-xpuwlm@geraldo-netto/lib/plugin-inventory.js");
const Refusal = require("../../files/cinnamon-xpuwlm@geraldo-netto/lib/runtime-refusal-contract.js");
const RuntimeControl = require("../../files/cinnamon-xpuwlm@geraldo-netto/lib/runtime-control-contract.js");

function plugin(overrides = {}) {
    return {
        id: "event-extraction",
        version: "1.0.0",
        source: "external",
        distribution: "omnitensor-event-provider",
        workerState: "ready",
        protocol: {minimum: 1, maximum: 1, capabilities: ["cancel", "execute", "progress"]},
        triggers: ["manual"],
        artifacts: [{id: "qwen-events", version: "1", format: "gguf", ready: true, reason: ""}],
        permissions: [{name: "files:read-selected", granted: true}],
        configurationSchema: {type: "object"},
        secretConfigurationKeys: [],
        ...overrides,
    };
}

function inventory(overrides = {}) {
    return {version: 1, generatedAt: 1, plugins: [plugin()], ...overrides};
}

test("inventory parser accepts the exact DescribePlugins document", () => {
    const parsed = Inventory.parseInventory(JSON.stringify(inventory()));
    assert.equal(parsed.plugins[0].workerState, "ready");
    assert.ok(Inventory.validInventory(parsed));
    assert.ok(Inventory.validPlugin(parsed.plugins[0]));
    assert.ok(Inventory.validProtocol(parsed.plugins[0].protocol));
    assert.ok(Inventory.validArtifact(parsed.plugins[0].artifacts[0]));
    assert.ok(Inventory.validPermission(parsed.plugins[0].permissions[0]));
});

test("inventory parser rejects malformed, extra, oversized, and refusal replies", () => {
    assert.throws(() => Inventory.parseInventory(null), TypeError);
    assert.throws(() => Inventory.parseInventory("{"), SyntaxError);
    assert.throws(() => Inventory.parseInventory(JSON.stringify({...inventory(), extra: true})), TypeError);
    assert.throws(() => Inventory.parseInventory(JSON.stringify(inventory({generatedAt: 0}))), TypeError);
    assert.throws(() => Inventory.parseInventory(JSON.stringify(inventory({plugins: new Array(129).fill(plugin())}))), TypeError);
    assert.throws(() => Inventory.parseInventory(JSON.stringify({
        version: 1, status: "rejected", code: "rate-limit-exceeded", message: "slow down",
        method: "DescribePlugins",
    })), (error) => Refusal.refusalOf(error)?.method === "DescribePlugins");
});

test("event readiness fails closed at every live execution gate", () => {
    assert.deepEqual(Inventory.eventReadiness(inventory()), {available: true, detail: ""});
    const cases = [
        [inventory({plugins: []}), /install and configure/iu],
        [inventory({plugins: [plugin({source: "bundled"})]}), /external/iu],
        [inventory({plugins: [plugin({workerState: "starting"})]}), /configure and qualify/iu],
        [inventory({plugins: [plugin({protocol: {minimum: 1, maximum: 1, capabilities: ["health"]}})]}), /execute/iu],
        [inventory({plugins: [plugin({permissions: [{name: "files:read-selected", granted: false}]})]}), /grant access/iu],
        [inventory({plugins: [plugin({artifacts: [{id: "qwen-events", version: "1", format: "gguf", ready: false, reason: "model missing"}]})]}), /model missing/iu],
    ];
    for (const [document, pattern] of cases) {
        const readiness = Inventory.eventReadiness(document);
        assert.equal(readiness.available, false);
        assert.match(readiness.detail, pattern);
    }
    assert.throws(() => Inventory.eventReadiness({}), TypeError);
});

test("an artifact-free ready worker remains usable because startup qualified its provider", () => {
    const ready = Inventory.eventReadiness(inventory({plugins: [plugin({artifacts: []})]}));
    assert.deepEqual(ready, {available: true, detail: ""});
});

test("selected-document readiness independently requires its qualified external worker", () => {
    const documentPlugin = plugin({
        id: "ask-selected-files",
        distribution: "private-document-provider",
        artifacts: [],
    });
    assert.deepEqual(Inventory.documentQuestionReadiness(inventory({
        plugins: [documentPlugin],
    })), {available: true, detail: ""});
    const cases = [
        [[], /install and configure/iu],
        [[{...documentPlugin, source: "bundled"}], /external/iu],
        [[{...documentPlugin, workerState: "starting"}], /BGE and Qwen/iu],
        [[{...documentPlugin, protocol: {minimum: 1, maximum: 1, capabilities: ["health"]}}], /execute/iu],
        [[{...documentPlugin, permissions: [{name: "files:read-selected", granted: false}]}], /grant access/iu],
        [[{...documentPlugin, artifacts: [{
            id: "bge", version: "1", format: "ncnn", ready: false, reason: "BGE missing",
        }]}], /BGE missing/u],
        [[{...documentPlugin, artifacts: [{
            id: "bge", version: "1", format: "ncnn", ready: false, reason: "",
        }]}], /Install bge/u],
    ];
    for (const [plugins, pattern] of cases) {
        const readiness = Inventory.documentQuestionReadiness(inventory({plugins}));
        assert.equal(readiness.available, false);
        assert.match(readiness.detail, pattern);
    }
    assert.throws(() => Inventory.documentQuestionReadiness({}), /valid plug-in inventory/u);
});

test("selected-text readiness requires a qualified one-shot external worker", () => {
    const selectedTextPlugin = plugin({
        id: "selected-text-tools",
        version: "1.1.0",
        distribution: "private-selected-text-provider",
        artifacts: [],
        permissions: [{name: "clipboard:read-once", granted: true}],
    });
    assert.deepEqual(Inventory.selectedTextReadiness(inventory({
        plugins: [selectedTextPlugin],
    })), {available: true, detail: ""});
    const cases = [
        [[], /install and configure/iu],
        [[{...selectedTextPlugin, source: "bundled"}], /external/iu],
        [[{...selectedTextPlugin, version: "1.0.0"}], /operation-quality acceptance/iu],
        [[{...selectedTextPlugin, workerState: "starting"}], /GPU or NPU/iu],
        [[{...selectedTextPlugin,
            protocol: {minimum: 1, maximum: 1, capabilities: ["health"]}}], /execute/iu],
        [[{...selectedTextPlugin,
            permissions: [{name: "clipboard:read-once", granted: false}]}], /one-shot/iu],
        [[{...selectedTextPlugin, artifacts: [{
            id: "qwen3", version: "1", format: "gguf", ready: false, reason: "Qwen missing",
        }]}], /Qwen missing/u],
        [[{...selectedTextPlugin, artifacts: [{
            id: "qwen3", version: "1", format: "gguf", ready: false, reason: "",
        }]}], /Install qwen3/u],
    ];
    for (const [plugins, pattern] of cases) {
        const readiness = Inventory.selectedTextReadiness(inventory({plugins}));
        assert.equal(readiness.available, false);
        assert.match(readiness.detail, pattern);
    }
    assert.throws(() => Inventory.selectedTextReadiness({}), /valid plug-in inventory/u);
});

test("selected-text version gate fails closed below the quality-qualified release", () => {
    for (const value of [null, "", "1", "1.0", "1.0.0", "0.99.99", "01.1.0", "x.y.z"]) {
        assert.equal(Inventory.selectedTextVersionQualified(value), false, String(value));
    }
    for (const value of ["1.1.0", "1.2.3", "2.0.0", "999999.999999.999999"]) {
        assert.equal(Inventory.selectedTextVersionQualified(value), true, value);
    }
});

test("file-organizer readiness requires a qualified external review-only worker", () => {
    const organizerPlugin = plugin({
        id: "file-organizer",
        distribution: "private-file-organizer-provider",
        artifacts: [],
    });
    assert.deepEqual(Inventory.fileOrganizerReadiness(inventory({
        plugins: [organizerPlugin],
    })), {available: true, detail: ""});
    assert.deepEqual(Inventory.fileOrganizerReadiness(inventory({
        plugins: [plugin({source: "bundled"}), organizerPlugin],
    })), {available: true, detail: ""});
    const cases = [
        [[], /install and configure/iu],
        [[{...organizerPlugin, source: "bundled"}], /external/iu],
        [[{...organizerPlugin, workerState: "starting"}], /GPU or NPU/iu],
        [[{...organizerPlugin,
            protocol: {minimum: 1, maximum: 1, capabilities: ["health"]}}], /execute/iu],
        [[{...organizerPlugin,
            permissions: [{name: "files:read-selected", granted: false}]}], /grant access/iu],
        [[{...organizerPlugin, artifacts: [{
            id: "qwen3", version: "1", format: "gguf", ready: false, reason: "Qwen missing",
        }]}], /Qwen missing/u],
        [[{...organizerPlugin, artifacts: [{
            id: "qwen3", version: "1", format: "gguf", ready: false, reason: "",
        }]}], /Install qwen3/u],
    ];
    for (const [plugins, pattern] of cases) {
        const readiness = Inventory.fileOrganizerReadiness(inventory({plugins}));
        assert.equal(readiness.available, false);
        assert.match(readiness.detail, pattern);
    }
    assert.throws(() => Inventory.fileOrganizerReadiness({}), /valid plug-in inventory/u);
});

test("gateway validates replies and discards a superseded callback", () => {
    const callbacks = [];
    const cancellables = [];
    const gateway = new Inventory.PluginInventoryGateway({
        cancellableFactory() {
            const cancellable = {cancelled: false, cancel() { this.cancelled = true; }};
            cancellables.push(cancellable);
            return cancellable;
        },
        sendText(_options, callback) {
            callbacks.push(callback);
        },
    });
    const seen = [];
    gateway.describe((error, reply) => seen.push([error, reply]));
    gateway.describe((error, reply) => seen.push([error, reply]));
    assert.equal(cancellables[0].cancelled, true);
    callbacks[0](null, JSON.stringify(inventory()));
    callbacks[1](null, JSON.stringify(inventory()));
    assert.equal(seen.length, 1);
    assert.equal(seen[0][1].plugins[0].id, "event-extraction");
    assert.equal(gateway.cancel(), false);
});

test("gateway reports transport and contract failures and validates its port", () => {
    assert.throws(() => new Inventory.PluginInventoryGateway({}), TypeError);
    const errors = [];
    const gateway = new Inventory.PluginInventoryGateway({
        sendText(_options, callback) {
            callback(null, "{}");
        },
        cancellableFactory: null,
    });
    assert.throws(() => gateway.describe(null), TypeError);
    gateway.describe((error) => errors.push(error));
    assert.ok(RuntimeControl.isContractViolation(errors[0]));
    const broken = new Inventory.PluginInventoryGateway({sendText() { throw new Error("offline"); }});
    broken.describe((error) => errors.push(error));
    assert.match(String(errors[1]), /offline/u);
});

test("every protocol, artifact, permission, and identity boundary fails closed", () => {
    const protocolFaults = [
        null,
        {...plugin().protocol, extra: true},
        {...plugin().protocol, minimum: 0},
        {...plugin().protocol, minimum: 1.5},
        {...plugin().protocol, minimum: 65_536},
        {...plugin().protocol, maximum: 0},
        {...plugin().protocol, maximum: 65_536},
        {...plugin().protocol, maximum: 1.5},
        {...plugin().protocol, capabilities: null},
        {...plugin().protocol, capabilities: new Array(33).fill("execute")},
        {...plugin().protocol, capabilities: ["execute", "execute"]},
        {...plugin().protocol, capabilities: [""]},
        {...plugin().protocol, capabilities: ["x".repeat(65)]},
    ];
    assert.equal(protocolFaults.every((value) => !Inventory.validProtocol(value)), true);

    const artifact = plugin().artifacts[0];
    const artifactFaults = [
        null, {...artifact, extra: true}, {...artifact, id: ""}, {...artifact, id: "Bad"},
        {...artifact, id: "event-"},
        {...artifact, id: "x".repeat(121)}, {...artifact, version: ""},
        {...artifact, version: "x".repeat(41)}, {...artifact, format: ""},
        {...artifact, format: "x".repeat(41)}, {...artifact, ready: 1},
        {...artifact, reason: "x".repeat(241)},
    ];
    assert.equal(artifactFaults.every((value) => !Inventory.validArtifact(value)), true);

    const permission = plugin().permissions[0];
    const permissionFaults = [
        null, {...permission, extra: true}, {...permission, name: "x"},
        {...permission, name: "Bad:name"}, {...permission, name: "files:read selected"},
        {...permission, name: `files:${"x".repeat(155)}`},
        {...permission, granted: 1},
    ];
    assert.equal(permissionFaults.every((value) => !Inventory.validPermission(value)), true);

    const identityFaults = [
        null, {...plugin(), extra: true}, {...plugin(), id: ""}, {...plugin(), id: "Bad"},
        {...plugin(), id: "x".repeat(121)}, {...plugin(), version: ""},
        {...plugin(), version: "x".repeat(41)}, {...plugin(), source: "local"},
        {...plugin(), distribution: ""}, {...plugin(), distribution: "x".repeat(161)},
        {...plugin(), workerState: "unknown"},
    ];
    assert.equal(identityFaults.every((value) => !Inventory.validPlugin(value)), true);
    assert.equal(Inventory.exactRecord({a: 1, c: 2}, new Set(["a", "b"])), false);
    assert.equal(Inventory.validProtocol({
        minimum: 65_535,
        maximum: 65_535,
        capabilities: Array.from({length: 32}, (_item, index) => `cap-${index}`),
    }), true);
    assert.equal(Inventory.validArtifact({
        id: "event", version: "x".repeat(40), format: "x".repeat(40), ready: true, reason: "x".repeat(240),
    }), true);
    assert.equal(Inventory.validPermission({name: `a:${"x".repeat(158)}`, granted: true}), true);
});

test("every inventory collection and configuration boundary fails closed", () => {
    const faults = [
        {...plugin(), triggers: []},
        {...plugin(), triggers: new Array(9).fill("manual")},
        {...plugin(), triggers: ["manual", "manual"]},
        {...plugin(), triggers: ["unknown"]},
        {...plugin(), artifacts: null},
        {...plugin(), artifacts: new Array(17).fill(plugin().artifacts[0])},
        {...plugin(), artifacts: [{...plugin().artifacts[0], ready: 1}]},
        {...plugin(), permissions: null},
        {...plugin(), permissions: new Array(33).fill(plugin().permissions[0])},
        {...plugin(), permissions: [{name: "bad", granted: true}]},
        {...plugin(), configurationSchema: []},
        {...plugin(), configurationSchema: Object.fromEntries(new Array(65).fill(null).map((_item, index) => [`k${index}`, true]))},
        {...plugin(), secretConfigurationKeys: null},
        {...plugin(), secretConfigurationKeys: new Array(65).fill("secret")},
        {...plugin(), secretConfigurationKeys: ["secret", "secret"]},
        {...plugin(), secretConfigurationKeys: [""]},
        {...plugin(), secretConfigurationKeys: ["x".repeat(121)]},
    ];
    assert.equal(faults.every((value) => !Inventory.validPlugin(value)), true);

    for (const malformed of [
        null,
        {...inventory(), version: 2},
        {...inventory(), generatedAt: 1.5},
        {...inventory(), plugins: null},
        {...inventory(), plugins: [{...plugin(), protocol: null}]},
    ]) {
        assert.equal(Inventory.validInventory(malformed), false);
    }
    const maximumPlugin = plugin({
        triggers: ["manual", "periodic", "event"],
        artifacts: Array.from({length: 16}, (_item, index) => ({
            id: `model-${index}`, version: "1", format: "gguf", ready: true, reason: "",
        })),
        permissions: Array.from({length: 32}, (_item, index) => ({
            name: `files:item-${index}`, granted: true,
        })),
        configurationSchema: Object.fromEntries(Array.from({length: 64}, (_item, index) => [`k${index}`, true])),
        secretConfigurationKeys: Array.from({length: 64}, (_item, index) => `secret-${index}`),
    });
    assert.equal(Inventory.validPlugin(maximumPlugin), true);
    assert.equal(Inventory.validInventory(inventory({plugins: new Array(128).fill(maximumPlugin)})), true);
});

test("readiness explains empty artifact reasons and every non-event identity", () => {
    const missingArtifact = plugin({
        artifacts: [{id: "qwen-events", version: "1", format: "gguf", ready: false, reason: ""}],
    });
    assert.equal(Inventory.readinessDetail(missingArtifact), "Install qwen-events");
    assert.match(Inventory.eventReadiness(inventory({
        plugins: [plugin({id: "another-plugin"})],
    })).detail, /install and configure/iu);
});

test("gateway reports exact return and cancellation semantics", () => {
    const callbacks = [];
    const gateway = new Inventory.PluginInventoryGateway({
        sendText(options, callback) {
            assert.equal(options.cancellable, null);
            callbacks.push(callback);
        },
    });
    assert.equal(gateway.describe(() => {}), true);
    assert.equal(gateway.cancel(), true);
    assert.equal(gateway.cancel(), false);
    assert.equal(callbacks[0](null, JSON.stringify(inventory())), false);

    const transport = new Inventory.PluginInventoryGateway({
        sendText(_options, callback) { callback(new Error("offline"), null); },
    });
    let received = null;
    assert.equal(transport.describe((error, reply) => { received = [error, reply]; }), true);
    assert.match(String(received[0]), /offline/u);
    assert.equal(received[1], null);

    assert.equal(gateway._cancellableFactory(), null);
    const invalidFactory = new Inventory.PluginInventoryGateway({sendText() {}, cancellableFactory: null});
    assert.equal(invalidFactory._cancellableFactory(), null);
    gateway._pending = {sequence: 7, cancellable: null};
    gateway._sequence = 7;
    let completed = null;
    assert.equal(gateway._complete(7, (error, reply) => { completed = [error, reply]; }, null,
        JSON.stringify(inventory())), true);
    assert.equal(completed[0], null);
    assert.equal(completed[1].plugins[0].id, "event-extraction");
    assert.equal(gateway._complete(7, () => { throw new Error("stale callback"); }, null, "{}"), false);
});

test("mixed grants and invalid readiness fail with the exact boundary reason", () => {
    const mixed = Inventory.eventReadiness(inventory({plugins: [plugin({permissions: [
        {name: "files:read-selected", granted: true},
        {name: "calendar:write-new", granted: false},
    ]})]}));
    assert.deepEqual(mixed, {
        available: false,
        detail: "Grant access to the explicitly selected event files",
    });
    assert.throws(
        () => Inventory.eventReadiness({}),
        (error) => error instanceof TypeError
            && error.message === "Event readiness requires a valid plug-in inventory",
    );
});
