"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const Registry = require("../../files/cinnamon-tpuwm@geraldo-netto/lib/workload-registry.js");
const Fixtures = require("../helpers/workload-manifest-fixtures.js");

function shuffled(values, seed) {
    const result = [...values];
    let state = seed >>> 0;
    for (let index = result.length - 1; index > 0; index -= 1) {
        state = ((state * 1664525) + 1013904223) >>> 0;
        const target = state % (index + 1);
        [result[index], result[target]] = [result[target], result[index]];
    }
    return result;
}

test("property: discovery order never changes registry identity order", () => {
    const identifiers = Array.from({length: 32}, (_, index) => `workload-${index}`);
    for (let seed = 0; seed < 200; seed += 1) {
        const registry = new Registry.ManifestDirectoryRegistry({
            root: "/workloads",
            listDirectories: () => shuffled(identifiers, seed),
            readText: (source) => {
                const id = source.split("/").at(-2);
                return JSON.stringify(Fixtures.validWorkloadManifest({id}));
            },
        });
        assert.deepEqual(
            registry.descriptors().map((descriptor) => descriptor.id),
            [...identifiers].sort(),
        );
    }
});

test("property: merged discovery is bundled-authoritative for every collision pattern", () => {
    const bundledIds = Array.from({length: 12}, (_, index) => `bundled-${index}`);
    for (let seed = 1; seed <= 150; seed += 1) {
        let state = seed;
        const next = () => {
            state = ((state * 1664525) + 1013904223) >>> 0;
            return state;
        };
        const userIds = [...new Set(Array.from({length: next() % 12}, () => (
            next() % 2 === 0 ? bundledIds[next() % bundledIds.length] : `user-${next() % 12}`
        )))];
        const descriptorFor = (id, version) => new (require(
            "../../files/cinnamon-tpuwm@geraldo-netto/lib/workload-manifest.js",
        ).WorkloadDescriptor)(Fixtures.validWorkloadManifest({id, version}));
        const bundled = new Registry.StaticWorkloadRegistry(
            bundledIds.map((id) => descriptorFor(id, "1.0.0")),
        );
        const user = new Registry.StaticWorkloadRegistry(
            userIds.map((id) => descriptorFor(id, "2.0.0")),
        );
        const collisions = [];
        const merged = new Registry.MergedWorkloadRegistry({
            primary: bundled,
            secondary: user,
            onCollision: (id) => collisions.push(id),
        });
        const listed = merged.descriptors();
        const ids = listed.map((descriptor) => descriptor.id);
        assert.equal(new Set(ids).size, ids.length, "merged identities stay unique");
        assert.deepEqual(ids.slice(0, bundledIds.length), bundledIds, "bundled order is preserved");
        for (const descriptor of listed) {
            const expected = bundledIds.includes(descriptor.id) ? "1.0.0" : "2.0.0";
            assert.equal(descriptor.version, expected, `bundled wins for ${descriptor.id}`);
        }
        assert.deepEqual(
            [...collisions].sort(),
            userIds.filter((id) => bundledIds.includes(id)).sort(),
            "every shadowed user plug-in is reported",
        );
    }
});
