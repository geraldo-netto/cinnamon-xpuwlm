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
