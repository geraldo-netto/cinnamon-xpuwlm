"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const Manifest = require("../../files/cinnamon-tpuwm@geraldo-netto/lib/workload-manifest.js");
const Reconciliation = require("../../files/cinnamon-tpuwm@geraldo-netto/lib/workload-reconciliation.js");
const Registry = require("../../files/cinnamon-tpuwm@geraldo-netto/lib/workload-registry.js");
const Domain = require("../../files/cinnamon-tpuwm@geraldo-netto/lib/domain.js");
const FailureBackoff = require("../../files/cinnamon-tpuwm@geraldo-netto/lib/failure-log-backoff.js");
const Manager = require("../../files/cinnamon-tpuwm@geraldo-netto/lib/manager.js");
const ViewModel = require("../../files/cinnamon-tpuwm@geraldo-netto/lib/view-model.js");
const Fixtures = require("../helpers/workload-manifest-fixtures.js");

const NOW = 1_700_000_000_000;

function descriptor(id, version = "1.0.0", order = 10) {
    const manifest = Fixtures.validWorkloadManifest({id, version});
    manifest.ui = {...manifest.ui, order};
    return new Manifest.WorkloadDescriptor(manifest);
}

function mergedRegistry(userDescriptors) {
    return new Registry.MergedWorkloadRegistry({
        primary: new Registry.StaticWorkloadRegistry([descriptor("bundled-workload", "1.0.0", 10)]),
        secondary: new Registry.StaticWorkloadRegistry(userDescriptors),
    });
}

// Installing a user plug-in extends the catalog; removing its directory must
// drop its persisted state on the next reconciliation instead of leaving a
// stale profile behind, and the bundled catalog must survive both steps.
test("regression: user plug-in install and removal reconcile without residue", () => {
    const withUser = Reconciliation.reconcilePortfolioState(
        null,
        mergedRegistry([descriptor("user-workload", "2.0.0", 20)]),
    );
    assert.deepEqual(Object.keys(withUser.state.profiles).sort(), [
        "bundled-workload", "user-workload",
    ]);
    assert.deepEqual(withUser.changes.installed.slice().sort(), [
        "bundled-workload", "user-workload",
    ]);
    assert.equal(withUser.state.pluginVersions["user-workload"], "2.0.0");

    const afterRemoval = Reconciliation.reconcilePortfolioState(
        withUser.state,
        mergedRegistry([]),
    );
    assert.deepEqual(Object.keys(afterRemoval.state.profiles), ["bundled-workload"]);
    assert.deepEqual(afterRemoval.changes.removed, ["user-workload"]);
    assert.equal(afterRemoval.changed, true);
    assert.equal(Object.hasOwn(afterRemoval.state.pluginVersions, "user-workload"), false);
});

test("regression: a user plug-in upgrade is reported without touching bundled state", () => {
    const initial = Reconciliation.reconcilePortfolioState(
        null,
        mergedRegistry([descriptor("user-workload", "2.0.0", 20)]),
    );
    const upgraded = Reconciliation.reconcilePortfolioState(
        initial.state,
        mergedRegistry([descriptor("user-workload", "2.1.0", 20)]),
    );
    assert.deepEqual(upgraded.changes.upgraded, ["user-workload"]);
    assert.deepEqual(upgraded.changes.removed, []);
    assert.equal(upgraded.state.pluginVersions["bundled-workload"], "1.0.0");
    assert.equal(upgraded.state.pluginVersions["user-workload"], "2.1.0");
});

// A user plug-in that reuses a bundled identifier must never replace the
// bundled workload's definition in the reconciled catalog.
test("regression: a shadowing user plug-in cannot alter the bundled catalog", () => {
    const shadowed = Reconciliation.reconcilePortfolioState(
        null,
        mergedRegistry([descriptor("bundled-workload", "9.9.9", 30)]),
    );
    assert.deepEqual(Object.keys(shadowed.state.profiles), ["bundled-workload"]);
    assert.equal(shadowed.state.pluginVersions["bundled-workload"], "1.0.0");
});

function titledDescriptor(id, title, version = "1.0.0", order = 10) {
    const manifest = Fixtures.validWorkloadManifest({id, version});
    manifest.ui = {...manifest.ui, title, order};
    return new Manifest.WorkloadDescriptor(manifest);
}

// Reconciliation computed installs, upgrades, and removals and then dropped
// them, so a user plug-in could appear or vanish without the applet ever
// saying so. The change must reach the popup as readable text.
test("regression: user plug-in lifecycle changes reach the popup instead of being dropped", () => {
    const bundled = titledDescriptor("bundled-workload", "Bundled workload", "1.0.0", 10);
    const saved = {
        selectedTab: "overview",
        portfolio: {
            paused: false,
            profiles: {
                "bundled-workload": {enabled: false, weight: 2},
                "retired-workload": {enabled: true, weight: 3},
            },
            pluginVersions: {"bundled-workload": "1.0.0", "retired-workload": "1.0.0"},
        },
    };
    const manager = new Manager.WorkloadManager({
        repository: {load: () => structuredClone(saved), save() {}},
        runtimeGateway: {read: (options, callback) => callback(Domain.unavailableSnapshot("no device", NOW))},
        errorReporter: new FailureBackoff.FailureErrorBackoff({logger: {error() {}}}),
        clock: {now: () => NOW},
        workloadRegistry: new Registry.MergedWorkloadRegistry({
            primary: new Registry.StaticWorkloadRegistry([bundled]),
            secondary: new Registry.StaticWorkloadRegistry([
                titledDescriptor("user-workload", "User workload", "2.0.0", 20),
            ]),
        }),
    });
    manager.start();

    const notice = ViewModel.toViewModel(manager.state(), NOW).catalogNotice;
    assert.equal(notice.title, "2 workload plug-ins changed");
    assert.equal(notice.detail, "Installed: User workload · Removed: retired-workload");

    manager.acknowledgeCatalogChanges();
    assert.equal(ViewModel.toViewModel(manager.state(), NOW).catalogNotice, null);
});
