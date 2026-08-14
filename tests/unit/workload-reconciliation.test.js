"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const Manifest = require("../../files/cinnamon-xpuwlm@geraldo-netto/lib/workload-manifest.js");
const Reconciliation = require("../../files/cinnamon-xpuwlm@geraldo-netto/lib/workload-reconciliation.js");
const Registry = require("../../files/cinnamon-xpuwlm@geraldo-netto/lib/workload-registry.js");
const Fixtures = require("../helpers/workload-manifest-fixtures.js");

function descriptor(id, version, defaults = {}) {
    const manifest = Fixtures.validWorkloadManifest({id, version});
    manifest.defaults = {...manifest.defaults, ...defaults};
    return new Manifest.WorkloadDescriptor(manifest);
}

function registry(entries) {
    return new Registry.StaticWorkloadRegistry(entries);
}

test("install reconciliation adds deterministic defaults and versions", () => {
    const result = Reconciliation.reconcilePortfolioState(null, registry([
        descriptor("beta", "2.0.0", {enabled: true, weight: 4}),
        descriptor("alpha", "1.0.0", {enabled: false, weight: 1}),
    ]));
    assert.deepEqual(result.state, {
        paused: false,
        profiles: {
            alpha: {enabled: false, weight: 1},
            beta: {enabled: true, weight: 4},
        },
        deviceChoices: {},
        pluginVersions: {alpha: "1.0.0", beta: "2.0.0"},
    });
    assert.deepEqual(result.changes, {
        installed: ["alpha", "beta"],
        upgraded: [],
        removed: [],
    });
    assert.equal(result.changed, true);
    assert.equal(Object.isFrozen(result.changes.installed), true);
    assert.equal(result.firstRun, true);
});

// A first run has no catalog to compare against, so its wholesale install is
// not reportable news; anything persisted afterwards is.
test("a persisted catalog is what makes later changes reportable", () => {
    assert.equal(Reconciliation.hasPersistedCatalog(null), false);
    assert.equal(Reconciliation.hasPersistedCatalog({}), false);
    assert.equal(Reconciliation.hasPersistedCatalog({profiles: {}, pluginVersions: {}}), false);
    assert.equal(Reconciliation.hasPersistedCatalog({profiles: {alpha: {}}}), true);
    assert.equal(Reconciliation.hasPersistedCatalog({pluginVersions: {alpha: "1.0.0"}}), true);

    const workloadRegistry = registry([descriptor("alpha", "1.0.0")]);
    assert.equal(Reconciliation.reconcilePortfolioState(null, workloadRegistry).firstRun, true);
    assert.equal(Reconciliation.reconcilePortfolioState({
        paused: false,
        profiles: {alpha: {enabled: false, weight: 1}},
        pluginVersions: {alpha: "0.9.0"},
    }, workloadRegistry).firstRun, false);
});

test("enable, disable, and upgrade preserve compatible preferences", () => {
    const result = Reconciliation.reconcilePortfolioState({
        paused: true,
        profiles: {
            alpha: {enabled: true, weight: 5},
            beta: {enabled: false, weight: 3},
        },
        deviceChoices: {alpha: "gpu-renderD128", removed: "gpu-renderD129"},
        pluginVersions: {alpha: "1.0.0", beta: "1.0.0"},
    }, registry([
        descriptor("alpha", "2.0.0"),
        descriptor("beta", "1.0.0"),
    ]));
    assert.equal(result.state.paused, true);
    assert.deepEqual(result.state.profiles.alpha, {enabled: true, weight: 5});
    assert.deepEqual(result.state.profiles.beta, {enabled: false, weight: 3});
    assert.deepEqual(result.state.deviceChoices, {alpha: "gpu-renderD128"});
    assert.deepEqual(result.changes, {installed: [], upgraded: ["alpha"], removed: []});
    assert.deepEqual(result.state.pluginVersions, {alpha: "2.0.0", beta: "1.0.0"});
});

test("removal drops unknown preferences and versions without affecting known state", () => {
    const result = Reconciliation.reconcilePortfolioState({
        paused: false,
        profiles: {
            active: {enabled: false, weight: 4},
            removed: {enabled: true, weight: 5},
        },
        pluginVersions: {active: "1.0.0", removed: "9.0.0", orphan: "1.0.0"},
        deviceChoices: {active: "gpu-renderD128", removed: "gpu-renderD129"},
    }, registry([descriptor("active", "1.0.0")]));
    assert.deepEqual(result.state.profiles, {active: {enabled: false, weight: 4}});
    assert.deepEqual(result.state.pluginVersions, {active: "1.0.0"});
    assert.deepEqual(result.state.deviceChoices, {active: "gpu-renderD128"});
    assert.deepEqual(result.changes, {
        installed: [],
        upgraded: [],
        removed: ["orphan", "removed"],
    });
});

test("an already reconciled state is idempotent", () => {
    const workloadRegistry = registry([descriptor("active", "1.0.0")]);
    const first = Reconciliation.reconcilePortfolioState(null, workloadRegistry);
    const second = Reconciliation.reconcilePortfolioState(first.state, workloadRegistry);
    assert.equal(first.changed, true);
    assert.equal(second.changed, false);
    assert.deepEqual(second.changes, {installed: [], upgraded: [], removed: []});
    assert.equal(Reconciliation.sameState(second.state, first.state), true);
    assert.equal(Reconciliation.sameState(second.state, {...first.state, paused: true}), false);
    assert.deepEqual(Reconciliation.versionMap(workloadRegistry.descriptors()), {active: "1.0.0"});
    assert.deepEqual(Reconciliation.persistedProfiles(null), {});
    assert.deepEqual(Reconciliation.persistedVersions(null), {});
    assert.deepEqual(Reconciliation.findInstallAndUpgrade({}, {}, {active: "1.0.0"}), {
        installed: ["active"],
        upgraded: [],
    });
});
