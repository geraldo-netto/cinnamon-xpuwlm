"use strict";

const Runtime = require("./runtime-gateway.js");

const USB_VENDOR = "18d1";
const USB_PRODUCT = "9302";
const DEVICE_CACHE_MS = 10000;

function expandHome(path, homeDirectory) {
    const text = String(path || "");
    if (text === "~") {
        return homeDirectory;
    }
    if (text.startsWith("~/")) {
        return `${homeDirectory}/${text.slice(2)}`;
    }
    return text;
}

function decodeBytes(bytes, ByteArray) {
    if (typeof bytes === "string") {
        return bytes;
    }
    return ByteArray.toString(bytes);
}

function readFileText(path, environment, maximumBytes = null) {
    const file = environment.Gio.File.new_for_path(path);
    if (!file.query_exists(null)) {
        return null;
    }
    if (maximumBytes !== null) {
        const info = file.query_info(
            "standard::size",
            environment.Gio.FileQueryInfoFlags.NONE,
            null,
        );
        if (info.get_size() > maximumBytes) {
            throw new RangeError("Runtime snapshot exceeds 1 MiB");
        }
    }
    const [ok, contents] = environment.GLib.file_get_contents(path);
    if (!ok) {
        throw new Error(`Could not read ${path}`);
    }
    return decodeBytes(contents, environment.ByteArray);
}

function readTrimmed(path, environment) {
    const text = readFileText(path, environment);
    return text === null ? "" : text.trim().toLowerCase();
}

function detectPcieDevice(environment) {
    for (let index = 0; index < 8; index += 1) {
        if (environment.Gio.File.new_for_path(`/dev/apex_${index}`).query_exists(null)) {
            return {
                available: true,
                name: index === 0 ? "Coral PCIe Edge TPU" : `Coral PCIe Edge TPU ${index + 1}`,
                kind: "pcie",
                reason: "",
            };
        }
    }
    return null;
}

function detectUsbDevice(environment) {
    const root = environment.Gio.File.new_for_path("/sys/bus/usb/devices");
    if (!root.query_exists(null)) {
        return null;
    }
    const enumerator = root.enumerate_children(
        "standard::name",
        environment.Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS,
        null,
    );
    try {
        let info = enumerator.next_file(null);
        while (info !== null) {
            const base = `/sys/bus/usb/devices/${info.get_name()}`;
            if (readTrimmed(`${base}/idVendor`, environment) === USB_VENDOR
                && readTrimmed(`${base}/idProduct`, environment) === USB_PRODUCT) {
                return {
                    available: true,
                    name: "Coral USB Accelerator",
                    kind: "usb",
                    reason: "",
                };
            }
            info = enumerator.next_file(null);
        }
        return null;
    } finally {
        enumerator.close(null);
    }
}

function detectDevice(environment) {
    return detectPcieDevice(environment)
        || detectUsbDevice(environment)
        || {
            available: false,
            name: "No TPU detected",
            kind: "unknown",
            reason: "Connect a Coral USB or PCIe Edge TPU",
        };
}

class CachedDeviceDetector {
    constructor(environment, clock = Date, cacheMs = DEVICE_CACHE_MS) {
        this._environment = environment;
        this._clock = clock;
        this._cacheMs = Math.max(0, Number(cacheMs) || 0);
        this._cachedAt = Number.NEGATIVE_INFINITY;
        this._cached = null;
    }

    detect() {
        const nowMs = this._clock.now();
        if (this._cached !== null && nowMs - this._cachedAt < this._cacheMs) {
            return {...this._cached};
        }
        this._cached = detectDevice(this._environment);
        this._cachedAt = nowMs;
        return {...this._cached};
    }

    invalidate() {
        this._cached = null;
        this._cachedAt = Number.NEGATIVE_INFINITY;
    }
}

class CinnamonSettingsRepository {
    constructor(settings) {
        if (!settings || typeof settings.getValue !== "function" || typeof settings.setValue !== "function") {
            throw new TypeError("Cinnamon applet settings are required");
        }
        this._settings = settings;
    }

    load() {
        return {
            portfolio: this._settings.getValue("profile-state"),
            selectedTab: this._settings.getValue("selected-tab"),
        };
    }

    save(state) {
        const portfolio = state.portfolio;
        const selectedTab = state.selectedTab;
        if (JSON.stringify(this._settings.getValue("profile-state")) !== JSON.stringify(portfolio)) {
            this._settings.setValue("profile-state", portfolio);
        }
        if (this._settings.getValue("selected-tab") !== selectedTab) {
            this._settings.setValue("selected-tab", selectedTab);
        }
    }
}

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

function createLogger(prefix, cinnamonGlobal = global) {
    const name = String(prefix || "TPU Workload Manager");
    return {
        warn(message) {
            cinnamonGlobal.logWarning(`[${name}] ${message}`);
        },
        error(message) {
            cinnamonGlobal.logError(`[${name}] ${message}`);
        },
    };
}

function createRuntimeGateway({path, environment, clock = Date, logger, deviceDetector}) {
    const expandedPath = expandHome(path, environment.GLib.get_home_dir());
    const detector = deviceDetector || new CachedDeviceDetector(environment, clock);
    return new Runtime.RuntimeSnapshotGateway({
        path: expandedPath,
        clock,
        logger,
        readText: (filename) => readFileText(filename, environment, Runtime.MAX_SNAPSHOT_BYTES),
        detectDevice: () => detector.detect(),
    });
}

module.exports = {
    DEVICE_CACHE_MS,
    USB_PRODUCT,
    USB_VENDOR,
    CachedDeviceDetector,
    CinnamonPoller,
    CinnamonSettingsRepository,
    createLogger,
    createRuntimeGateway,
    decodeBytes,
    detectDevice,
    detectPcieDevice,
    detectUsbDevice,
    expandHome,
    readFileText,
    readTrimmed,
};
