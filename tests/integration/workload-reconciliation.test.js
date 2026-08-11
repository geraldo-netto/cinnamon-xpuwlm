"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const Domain = require("../../files/cinnamon-xpuwlm@geraldo-netto/lib/domain.js");
const Manager = require("../../files/cinnamon-xpuwlm@geraldo-netto/lib/manager.js");
const Manifest = require("../../files/cinnamon-xpuwlm@geraldo-netto/lib/workload-manifest.js");
const Registry = require("../../files/cinnamon-xpuwlm@geraldo-netto/lib/workload-registry.js");
const Fixtures = require("../helpers/workload-manifest-fixtures.js");

function descriptor(id, version, defaults = {}) {
    const manifest = Fixtures.validWorkloadManifest({id, version});
    manifest.defaults = {...manifest.defaults, ...defaults};
    return new Manifest.WorkloadDescriptor(manifest);
}

function manager(repository) {
    return new Manager.WorkloadManager({
        repository,
        runtimeGateway: {
            read: (options, callback) => callback(Domain.unavailableSnapshot("offline", 1, "error")),
        },
        errorReporter: {report() {}, recover() {}},
        clock: {now: () => 1},
        workloadRegistry: new Registry.StaticWorkloadRegistry([
            descriptor("active", "2.0.0"),
            descriptor("installed", "1.0.0", {enabled: true, weight: 4}),
        ]),
    });
}

test("manager persists deterministic install, upgrade, and removal reconciliation", () => {
    const saves = [];
    const subject = manager({
        load: () => ({
            selectedTab: "profiles",
            portfolio: {
                paused: true,
                profiles: {
                    active: {enabled: false, weight: 5},
                    removed: {enabled: true, weight: 3},
                },
                pluginVersions: {active: "1.0.0", removed: "9.0.0"},
            },
        }),
        save: (state) => saves.push(state),
    });

    subject.start();

    assert.deepEqual(subject.state().profiles.map((profile) => ({
        id: profile.id,
        enabled: profile.enabled,
        weight: profile.weight,
    })), [
        {id: "active", enabled: false, weight: 5},
        {id: "installed", enabled: true, weight: 4},
    ]);
    assert.equal(subject.state().paused, true);
    assert.equal(saves.length, 1);
    assert.deepEqual(saves[0].portfolio, {
        paused: true,
        profiles: {
            active: {enabled: false, weight: 5},
            installed: {enabled: true, weight: 4},
        },
        pluginVersions: {active: "2.0.0", installed: "1.0.0"},
    });
});

test("manager does not rewrite an already reconciled portfolio", () => {
    const saves = [];
    const subject = manager({
        load: () => ({
            selectedTab: "overview",
            portfolio: {
                paused: false,
                profiles: {
                    active: {enabled: false, weight: 2},
                    installed: {enabled: true, weight: 4},
                },
                pluginVersions: {active: "2.0.0", installed: "1.0.0"},
            },
        }),
        save: (state) => saves.push(state),
    });

    subject.start();
    assert.deepEqual(saves, []);
});
