"use strict";

const FileSystem = require("./gio-file-adapter.js");
const PluginInventory = require("./plugin-inventory.js");
const RuntimeContract = require("./runtime-contract-gateway.js");
const RuntimeControl = require("./runtime-control-gateway.js");
const RuntimeJob = require("./runtime-job-gateway.js");

const {
    createCancellableFactory,
    isIoError,
} = FileSystem;

const CONTROL_BUS_NAME = "org.cinnamon.OmniTensor1";
const CONTROL_OBJECT_PATH = "/org/cinnamon/OmniTensor1";
const CONTROL_INTERFACE = "org.cinnamon.OmniTensor1";
const CONTROL_METHOD = "ApplyCommand";
const CONTRACT_METHOD = "DescribeContract";
const PLUGIN_INVENTORY_METHOD = "DescribePlugins";
const SUBMIT_JOB_METHOD = "SubmitJob";
const CANCEL_JOB_METHOD = "CancelJob";
const JOB_RESULT_METHOD = "GetJobResult";
const CONTROL_TIMEOUT_MS = 5000;

function callRuntimeMethod(method, argument, {cancellable}, callback, environment) {
    const connection = environment.Gio.DBus.session;
    connection.call(
        CONTROL_BUS_NAME,
        CONTROL_OBJECT_PATH,
        CONTROL_INTERFACE,
        method,
        argument === null
            ? null
            : new environment.GLib.Variant("(s)", [argument]),
        new environment.GLib.VariantType("(s)"),
        environment.Gio.DBusCallFlags.NONE,
        CONTROL_TIMEOUT_MS,
        cancellable,
        (source, result) => {
            try {
                callback(null, source.call_finish(result).deep_unpack()[0]);
            } catch (error) {
                if (!isIoError(environment, error, "CANCELLED")) {
                    callback(error, null);
                }
            }
        },
    );
}

function sendRuntimeCommandText(text, options, callback, environment) {
    return callRuntimeMethod(CONTROL_METHOD, text, options, callback, environment);
}

// The handshake takes no arguments, so the variant is empty rather than an
// empty string: a service reading "" as a request body would be answering a
// different question from the one asked.
function requestRuntimeContractText(options, callback, environment) {
    return callRuntimeMethod(CONTRACT_METHOD, null, options, callback, environment);
}

function requestPluginInventoryText(options, callback, environment) {
    return callRuntimeMethod(PLUGIN_INVENTORY_METHOD, null, options, callback, environment);
}

// Name ownership is the only signal that says the control service started or
// stopped without the applet having to fail a command first. An environment
// without the watch API (older GJS, test harnesses) reports nothing rather
// than claiming the service is absent.
function createControlServiceWatch(environment) {
    return {
        watch(listener) {
            const Gio = environment.Gio;
            if (!Gio || typeof Gio.bus_watch_name !== "function") {
                return null;
            }
            const id = Gio.bus_watch_name(
                Gio.BusType.SESSION,
                CONTROL_BUS_NAME,
                Gio.BusNameWatcherFlags.NONE,
                () => listener(true),
                () => listener(false),
            );
            return () => Gio.bus_unwatch_name(id);
        },
    };
}

function createRuntimeContractGateway(environment) {
    return new RuntimeContract.RuntimeContractGateway({
        cancellableFactory: createCancellableFactory(environment),
        sendText: (options, callback) => requestRuntimeContractText(
            options, callback, environment,
        ),
    });
}

function createPluginInventoryGateway(environment) {
    return new PluginInventory.PluginInventoryGateway({
        cancellableFactory: createCancellableFactory(environment),
        sendText: (options, callback) => requestPluginInventoryText(
            options, callback, environment,
        ),
    });
}

function submitRuntimeJobText(text, options, callback, environment) {
    return callRuntimeMethod(SUBMIT_JOB_METHOD, text, options, callback, environment);
}

function requestRuntimeJobResultText(text, options, callback, environment) {
    return callRuntimeMethod(JOB_RESULT_METHOD, text, options, callback, environment);
}

function cancelRuntimeJobText(text, options, callback, environment) {
    return callRuntimeMethod(CANCEL_JOB_METHOD, text, options, callback, environment);
}

function createRuntimeJobGateway(environment) {
    return new RuntimeJob.RuntimeJobGateway({
        cancellableFactory: createCancellableFactory(environment),
        sendText: (text, options, callback) => submitRuntimeJobText(
            text, options, callback, environment,
        ),
        sendResultText: (text, options, callback) => requestRuntimeJobResultText(
            text, options, callback, environment,
        ),
        sendCancelText: (text, options, callback) => cancelRuntimeJobText(
            text, options, callback, environment,
        ),
    });
}

function createRuntimeControlGateway(environment) {
    return new RuntimeControl.RuntimeControlGateway({
        cancellableFactory: createCancellableFactory(environment),
        sendText: (text, options, callback) => sendRuntimeCommandText(
            text, options, callback, environment,
        ),
    });
}

module.exports = {
    CANCEL_JOB_METHOD,
    CONTROL_BUS_NAME,
    CONTROL_INTERFACE,
    CONTROL_METHOD,
    CONTROL_OBJECT_PATH,
    CONTROL_TIMEOUT_MS,
    CONTRACT_METHOD,
    JOB_RESULT_METHOD,
    PLUGIN_INVENTORY_METHOD,
    SUBMIT_JOB_METHOD,
    callRuntimeMethod,
    cancelRuntimeJobText,
    createControlServiceWatch,
    createPluginInventoryGateway,
    createRuntimeContractGateway,
    createRuntimeControlGateway,
    createRuntimeJobGateway,
    requestPluginInventoryText,
    requestRuntimeContractText,
    requestRuntimeJobResultText,
    sendRuntimeCommandText,
    submitRuntimeJobText,
};
