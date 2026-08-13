"use strict";

const Domain = require("./domain.js");
const FailureBackoff = require("./failure-log-backoff.js");
const FileSystem = require("./gio-file-adapter.js");
const Runtime = require("./runtime-gateway.js");
const RuntimeSchema = require("./runtime-snapshot-schema-validator.js");
const Devices = require("./linux-device-adapter.js");

const {
    createCancellableFactory,
    expandHome,
    readFileTextAsync,
} = FileSystem;
const {CachedDeviceDetector} = Devices;

class CinnamonPoller {
    constructor(Mainloop, callback) {
        if (!Mainloop || typeof Mainloop.timeout_add_seconds !== "function"
            || typeof Mainloop.source_remove !== "function") {
            throw new TypeError("Cinnamon Mainloop is required");
        }
        if (typeof callback !== "function") {
            throw new TypeError("A polling callback is required");
        }
        this._mainloop = Mainloop;
        this._callback = callback;
        this._sourceId = 0;
    }

    start(seconds) {
        this.stop();
        const interval = Math.max(1, Math.trunc(Number(seconds) || 1));
        this._sourceId = this._mainloop.timeout_add_seconds(interval, () => {
            this._callback();
            return true;
        });
        return this._sourceId;
    }

    stop() {
        if (this._sourceId === 0) {
            return false;
        }
        const sourceId = this._sourceId;
        this._sourceId = 0;
        this._mainloop.source_remove(sourceId);
        return true;
    }
}

class CinnamonScheduler {
    constructor(Mainloop) {
        if (!Mainloop || typeof Mainloop.timeout_add !== "function"
            || typeof Mainloop.source_remove !== "function") {
            throw new TypeError("Cinnamon Mainloop is required");
        }
        this._mainloop = Mainloop;
    }

    schedule(delayMs, callback) {
        if (typeof callback !== "function") {
            throw new TypeError("A scheduled callback is required");
        }
        const delay = Math.max(0, Math.trunc(Number(delayMs) || 0));
        return this._mainloop.timeout_add(delay, () => {
            callback();
            return false;
        });
    }

    cancel(handle) {
        if (handle === null || handle === undefined) {
            return false;
        }
        this._mainloop.source_remove(handle);
        return true;
    }
}

// Reads the raw measurements the pure layout module needs. Everything that can
// be absent on an older Cinnamon stays optional; the layout module sanitizes.
function createLayoutProvider({Main, St, cinnamonGlobal = global}) {
    if (!Main || !Main.layoutManager) {
        throw new TypeError("Cinnamon layout manager is required");
    }
    const layoutManager = Main.layoutManager;
    return {
        measure(actor) {
            const monitor = (actor && typeof layoutManager.findMonitorForActor === "function"
                ? layoutManager.findMonitorForActor(actor)
                : null) || layoutManager.primaryMonitor || {};
            const themeContext = St && St.ThemeContext
                ? St.ThemeContext.get_for_stage(cinnamonGlobal.stage)
                : null;
            return {
                workAreaWidth: monitor.width,
                workAreaHeight: monitor.height,
                scaleFactor: themeContext ? themeContext.scale_factor : 1,
                textScaleFactor: cinnamonGlobal.ui_scale,
            };
        },
    };
}

function createCriticalNotifications(Main) {
    if (!Main || typeof Main.criticalNotify !== "function") {
        throw new TypeError("Cinnamon criticalNotify is required");
    }
    return {
        notify(message) {
            Main.criticalNotify(message.summary, message.body);
        },
    };
}

function createLogger(prefix, cinnamonGlobal = global) {
    const name = String(prefix || "XPU Workload Manager");
    return {
        warn(message) {
            cinnamonGlobal.logWarning(`[${name}] ${message}`);
        },
        error(message) {
            cinnamonGlobal.logError(`[${name}] ${message}`);
        },
    };
}

function createRuntimeGateway({
    path,
    environment,
    clock = Date,
    logger,
    deviceDetector,
    snapshotValidator,
    warningReporter,
    workloadCatalog = Domain.EMPTY_WORKLOAD_CATALOG,
}) {
    const expandedPath = expandHome(path, environment.GLib.get_home_dir());
    const detector = deviceDetector || new CachedDeviceDetector(environment, clock);
    return new Runtime.RuntimeSnapshotGateway({
        path: expandedPath,
        clock,
        snapshotValidator: snapshotValidator
            ?? new RuntimeSchema.RuntimeSnapshotSchemaValidator(),
        warningReporter: warningReporter || new FailureBackoff.FailureWarningBackoff({logger}),
        workloadCatalog,
        cancellableFactory: createCancellableFactory(environment),
        readTextAsync: (filename, options, callback) => readFileTextAsync(
            filename,
            environment,
            options,
            callback,
        ),
        detectDevice: (forceRefresh, options, callback) => detector.detect(
            forceRefresh,
            options,
            callback,
        ),
    });
}

module.exports = {
    CinnamonPoller,
    CinnamonScheduler,
    createCriticalNotifications,
    createLayoutProvider,
    createLogger,
    createRuntimeGateway,
};
