"use strict";

// Strict client for OmniTensor's read-only plug-in inventory. A workload is
// exposed only when the live external worker says it is ready, speaks the
// execution capability, has every declared grant, and has every declared
// artifact. Provider qualification happens before that worker can become
// ready; Cinnamon never guesses readiness from a packaged template.

const Contract = require("./runtime-control-contract.js");
const Refusal = require("./runtime-refusal-contract.js");

const INVENTORY_VERSION = 1;
const MAX_PLUGINS = 128;
const PLUGIN_FIELDS = new Set([
    "id", "version", "source", "distribution", "workerState", "protocol", "triggers",
    "artifacts", "permissions", "configurationSchema", "secretConfigurationKeys",
]);
const PROTOCOL_FIELDS = new Set(["minimum", "maximum", "capabilities"]);
const ARTIFACT_FIELDS = new Set(["id", "version", "format", "ready", "reason"]);
const PERMISSION_FIELDS = new Set(["name", "granted"]);
const WORKER_STATES = new Set([
    "starting", "ready", "failed", "exited", "restarting", "exhausted", "stopped", null,
]);
const IDENTIFIER = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const PERMISSION = /^[a-z][a-z0-9-]*:[a-zA-Z0-9*._/-]+$/u;
const SEMANTIC_VERSION = /^(0|[1-9]\d{0,5})\.(0|[1-9]\d{0,5})\.(0|[1-9]\d{0,5})$/u;
const contractViolation = Contract.contractViolation;

function isRecord(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value);
}

function exactRecord(value, fields) {
    return isRecord(value)
        && Object.keys(value).length === fields.size
        && Object.keys(value).every((name) => fields.has(name));
}

function boundedText(value, minimum, maximum) {
    return typeof value === "string" && [...value].length >= minimum && [...value].length <= maximum;
}

function uniqueStrings(value, maximumItems, maximumLength, allowed = null) {
    return Array.isArray(value)
        && value.length <= maximumItems
        && value.every((item) => boundedText(item, 1, maximumLength))
        && (allowed === null || value.every((item) => allowed.has(item)))
        && new Set(value).size === value.length;
}

function validProtocol(value) {
    return exactRecord(value, PROTOCOL_FIELDS)
        && Number.isInteger(value.minimum)
        && value.minimum >= 1
        && value.minimum <= 65_535
        && Number.isInteger(value.maximum)
        && value.maximum >= value.minimum
        && value.maximum <= 65_535
        && uniqueStrings(value.capabilities, 32, 64);
}

function validArtifact(value) {
    return exactRecord(value, ARTIFACT_FIELDS)
        && boundedText(value.id, 1, 120)
        && IDENTIFIER.test(value.id)
        && boundedText(value.version, 1, 40)
        && boundedText(value.format, 1, 40)
        && typeof value.ready === "boolean"
        && boundedText(value.reason, 0, 240);
}

function validPermission(value) {
    return exactRecord(value, PERMISSION_FIELDS)
        && boundedText(value.name, 3, 160)
        && PERMISSION.test(value.name)
        && typeof value.granted === "boolean";
}

function validPluginIdentity(value) {
    return exactRecord(value, PLUGIN_FIELDS)
        && boundedText(value.id, 1, 120)
        && IDENTIFIER.test(value.id)
        && boundedText(value.version, 1, 40)
        && ["bundled", "external"].includes(value.source)
        && boundedText(value.distribution, 1, 160)
        && WORKER_STATES.has(value.workerState);
}

function validPluginCollections(value) {
    return uniqueStrings(value.triggers, 8, 8, new Set(["manual", "periodic", "event"]))
        && value.triggers.length >= 1
        && Array.isArray(value.artifacts)
        && value.artifacts.length <= 16
        && value.artifacts.every(validArtifact)
        && Array.isArray(value.permissions)
        && value.permissions.length <= 32
        && value.permissions.every(validPermission);
}

function validPluginConfiguration(value) {
    return isRecord(value.configurationSchema)
        && Object.keys(value.configurationSchema).length <= 64
        && uniqueStrings(value.secretConfigurationKeys, 64, 120);
}

function validPlugin(value) {
    return validPluginIdentity(value)
        && validProtocol(value.protocol)
        && validPluginCollections(value)
        && validPluginConfiguration(value);
}

function validInventory(value) {
    return exactRecord(value, new Set(["version", "generatedAt", "plugins"]))
        && value.version === INVENTORY_VERSION
        && Number.isInteger(value.generatedAt)
        && value.generatedAt >= 1
        && Array.isArray(value.plugins)
        && value.plugins.length <= MAX_PLUGINS
        && value.plugins.every(validPlugin);
}

