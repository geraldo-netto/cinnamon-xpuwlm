"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const Manifest = require("../../files/cinnamon-xpuwlm@geraldo-netto/lib/workload-manifest.js");
const Reconciliation = require("../../files/cinnamon-xpuwlm@geraldo-netto/lib/workload-reconciliation.js");
const Registry = require("../../files/cinnamon-xpuwlm@geraldo-netto/lib/workload-registry.js");
const ViewModel = require("../../files/cinnamon-xpuwlm@geraldo-netto/lib/view-model.js");
const Fixtures = require("../helpers/workload-manifest-fixtures.js");

function random(seed) {
    let state = seed >>> 0;
    return () => {
        state = ((state * 1664525) + 1013904223) >>> 0;
        return state / 0x100000000;
    };
}

test("fuzz: lifecycle reconciliation is idempotent across hostile persisted state", () => {
    const descriptors = Array.from({length: 12}, (_, index) => new Manifest.WorkloadDescriptor(
        Fixtures.validWorkloadManifest({id: `workload-${index}`, version: `${index}.0.0`}),
    ));
    const registry = new Registry.StaticWorkloadRegistry(descriptors);
    const next = random(0x39c0ffee);
    const hostile = [null, true, 1, "bad", [], {}, Number.NaN];

    for (let iteration = 0; iteration < 1000; iteration += 1) {
        const profiles = {};
        const pluginVersions = {};
        for (let index = 0; index < 20; index += 1) {
            const id = index < 12 ? `workload-${index}` : `removed-${index}`;
            profiles[id] = next() < 0.5
                ? {enabled: next() < 0.5, weight: Math.floor(next() * 10) - 2}
                : hostile[Math.floor(next() * hostile.length)];
            pluginVersions[id] = next() < 0.5 ? `${Math.floor(next() * 4)}.0.0` : null;
        }
        const first = Reconciliation.reconcilePortfolioState({
            paused: next() < 0.5,
            profiles,
            pluginVersions,
        }, registry);
        const second = Reconciliation.reconcilePortfolioState(first.state, registry);
        assert.equal(second.changed, false, `iteration ${iteration}`);
        assert.deepEqual(second.state, first.state, `iteration ${iteration}`);
        assert.deepEqual(
            Object.keys(first.state.profiles),
            descriptors.map((entry) => entry.id).sort(),
        );
    }
});

// The notice is the only place a plug-in change becomes visible, so it must
// account for every reported identifier and never invent one.
test("property: the catalog notice reports exactly the reconciled changes", () => {
    const next = random(0x5eedbead);
    const identifiers = Array.from({length: 8}, (_, index) => `workload-${index}`);

    for (let iteration = 0; iteration < 500; iteration += 1) {
        const changes = {installed: [], upgraded: [], removed: []};
        for (const id of identifiers) {
            const kind = ViewModel.CATALOG_CHANGE_KINDS[Math.floor(next() * 4)];
            if (kind !== undefined) {
                changes[kind].push(id);
            }
        }
        const total = changes.installed.length + changes.upgraded.length + changes.removed.length;
        const notice = ViewModel.catalogNoticeModel({profiles: [], catalogChanges: changes});
        if (total === 0) {
            assert.equal(notice, null, `iteration ${iteration}`);
            continue;
        }
        assert.equal(notice.title.startsWith(`${total} `), true, `iteration ${iteration}`);
        for (const id of identifiers) {
            assert.equal(notice.detail.includes(id), total > 0 && [
                ...changes.installed, ...changes.upgraded, ...changes.removed,
            ].includes(id), `iteration ${iteration} ${id}`);
        }
    }
});
