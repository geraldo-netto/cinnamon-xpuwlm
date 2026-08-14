"use strict";

const Dbus = require("./cinnamon-dbus-adapter.js");
const Host = require("./cinnamon-host-adapter.js");
const Images = require("./cinnamon-image-adapter.js");
const Guidance = require("./platform-guidance.js");
const Paths = require("./path-port.js");
const Platform = require("./platform-ports.js");

function createPosixTransport(environment) {
    return Object.freeze({
        createControlGateway: () => Dbus.createRuntimeControlGateway(environment),
        createControlWatch: () => Dbus.createControlServiceWatch(environment),
        createContractGateway: () => Dbus.createRuntimeContractGateway(environment),
        createJobGateway: () => Dbus.createRuntimeJobGateway(environment),
        createPluginInventoryGateway: () => Dbus.createPluginInventoryGateway(environment),
    });
}

function createPosixDiscovery({environment, clock = Date, logger, workloadCatalog}) {
    return Object.freeze({
        createInputCatalog: () => Images.createInputCatalog(environment, logger),
        createRuntimeGateway: (path) => Host.createRuntimeGateway({
            path,
            environment,
            clock,
            logger,
            workloadCatalog,
        }),
    });
}

function createCinnamonPlatform(options) {
    if (!options?.environment) {
        throw new TypeError("Cinnamon platform environment is required");
    }
    return Platform.platformComposition({
        paths: Paths.POSIX_PATHS,
        guidance: Guidance.POSIX_GUIDANCE,
        transport: createPosixTransport(options.environment),
        discovery: createPosixDiscovery(options),
    });
}

module.exports = {
    createCinnamonPlatform,
    createPosixDiscovery,
    createPosixTransport,
};
