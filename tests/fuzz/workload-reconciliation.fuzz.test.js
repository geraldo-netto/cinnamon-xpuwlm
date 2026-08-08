"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const Manifest = require("../../files/cinnamon-tpuwm@geraldo-netto/lib/workload-manifest.js");
const Reconciliation = require("../../files/cinnamon-tpuwm@geraldo-netto/lib/workload-reconciliation.js");
const Registry = require("../../files/cinnamon-tpuwm@geraldo-netto/lib/workload-registry.js");
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
