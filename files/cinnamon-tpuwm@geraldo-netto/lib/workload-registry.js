"use strict";

const Manifest = require("./workload-manifest.js");

const MAX_MANIFEST_BYTES = 64 * 1024;
const MAX_WORKLOADS = 128;

function requireWorkloadRegistry(candidate) {
    if (!candidate || typeof candidate.descriptors !== "function") {
        throw new TypeError("A workload registry with descriptors is required");
    }
    return candidate;
}

function requireDiscoveryPorts(listDirectories, readText) {
    if (typeof listDirectories !== "function") {
        throw new TypeError("A workload directory reader is required");
    }
    if (typeof readText !== "function") {
        throw new TypeError("A workload manifest reader is required");
    }
}

function validateDescriptor(candidate) {
    if (!(candidate instanceof Manifest.WorkloadDescriptor)) {
        throw new TypeError("Registry entries must be workload descriptors");
    }
    return candidate;
}

function validateDescriptors(candidates) {
    if (!Array.isArray(candidates) || candidates.length > MAX_WORKLOADS) {
        throw new RangeError(`A registry may contain at most ${MAX_WORKLOADS} workloads`);
    }
    const descriptors = candidates.map(validateDescriptor);
    const identifiers = descriptors.map((descriptor) => descriptor.id);
    if (new Set(identifiers).size !== identifiers.length) {
        throw new RangeError("Workload registry identifiers must be unique");
    }
    return Object.freeze([...descriptors]);
}

function parseManifest(text, source) {
    if (text === null) {
        throw new RangeError(`Workload manifest is missing: ${source}`);
    }
    if (typeof text !== "string") {
        throw new TypeError(`Workload manifest is not text: ${source}`);
    }
    let candidate;
    try {
        candidate = JSON.parse(text);
    } catch {
        throw new SyntaxError(`Workload manifest contains invalid JSON: ${source}`);
    }
    return new Manifest.WorkloadDescriptor(candidate);
}

class StaticWorkloadRegistry {
    constructor(descriptors) {
        this._descriptors = validateDescriptors(descriptors);
    }

    descriptors() {
        return [...this._descriptors];
    }
}

class ManifestDirectoryRegistry {
    constructor({root, listDirectories, readText}) {
        requireDiscoveryPorts(listDirectories, readText);
        this._root = String(root || "");
        this._listDirectories = listDirectories;
        this._readText = readText;
    }

    descriptors() {
        const directories = this._listDirectories(this._root);
        if (!Array.isArray(directories)) {
            throw new TypeError("Workload directory reader must return an array");
        }
        const names = [...new Set(directories)].sort();
        if (names.length !== directories.length || names.length > MAX_WORKLOADS) {
            throw new RangeError("Workload directories must be unique and bounded");
        }
        const descriptors = names.map((name) => this._readDescriptor(name));
        return [...validateDescriptors(descriptors)];
    }

    _readDescriptor(directoryName) {
        if (!Manifest.identifier(directoryName)) {
            throw new RangeError(`Invalid workload directory name: ${directoryName}`);
        }
        const source = `${this._root}/${directoryName}/manifest.json`;
        const descriptor = parseManifest(this._readText(source, MAX_MANIFEST_BYTES), source);
        if (descriptor.id !== directoryName) {
            throw new RangeError(`Workload manifest identity does not match directory: ${source}`);
        }
        return descriptor;
    }
}

function profileDefinitions(registry) {
    const descriptors = validateDescriptors(requireWorkloadRegistry(registry).descriptors());
    return Object.freeze(descriptors
        .map((descriptor) => descriptor.profileDefinition())
        .sort(compareProfileDefinitions));
}

function compareProfileDefinitions(left, right) {
    return (left.order - right.order) || left.id.localeCompare(right.id);
}

module.exports = {
    MAX_MANIFEST_BYTES,
    MAX_WORKLOADS,
    ManifestDirectoryRegistry,
    StaticWorkloadRegistry,
    compareProfileDefinitions,
    parseManifest,
    profileDefinitions,
    requireDiscoveryPorts,
    requireWorkloadRegistry,
    validateDescriptor,
    validateDescriptors,
};
