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

test("directory registry skips invalid plug-ins only through the injected handler", () => {
    const manifests = {
        "good-workload": JSON.stringify(Fixtures.validWorkloadManifest({id: "good-workload"})),
        "broken-workload": "{not json",
        "mismatched-workload": JSON.stringify(Fixtures.validWorkloadManifest({id: "other-id"})),
    };
    const ports = {
        root: "/user-plugins",
        listDirectories: () => Object.keys(manifests),
        readText: (source) => manifests[source.split("/").at(-2)],
    };
    const strict = new Registry.ManifestDirectoryRegistry(ports);
    assert.throws(() => strict.descriptors(), /invalid JSON/u);

    const skipped = [];
    const lenient = new Registry.ManifestDirectoryRegistry({
        ...ports,
        onInvalid: (name, error) => skipped.push([name, String(error)]),
    });
    assert.deepEqual(lenient.descriptors().map((entry) => entry.id), ["good-workload"]);
    assert.deepEqual(skipped.map(([name]) => name), ["broken-workload", "mismatched-workload"]);
    assert.match(skipped[0][1], /invalid JSON/u);
    assert.match(skipped[1][1], /does not match directory/u);
    assert.throws(
        () => new Registry.ManifestDirectoryRegistry({...ports, onInvalid: "log"}),
        /handler/u,
    );
});

test("merged registry keeps bundled identities and appends unique user plug-ins", () => {
    const bundled = new Registry.StaticWorkloadRegistry([
        descriptor("hardware-health", "3.0.0"),
        descriptor("desktop-context"),
    ]);
    const user = new Registry.StaticWorkloadRegistry([
        descriptor("hardware-health", "9.9.9"),
        descriptor("custom-workload"),
    ]);
    const collisions = [];
    const merged = new Registry.MergedWorkloadRegistry({
        primary: bundled,
        secondary: user,
        onCollision: (id) => collisions.push(id),
    });
    const listed = merged.descriptors();
    assert.deepEqual(listed.map((entry) => entry.id), [
        "hardware-health", "desktop-context", "custom-workload",
    ]);
    assert.equal(listed[0].version, "3.0.0", "bundled wins identity collisions");
    assert.deepEqual(collisions, ["hardware-health"]);

    const silent = new Registry.MergedWorkloadRegistry({primary: bundled, secondary: user});
    assert.equal(silent.descriptors().length, 3);
    assert.throws(() => new Registry.MergedWorkloadRegistry({primary: bundled, secondary: null}), /registry/u);
    assert.throws(
        () => new Registry.MergedWorkloadRegistry({primary: bundled, secondary: user, onCollision: 1}),
        /handler/u,
    );
});

test("merged registry stays bounded across both catalogs", () => {
    const half = Math.ceil((Registry.MAX_WORKLOADS + 1) / 2);
    const many = (prefix) => new Registry.StaticWorkloadRegistry(
        Array.from({length: half}, (unused, index) => descriptor(`${prefix}-${index}`)),
    );
    const merged = new Registry.MergedWorkloadRegistry({
        primary: many("bundled"),
        secondary: many("user"),
    });
    assert.throws(() => merged.descriptors(), /at most/u);
});
