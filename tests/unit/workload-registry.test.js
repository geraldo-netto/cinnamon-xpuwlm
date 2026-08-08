"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const Manifest = require("../../files/cinnamon-tpuwm@geraldo-netto/lib/workload-manifest.js");
const Registry = require("../../files/cinnamon-tpuwm@geraldo-netto/lib/workload-registry.js");
const Fixtures = require("../helpers/workload-manifest-fixtures.js");

function descriptor(id = "sample-workload", version = "1.0.0") {
    return new Manifest.WorkloadDescriptor(Fixtures.validWorkloadManifest({id, version}));
}

test("registry port accepts only descriptor providers", () => {
    const registry = new Registry.StaticWorkloadRegistry([]);
    assert.equal(Registry.requireWorkloadRegistry(registry), registry);
    assert.throws(() => Registry.requireWorkloadRegistry(null), /registry/u);
    assert.throws(() => Registry.requireWorkloadRegistry({}), /registry/u);
    assert.throws(() => Registry.requireDiscoveryPorts(null, () => ""), /directory reader/u);
    assert.throws(() => Registry.requireDiscoveryPorts(() => [], null), /manifest reader/u);
});

test("static registry validates identity uniqueness and returns isolated lists", () => {
    const first = descriptor();
    const registry = new Registry.StaticWorkloadRegistry([first]);
    const listed = registry.descriptors();
    listed.pop();
    assert.deepEqual(registry.descriptors(), [first]);
    assert.throws(() => new Registry.StaticWorkloadRegistry([{}]), /descriptors/u);
    assert.throws(() => new Registry.StaticWorkloadRegistry([first, first]), /unique/u);
    assert.throws(
        () => new Registry.StaticWorkloadRegistry(Array(Registry.MAX_WORKLOADS + 1).fill(first)),
        /at most/u,
    );
});

test("directory registry discovers manifests in stable order through injected ports", () => {
    const reads = [];
    const manifests = {
        alpha: Fixtures.validWorkloadManifest({id: "alpha", version: "2.0.0"}),
        zebra: Fixtures.validWorkloadManifest({id: "zebra"}),
    };
    const registry = new Registry.ManifestDirectoryRegistry({
        root: "/workloads",
        listDirectories: () => ["zebra", "alpha"],
        readText: (source, maximumBytes) => {
            reads.push([source, maximumBytes]);
            const name = source.split("/").at(-2);
            return JSON.stringify(manifests[name]);
        },
    });

    assert.deepEqual(registry.descriptors().map((entry) => entry.id), ["alpha", "zebra"]);
    assert.deepEqual(reads, [
        ["/workloads/alpha/manifest.json", Registry.MAX_MANIFEST_BYTES],
        ["/workloads/zebra/manifest.json", Registry.MAX_MANIFEST_BYTES],
    ]);
    assert.deepEqual(Registry.profileDefinitions(registry).map((entry) => entry.id), ["alpha", "zebra"]);
    assert.equal(Object.isFrozen(Registry.profileDefinitions(registry)), true);
});

test("directory registry normalizes an absent root", () => {
    const roots = [];
    const registry = new Registry.ManifestDirectoryRegistry({
        listDirectories: (root) => {
            roots.push(root);
            return [];
        },
        readText: () => "",
    });

    assert.deepEqual(registry.descriptors(), []);
    assert.deepEqual(roots, [""]);
});

test("profile definitions use declarative order with stable identity fallback", () => {
    const first = descriptor("first");
    const secondManifest = Fixtures.validWorkloadManifest({id: "second"});
    secondManifest.ui.order = 5;
    const second = new Manifest.WorkloadDescriptor(secondManifest);
    const definitions = Registry.profileDefinitions(new Registry.StaticWorkloadRegistry([first, second]));
    assert.deepEqual(definitions.map((definition) => definition.id), ["second", "first"]);
    assert.ok(Registry.compareProfileDefinitions(
        {...definitions[0], id: "z", order: 10},
        {...definitions[0], id: "a", order: 10},
    ) > 0);
});

test("directory registry rejects malformed discovery results", () => {
    const base = {
        root: "/workloads",
        listDirectories: () => ["sample-workload"],
        readText: () => JSON.stringify(Fixtures.validWorkloadManifest()),
    };
    assert.throws(
        () => new Registry.ManifestDirectoryRegistry({...base, listDirectories: () => null}).descriptors(),
        /array/u,
    );
    assert.throws(
        () => new Registry.ManifestDirectoryRegistry({...base, listDirectories: () => ["same", "same"]}).descriptors(),
        /unique/u,
    );
    assert.throws(
        () => new Registry.ManifestDirectoryRegistry({...base, listDirectories: () => Array.from(
            {length: Registry.MAX_WORKLOADS + 1},
            (_, index) => `item-${index}`,
        )}).descriptors(),
        /bounded/u,
    );
    assert.throws(
        () => new Registry.ManifestDirectoryRegistry({...base, listDirectories: () => ["Bad"]}).descriptors(),
        /directory name/u,
    );
    assert.throws(
        () => new Registry.ManifestDirectoryRegistry({...base, readText: () => 4}).descriptors(),
        /not text/u,
    );
    assert.throws(
        () => new Registry.ManifestDirectoryRegistry({...base, readText: () => "{"}).descriptors(),
        /invalid JSON/u,
    );
    assert.throws(
        () => new Registry.ManifestDirectoryRegistry({...base, readText: () => "{}"}).descriptors(),
        /version 1 contract/u,
    );
    assert.throws(
        () => new Registry.ManifestDirectoryRegistry({
            ...base,
            readText: () => JSON.stringify(Fixtures.validWorkloadManifest({id: "different"})),
        }).descriptors(),
        /does not match/u,
    );
});