function parseInventory(text) {
    if (typeof text !== "string") {
        throw contractViolation(TypeError, "Runtime plug-in inventory is not text");
    }
    let reply;
    try {
        reply = JSON.parse(text);
    } catch {
        throw contractViolation(SyntaxError, "Runtime plug-in inventory contains invalid JSON");
    }
    if (Refusal.isRuntimeRefusal(reply)) {
        throw new Refusal.RuntimeRefusedError(reply);
    }
    if (!validInventory(reply)) {
        throw contractViolation(TypeError, "Runtime plug-in inventory does not match version 1 contract");
    }
    return reply;
}

function readinessDetail(plugin) {
    if (plugin === null) {
        return "Install and configure the event-extraction provider";
    }
    if (plugin.source !== "external") {
        return "Install an external event-extraction provider";
    }
    if (plugin.workerState !== "ready") {
        return "Configure and qualify an event model provider";
    }
    if (!plugin.protocol.capabilities.includes("execute")) {
        return "Update the event provider to one that can execute workloads";
    }
    if (plugin.permissions.some((permission) => !permission.granted)) {
        return "Grant access to the explicitly selected event files";
    }
    const missing = plugin.artifacts.find((artifact) => !artifact.ready);
    return missing ? missing.reason || `Install ${missing.id}` : "";
}

function eventReadiness(inventory) {
    if (!validInventory(inventory)) {
        throw new TypeError("Event readiness requires a valid plug-in inventory");
    }
    const plugin = inventory.plugins.find((candidate) => candidate.id === "event-extraction") || null;
    const detail = readinessDetail(plugin);
    return Object.freeze({available: detail === "", detail});
}

function documentReadinessDetail(plugin) {
    if (plugin === null) {
        return "Install and configure the ask-selected-files provider";
    }
    if (plugin.source !== "external") {
        return "Install an external selected-document provider";
    }
    if (plugin.workerState !== "ready") {
        return "Configure and qualify BGE and Qwen model providers";
    }
    if (!plugin.protocol.capabilities.includes("execute")) {
        return "Update the selected-document provider to one that can execute workloads";
    }
    if (plugin.permissions.some((permission) => !permission.granted)) {
        return "Grant access to explicitly selected document files";
    }
    const missing = plugin.artifacts.find((artifact) => !artifact.ready);
    return missing ? missing.reason || `Install ${missing.id}` : "";
}

function documentQuestionReadiness(inventory) {
    if (!validInventory(inventory)) {
        throw new TypeError("Document readiness requires a valid plug-in inventory");
    }
    const plugin = inventory.plugins.find((candidate) => candidate.id === "ask-selected-files") || null;
    const detail = documentReadinessDetail(plugin);
    return Object.freeze({available: detail === "", detail});
}

function selectedTextReadinessDetail(plugin) {
    if (plugin === null) {
        return "Install and configure a selected-text provider";
    }
    const providerDetail = selectedTextProviderDetail(plugin);
    if (providerDetail !== "") {
        return providerDetail;
    }
    if (plugin.workerState !== "ready") {
        return "Configure and qualify a GPU or NPU generation provider";
    }
    if (!plugin.protocol.capabilities.includes("execute")) {
        return "Update the selected-text provider to one that can execute workloads";
    }
    if (plugin.permissions.some((permission) => !permission.granted)) {
        return "Grant one-shot clipboard access";
    }
    const missing = plugin.artifacts.find((artifact) => !artifact.ready);
    return missing ? missing.reason || `Install ${missing.id}` : "";
}

function selectedTextProviderDetail(plugin) {
    if (plugin.source !== "external") {
        return "Install an external selected-text provider";
    }
    return selectedTextVersionQualified(plugin.version)
        ? ""
        : "Install a selected-text provider with operation-quality acceptance";
}

function selectedTextVersionQualified(version) {
    const match = typeof version === "string" ? SEMANTIC_VERSION.exec(version) : null;
    if (match === null) {
        return false;
    }
    const major = Number(match[1]);
    const minor = Number(match[2]);
    return major > 1 || (major === 1 && minor >= 1);
}

function selectedTextReadiness(inventory) {
    if (!validInventory(inventory)) {
        throw new TypeError("Selected-text readiness requires a valid plug-in inventory");
    }
    const plugin = inventory.plugins.find((candidate) => candidate.id === "selected-text-tools") || null;
    const detail = selectedTextReadinessDetail(plugin);
    return Object.freeze({available: detail === "", detail});
}

