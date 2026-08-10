"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const BuiltIns = require("../helpers/built-in-workloads.js");

const EXPECTED_IDENTIFIERS = [
    "build-advisor",
    "desktop-context",
    "document-intelligence",
    "hardware-health",
    "network-peripherals",
    "resource-scheduler",
    "storage-intelligence",
    "visual-library",
];
const EXPECTED_UI_ORDER = [
    "hardware-health",
    "storage-intelligence",
    "resource-scheduler",
    "build-advisor",
    "visual-library",
    "network-peripherals",
    "desktop-context",
    "document-intelligence",
];

test("all eight built-in workloads are independent valid descriptors", () => {
    const descriptors = BuiltIns.coreDescriptors();
    assert.deepEqual(descriptors.map((descriptor) => descriptor.id), EXPECTED_IDENTIFIERS);
    assert.equal(descriptors.length, 8);
    assert.equal(descriptors.every((descriptor) => descriptor.manifest().manifestVersion === 1), true);
    assert.equal(new Set(descriptors.map((descriptor) => descriptor.manifest())).size, 8);
});

test("built-in registry projects complete domain defaults without fixed ordering knowledge", () => {
    const catalog = BuiltIns.coreCatalog();
    assert.equal(catalog.size, EXPECTED_IDENTIFIERS.length);
    assert.deepEqual(
        catalog.definitions().map((definition) => definition.id),
        EXPECTED_UI_ORDER,
    );
    assert.equal(catalog.definitions().filter((definition) => definition.defaultEnabled).length, 5);
});

// The runtime refuses to build a pipeline for a profile with no model
// (`profile-has-no-model`), so what the catalog can actually run is a fact the
// applet must carry, not an assumption the popup makes.
test("the shipped catalog reports which workloads the runtime can execute", () => {
    const descriptors = BuiltIns.descriptors();
    const executable = descriptors.filter((descriptor) => descriptor.executable);
    assert.deepEqual(
        executable.map((descriptor) => descriptor.id),
        ["low-light-enhancement", "visual-library"],
        "only the workloads that declare a model can run",
    );
    for (const descriptor of descriptors) {
        assert.equal(
            descriptor.profileDefinition().executable,
            descriptor.manifest().requirements.model !== null,
            descriptor.id,
        );
    }
    assert.deepEqual(
        BuiltIns.coreCatalog().definitions()
            .filter((definition) => definition.executable)
            .map((definition) => definition.id),
        ["visual-library"],
        "visual-library is the one core workload the runtime has a model for",
    );
});
