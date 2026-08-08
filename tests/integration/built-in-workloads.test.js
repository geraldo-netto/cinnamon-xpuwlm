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
