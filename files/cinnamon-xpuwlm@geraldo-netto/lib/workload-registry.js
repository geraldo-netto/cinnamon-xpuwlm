"use strict";

const Manifest = require("./workload-manifest.js");
const Validation = require("./validation.js");

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

// `onInvalid` selects the failure policy for one broken plug-in directory:
// bundled discovery omits it and fails loudly, user-supplied plug-in
// discovery reports the directory and continues, so one broken third-party
// manifest never takes down the built-in catalog.
class ManifestDirectoryRegistry {
    constructor({root, listDirectories, readText, onInvalid = null}) {
        requireDiscoveryPorts(listDirectories, readText);
        if (onInvalid !== null && typeof onInvalid !== "function") {
            throw new TypeError("The invalid-manifest handler must be a function");
        }
        this._root = String(root || "");
        this._listDirectories = listDirectories;
        this._readText = readText;
        this._onInvalid = onInvalid;
    }

    descriptors() {
        const directories = this._listDirectories(this._root);
        if (!Array.isArray(directories)) {
            throw new TypeError("Workload directory reader must return an array");
        }
        const names = [...new Set(directories)].sort(Validation.compareText);
        if (names.length !== directories.length || names.length > MAX_WORKLOADS) {
            throw new RangeError("Workload directories must be unique and bounded");
        }
        const descriptors = names
            .map((name) => this._guardedDescriptor(name))
            .filter((descriptor) => descriptor !== null);
        return [...validateDescriptors(descriptors)];
    }

    _guardedDescriptor(directoryName) {
        if (this._onInvalid === null) {
            return this._readDescriptor(directoryName);
        }
        try {
            return this._readDescriptor(directoryName);
        } catch (error) {
            this._onInvalid(directoryName, error);
            return null;
        }
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

// Combines the bundled catalog with user-installed plug-ins. Identity
// collisions resolve bundled-wins so a third-party directory can never
// shadow or replace a built-in workload; `onCollision` reports each shadowed
// identifier for the log.
class MergedWorkloadRegistry {
    constructor({primary, secondary, onCollision = null}) {
        this._primary = requireWorkloadRegistry(primary);
        this._secondary = requireWorkloadRegistry(secondary);
        if (onCollision !== null && typeof onCollision !== "function") {
            throw new TypeError("The collision handler must be a function");
        }
        this._onCollision = onCollision;
    }

    descriptors() {
        const merged = validateDescriptors(this._primary.descriptors()).slice();
        const known = new Set(merged.map((descriptor) => descriptor.id));
        for (const descriptor of validateDescriptors(this._secondary.descriptors())) {
            if (known.has(descriptor.id)) {
                if (this._onCollision !== null) {
                    this._onCollision(descriptor.id);
                }
                continue;
            }
            known.add(descriptor.id);
            merged.push(descriptor);
        }
        return [...validateDescriptors(merged)];
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
    MergedWorkloadRegistry,
    StaticWorkloadRegistry,
    compareProfileDefinitions,
    parseManifest,
    profileDefinitions,
    requireDiscoveryPorts,
    requireWorkloadRegistry,
    validateDescriptor,
    validateDescriptors,
};
