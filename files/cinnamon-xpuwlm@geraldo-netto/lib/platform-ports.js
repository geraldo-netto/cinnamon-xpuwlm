"use strict";

const Guidance = require("./platform-guidance.js");
const Paths = require("./path-port.js");

function requireMethods(candidate, methods, label) {
    if (!candidate || methods.some((name) => typeof candidate[name] !== "function")) {
        throw new TypeError(`${label} port is required`);
    }
    return candidate;
}

function requireTransportPort(candidate) {
    return requireMethods(candidate, [
        "createControlGateway",
        "createControlWatch",
        "createContractGateway",
        "createJobGateway",
        "createPluginInventoryGateway",
    ], "Runtime transport");
}

function requireDiscoveryPort(candidate) {
    return requireMethods(candidate, ["createInputCatalog", "createRuntimeGateway"], "Discovery");
}

function platformComposition({paths, guidance, transport, discovery}) {
    return Object.freeze({
        paths: Paths.requirePathPort(paths),
        guidance: Guidance.requireGuidancePort(guidance),
        transport: requireTransportPort(transport),
        discovery: requireDiscoveryPort(discovery),
    });
}

function requirePlatformComposition(candidate) {
    if (!candidate) {
        throw new TypeError("Platform composition is required");
    }
    return platformComposition(candidate);
}

module.exports = {
    platformComposition,
    requireDiscoveryPort,
    requirePlatformComposition,
    requireTransportPort,
};