function fileOrganizerReadinessDetail(plugin) {
    if (plugin === null) {
        return "Install and configure a file-organizer provider";
    }
    if (plugin.source !== "external") {
        return "Install an external file-organizer provider";
    }
    if (plugin.workerState !== "ready") {
        return "Configure and qualify a GPU or NPU generation provider";
    }
    if (!plugin.protocol.capabilities.includes("execute")) {
        return "Update the file-organizer provider to one that can execute workloads";
    }
    if (plugin.permissions.some((permission) => !permission.granted)) {
        return "Grant access to explicitly selected files";
    }
    const missing = plugin.artifacts.find((artifact) => !artifact.ready);
    return missing ? missing.reason || `Install ${missing.id}` : "";
}

function fileOrganizerReadiness(inventory) {
    if (!validInventory(inventory)) {
        throw new TypeError("File organizer readiness requires a valid plug-in inventory");
    }
    const plugin = inventory.plugins.find((candidate) => candidate.id === "file-organizer") || null;
    const detail = fileOrganizerReadinessDetail(plugin);
    return Object.freeze({available: detail === "", detail});
}

function mediaTranscriptionReadinessDetail(plugin) {
    const provider = mediaTranscriptionProviderDetail(plugin);
    if (provider !== "") {
        return provider;
    }
    if (plugin.workerState !== "ready") {
        return "Qualify Whisper and Qwen VL on the selected accelerator";
    }
    if (!plugin.protocol.capabilities.includes("execute")) {
        return "Update the media provider to one that can execute workloads";
    }
    if (plugin.permissions.some((permission) => !permission.granted)) {
        return "Grant GPU and explicitly selected media-file access";
    }
    const missing = plugin.artifacts.find((artifact) => !artifact.ready);
    return missing ? missing.reason || `Install ${missing.id}` : "";
}

function mediaTranscriptionProviderDetail(plugin) {
    if (plugin === null) {
        return "Install and configure the media-transcription provider";
    }
    if (plugin.source !== "external" || plugin.version !== "1.0.0") {
        return "Install the qualified external media-transcription provider";
    }
    return "";
}

function mediaTranscriptionReadiness(inventory) {
    if (!validInventory(inventory)) {
        throw new TypeError("Media readiness requires a valid plug-in inventory");
    }
    const plugin = inventory.plugins.find(
        (candidate) => candidate.id === "media-transcription",
    ) || null;
    const detail = mediaTranscriptionReadinessDetail(plugin);
    return Object.freeze({available: detail === "", detail});
}

class PluginInventoryGateway {
    constructor({sendText, cancellableFactory = () => null}) {
        if (typeof sendText !== "function") {
            throw new TypeError("An asynchronous plug-in inventory transport is required");
        }
        this._sendText = sendText;
        this._cancellableFactory = typeof cancellableFactory === "function" ? cancellableFactory : () => null;
        this._sequence = 0;
        this._pending = null;
    }

    describe(callback) {
        if (typeof callback !== "function") {
            throw new TypeError("A plug-in inventory callback is required");
        }
        this.cancel();
        const sequence = ++this._sequence;
        const cancellable = this._cancellableFactory();
        this._pending = {sequence, cancellable};
        try {
            this._sendText({cancellable}, (error, text) => this._complete(sequence, callback, error, text));
        } catch (error) {
            this._complete(sequence, callback, error, null);
        }
        return true;
    }

    cancel() {
        if (this._pending === null) {
            return false;
        }
        const {cancellable} = this._pending;
        this._pending = null;
        this._sequence += 1;
        if (cancellable && typeof cancellable.cancel === "function") {
            cancellable.cancel();
        }
        return true;
    }

    _complete(sequence, callback, error, text) {
        if (this._pending === null || sequence !== this._sequence) {
            return false;
        }
        this._pending = null;
        if (error) {
            callback(error, null);
            return true;
        }
        try {
            callback(null, parseInventory(text));
        } catch (parseError) {
            callback(parseError, null);
        }
        return true;
    }
}

module.exports = {
    INVENTORY_VERSION,
    MAX_PLUGINS,
    PluginInventoryGateway,
    documentQuestionReadiness,
    fileOrganizerReadiness,
    fileOrganizerReadinessDetail,
    mediaTranscriptionReadiness,
    mediaTranscriptionReadinessDetail,
    mediaTranscriptionProviderDetail,
    selectedTextReadiness,
    selectedTextVersionQualified,
    documentReadinessDetail,
    exactRecord,
    eventReadiness,
    parseInventory,
    readinessDetail,
    validArtifact,
    validInventory,
    validPermission,
    validPlugin,
    validProtocol,
};
