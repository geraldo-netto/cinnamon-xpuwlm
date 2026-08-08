"use strict";

const FailureBackoff = require("./failure-log-backoff.js");
const Runtime = require("./runtime-gateway.js");
const RuntimeSchema = require("./runtime-snapshot-schema-validator.js");

const USB_VENDOR = "18d1";
const USB_PRODUCT = "9302";
const USB_DFU_VENDOR = "1a6e";
const USB_DFU_PRODUCT = "089a";
const CORAL_USB_IDENTITIES = Object.freeze([
    Object.freeze({vendor: USB_VENDOR, product: USB_PRODUCT, name: "Coral USB Accelerator"}),
    Object.freeze({vendor: USB_DFU_VENDOR, product: USB_DFU_PRODUCT, name: "Coral USB Accelerator (DFU)"}),
]);
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

function isIoError(environment, error, name) {
    const enumeration = environment.Gio && environment.Gio.IOErrorEnum;
    if (!enumeration || !error || typeof error.matches !== "function") {
        return false;
    }
    return error.matches(enumeration, enumeration[name]);
}

const IDENTITY_ATTRIBUTES = "standard::type,standard::size,unix::inode,unix::device";

function fileIdentity(info) {
    return {
        inode: info.get_attribute_uint64("unix::inode"),
        device: info.get_attribute_uint32("unix::device"),
    };
}

function sameIdentity(left, right) {
    return left.inode === right.inode && left.device === right.device;
}

// Bounded, cancellable GIO read that never follows a symlink and never trusts
// the path between calls. The no-follow preflight rejects anything that is not
// a regular file, and the identity of the opened stream must match the identity
// the preflight saw, so a path object swapped in between is rejected rather
// than read. An absent file reports no text so the caller can fall back to
// device discovery; a cancelled read never calls back at all.
function readFileTextAsync(path, environment, options, callback) {
    const maximumBytes = options && Number.isFinite(options.maximumBytes)
        ? options.maximumBytes
        : null;
    const cancellable = options ? options.cancellable || null : null;
    const Gio = environment.Gio;
    const file = Gio.File.new_for_path(path);

    const fail = (error) => callback(error, null);
    const guarded = (step) => {
        try {
            step();
        } catch (error) {
            if (isIoError(environment, error, "CANCELLED")) {
                return;
            }
            if (isIoError(environment, error, "NOT_FOUND")) {
                callback(null, null);
                return;
            }
            fail(error);
        }
    };

    file.query_info_async(
        IDENTITY_ATTRIBUTES,
        Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS,
        null,
        cancellable,
        (infoSource, infoResult) => guarded(() => {
            const info = infoSource.query_info_finish(infoResult);
            if (info.get_file_type() !== Gio.FileType.REGULAR) {
                fail(new Error(`Runtime snapshot is not a regular file: ${path}`));
                return;
            }
            if (maximumBytes !== null && info.get_size() > maximumBytes) {
                fail(new RangeError("Runtime snapshot exceeds 1 MiB"));
                return;
            }
            const expected = fileIdentity(info);
            file.read_async(null, cancellable, (readSource, readResult) => guarded(() => {
                const stream = readSource.read_finish(readResult);
                const opened = fileIdentity(stream.query_info(IDENTITY_ATTRIBUTES, cancellable));
                if (!sameIdentity(expected, opened)) {
                    fail(new Error(`Runtime snapshot path changed while opening: ${path}`));
                    return;
                }
                stream.read_bytes_async(
                    maximumBytes === null ? Runtime.MAX_SNAPSHOT_BYTES + 1 : maximumBytes,
                    null,
                    cancellable,
                    (bytesSource, bytesResult) => guarded(() => {
                        const bytes = bytesSource.read_bytes_finish(bytesResult);
                        const data = typeof bytes.get_data === "function" ? bytes.get_data() : bytes;
                        if (maximumBytes !== null && data.length > maximumBytes) {
                            fail(new RangeError("Runtime snapshot exceeds 1 MiB"));
                            return;
                        }
                        callback(null, decodeBytes(data, environment.ByteArray));
                    }),
                );
            }));
        }),
    );
}

function createCancellableFactory(environment) {
    return () => (environment.Gio && environment.Gio.Cancellable
        ? new environment.Gio.Cancellable()
        : null);
}

function readTrimmed(path, environment) {
    const text = readFileText(path, environment);
    return text === null ? "" : text.trim().toLowerCase();
}

function findCoralUsbIdentity(vendor, product) {
    return CORAL_USB_IDENTITIES.find(
        (identity) => identity.vendor === vendor && identity.product === product,
    ) || null;
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
            const identity = findCoralUsbIdentity(
                readTrimmed(`${base}/idVendor`, environment),
                readTrimmed(`${base}/idProduct`, environment),
            );
            if (identity !== null) {
                return {
                    available: true,
                    name: identity.name,
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

    detect(forceRefresh = false) {
        if (forceRefresh === true) {
            this.invalidate();
        }
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

function createRuntimeGateway({
    path,
    environment,
    clock = Date,
    logger,
    deviceDetector,
    snapshotValidator,
    warningReporter,
}) {
    const expandedPath = expandHome(path, environment.GLib.get_home_dir());
    const detector = deviceDetector || new CachedDeviceDetector(environment, clock);
    return new Runtime.RuntimeSnapshotGateway({
        path: expandedPath,
        clock,
        snapshotValidator: snapshotValidator
            ?? new RuntimeSchema.RuntimeSnapshotSchemaValidator(),
        warningReporter: warningReporter || new FailureBackoff.FailureWarningBackoff({logger}),
        cancellableFactory: createCancellableFactory(environment),
        readTextAsync: (filename, options, callback) => readFileTextAsync(
            filename,
            environment,
            options,
            callback,
        ),
        detectDevice: (forceRefresh) => detector.detect(forceRefresh),
    });
}

module.exports = {
    CORAL_USB_IDENTITIES,
    DEVICE_CACHE_MS,
    USB_DFU_PRODUCT,
    USB_DFU_VENDOR,
    USB_PRODUCT,
    USB_VENDOR,
    CachedDeviceDetector,
    CinnamonPoller,
    CinnamonScheduler,
    CinnamonSettingsRepository,
    createCancellableFactory,
    createCriticalNotifications,
    createLayoutProvider,
    createLogger,
    createRuntimeGateway,
    decodeBytes,
    detectDevice,
    detectPcieDevice,
    detectUsbDevice,
    expandHome,
    findCoralUsbIdentity,
    fileIdentity,
    isIoError,
    readFileText,
    readFileTextAsync,
    readTrimmed,
    sameIdentity,
};
