"use strict";

const FailureBackoff = require("./failure-log-backoff.js");
const Domain = require("./domain.js");
const Runtime = require("./runtime-gateway.js");
const RuntimeControl = require("./runtime-control-gateway.js");
const RuntimeSchema = require("./runtime-snapshot-schema-validator.js");
const WorkloadRegistry = require("./workload-registry.js");

const USB_VENDOR = "18d1";
const USB_PRODUCT = "9302";
const USB_DFU_VENDOR = "1a6e";
const USB_DFU_PRODUCT = "089a";
const CORAL_USB_IDENTITIES = Object.freeze([
    Object.freeze({vendor: USB_VENDOR, product: USB_PRODUCT, name: "Coral USB Accelerator"}),
    Object.freeze({vendor: USB_DFU_VENDOR, product: USB_DFU_PRODUCT, name: "Coral USB Accelerator (DFU)"}),
]);
const DEVICE_CACHE_MS = 10000;
const CONTROL_BUS_NAME = "org.cinnamon.OmniTensor1";
const CONTROL_OBJECT_PATH = "/org/cinnamon/OmniTensor1";
const CONTROL_INTERFACE = "org.cinnamon.OmniTensor1";
const CONTROL_METHOD = "ApplyCommand";
const CONTROL_TIMEOUT_MS = 5000;
const MAX_PCIE_DEVICES = 8;
const MAX_USB_DEVICES = 256;
const MAX_USB_ID_BYTES = 32;
const USB_BATCH_SIZE = 32;
const MAX_ACCEL_DEVICES = 8;
const MAX_RENDER_DEVICES = 8;
const RENDER_NODE_BASE = 128;
const NPU_VENDOR_NAMES = Object.freeze({
    "0x8086": "Intel NPU",
    "0x1002": "AMD NPU",
    "0x1022": "AMD NPU",
});
const GPU_VENDOR_NAMES = Object.freeze({
    "0x10de": "NVIDIA GPU",
    "0x1002": "AMD GPU",
    "0x8086": "Intel GPU",
});

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
            throw new RangeError("File exceeds configured maximum size");
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
    // Sysfs attribute files declare a page-sized st_size (4096) regardless of
    // content, so bounded identity reads opt out of the declared-size gate and
    // rely on the actual bounded byte read plus truncation instead. The
    // snapshot path keeps the strict declared-size rejection.
    const truncateOversize = options?.truncateOversize === true;
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
            if (!truncateOversize && maximumBytes !== null && info.get_size() > maximumBytes) {
                fail(new RangeError("Runtime snapshot exceeds 1 MiB"));
                return;
            }
            const expected = fileIdentity(info);
            file.read_async(null, cancellable, (readSource, readResult) => guarded(() => {
                const stream = readSource.read_finish(readResult);
                const opened = fileIdentity(stream.query_info(IDENTITY_ATTRIBUTES, cancellable));
                if (!sameIdentity(expected, opened)) {
                    // A publisher that atomically replaces the snapshot between
                    // the preflight and the open trips this check benignly, so
                    // the error is marked transient and the gateway retries once
                    // with a fresh preflight instead of failing the poll.
                    const raced = new Error(`Runtime snapshot path changed while opening: ${path}`);
                    raced.transientRace = true;
                    fail(raced);
                    return;
                }
                stream.read_bytes_async(
                    maximumBytes === null ? Runtime.MAX_SNAPSHOT_BYTES + 1 : maximumBytes,
                    null,
                    cancellable,
                    (bytesSource, bytesResult) => guarded(() => {
                        const bytes = bytesSource.read_bytes_finish(bytesResult);
                        const data = typeof bytes.get_data === "function" ? bytes.get_data() : bytes;
                        if (!truncateOversize && maximumBytes !== null && data.length > maximumBytes) {
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

function listWorkloadDirectories(path, environment) {
    const root = environment.Gio.File.new_for_path(path);
    if (!root.query_exists(null)) {
        return [];
    }
    const enumerator = root.enumerate_children(
        "standard::name,standard::type",
        environment.Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS,
        null,
    );
    const names = [];
    try {
        let info = enumerator.next_file(null);
        while (info !== null && names.length <= WorkloadRegistry.MAX_WORKLOADS) {
            if (info.get_file_type() === environment.Gio.FileType.DIRECTORY) {
                names.push(info.get_name());
            }
            info = enumerator.next_file(null);
        }
    } finally {
        enumerator.close(null);
    }
    return names;
}

function createWorkloadRegistry(path, environment) {
    return new WorkloadRegistry.ManifestDirectoryRegistry({
        root: path,
        listDirectories: (root) => listWorkloadDirectories(root, environment),
        readText: (source, maximumBytes) => readFileText(source, environment, maximumBytes),
    });
}

function findCoralUsbIdentity(vendor, product) {
    return CORAL_USB_IDENTITIES.find(
        (identity) => identity.vendor === vendor && identity.product === product,
    ) || null;
}

function finishIo(environment, error, callback, fallback = null) {
    if (isIoError(environment, error, "CANCELLED")) {
        return false;
    }
    if (isIoError(environment, error, "NOT_FOUND")) {
        callback(null, fallback);
        return true;
    }
    callback(error, fallback);
    return true;
}

function queryExistsAsync(path, environment, cancellable, callback) {
    const file = environment.Gio.File.new_for_path(path);
    try {
        file.query_info_async(
            "standard::type",
            environment.Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS,
            0,
            cancellable,
            (source, result) => {
                try {
                    source.query_info_finish(result);
                    callback(null, true);
                } catch (error) {
                    finishIo(environment, error, callback, false);
                }
            },
        );
    } catch (error) {
        finishIo(environment, error, callback, false);
    }
}

function detectPcieDeviceAsync(environment, cancellable, callback, index = 0) {
    if (index >= MAX_PCIE_DEVICES) {
        callback(null, null);
        return;
    }
    queryExistsAsync(`/dev/apex_${index}`, environment, cancellable, (error, exists) => {
        if (error || exists) {
            callback(error, exists ? {
                id: `tpu-pcie-${index}`,
                backend: "tpu",
                available: true,
                name: index === 0 ? "Coral PCIe Edge TPU" : `Coral PCIe Edge TPU ${index + 1}`,
                kind: "pcie",
                reason: "",
            } : null);
            return;
        }
        detectPcieDeviceAsync(environment, cancellable, callback, index + 1);
    });
}

function closeEnumeratorAsync(enumerator, environment, cancellable, callback) {
    try {
        enumerator.close_async(0, cancellable, (source, result) => {
            try {
                source.close_finish(result);
                callback(null);
            } catch (error) {
                finishIo(environment, error, callback);
            }
        });
    } catch (error) {
        finishIo(environment, error, callback);
    }
}

function collectUsbNames(enumerator, environment, cancellable, names, callback, scanned = 0) {
    const remaining = MAX_USB_DEVICES - scanned;
    if (remaining <= 0) {
        closeEnumeratorAsync(enumerator, environment, null, (error) => callback(error, names));
        return;
    }
    const acceptBatch = (source, result) => {
        let batch;
        try {
            batch = source.next_files_finish(result);
        } catch (error) {
            closeEnumeratorAsync(enumerator, environment, null, () => {
                finishIo(environment, error, callback);
            });
            return;
        }
        for (const info of batch.slice(0, remaining)) {
            if (info.get_file_type() === environment.Gio.FileType.DIRECTORY) {
                names.push(info.get_name());
            }
        }
        const inspected = scanned + batch.length;
        if (batch.length > 0 && inspected < MAX_USB_DEVICES) {
            collectUsbNames(enumerator, environment, cancellable, names, callback, inspected);
            return;
        }
        closeEnumeratorAsync(enumerator, environment, null, (error) => callback(error, names));
    };
    try {
        enumerator.next_files_async(Math.min(USB_BATCH_SIZE, remaining), 0, cancellable, acceptBatch);
    } catch (error) {
        closeEnumeratorAsync(enumerator, environment, null, () => {
            finishIo(environment, error, callback);
        });
    }
}

function listUsbDeviceNamesAsync(environment, cancellable, callback) {
    const root = environment.Gio.File.new_for_path("/sys/bus/usb/devices");
    try {
        root.enumerate_children_async(
            "standard::name,standard::type",
            environment.Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS,
            0,
            cancellable,
            (source, result) => {
                let enumerator;
                try {
                    enumerator = source.enumerate_children_finish(result);
                } catch (error) {
                    finishIo(environment, error, callback, []);
                    return;
                }
                collectUsbNames(enumerator, environment, cancellable, [], callback);
            },
        );
    } catch (error) {
        finishIo(environment, error, callback, []);
    }
}

function readTrimmedAsync(path, environment, cancellable, callback) {
    readFileTextAsync(path, environment, {
        maximumBytes: MAX_USB_ID_BYTES,
        truncateOversize: true,
        cancellable,
    }, (error, text) => {
        if (error) {
            callback(error, "");
            return;
        }
        callback(error, text === null ? "" : text.trim().toLowerCase());
    });
}

function detectUsbNameAsync(names, index, environment, cancellable, callback) {
    if (index >= names.length) {
        callback(null, null);
        return;
    }
    const base = `/sys/bus/usb/devices/${names[index]}`;
    readTrimmedAsync(`${base}/idVendor`, environment, cancellable, (vendorError, vendor) => {
        if (vendorError) {
            callback(vendorError, null);
            return;
        }
        readTrimmedAsync(`${base}/idProduct`, environment, cancellable, (productError, product) => {
            const identity = productError ? null : findCoralUsbIdentity(vendor, product);
            if (productError || identity !== null) {
                callback(productError, identity);
                return;
            }
            detectUsbNameAsync(names, index + 1, environment, cancellable, callback);
        });
    });
}

function detectUsbDeviceAsync(environment, cancellable, callback) {
    listUsbDeviceNamesAsync(environment, cancellable, (error, names) => {
        if (error) {
            callback(error, null);
            return;
        }
        detectUsbNameAsync(names, 0, environment, cancellable, (identityError, identity) => {
            callback(identityError, identity === null ? null : {
                id: "tpu-usb",
                backend: "tpu",
                available: true,
                name: identity.name,
                kind: "usb",
                reason: "",
            });
        });
    });
}

// Detection reports found devices only; absence is expressed by omission and
// aggregated by the domain, so an empty array means "probe ran, nothing found".
function detectTpuDeviceAsync(environment, cancellable, callback) {
    detectPcieDeviceAsync(environment, cancellable, (pcieError, pcie) => {
        if (pcieError || pcie !== null) {
            callback(pcieError, pcie);
            return;
        }
        detectUsbDeviceAsync(environment, cancellable, callback);
    });
}

// Vendor identification is best-effort: an unreadable sysfs vendor file must
// never fail detection of a present device node.
function describeAcceleratorAsync(vendorPath, vendorNames, fallbackName, environment, cancellable, callback) {
    readTrimmedAsync(vendorPath, environment, cancellable, (error, vendor) => {
        const identity = error ? "" : vendor;
        callback({name: vendorNames[identity] || fallbackName, vendor: identity});
    });
}

function detectNodeDeviceAsync(probe, environment, cancellable, callback, index = 0) {
    if (index >= probe.maxDevices) {
        callback(null, null);
        return;
    }
    queryExistsAsync(probe.nodePath(index), environment, cancellable, (error, exists) => {
        if (error) {
            callback(error, null);
            return;
        }
        if (!exists) {
            detectNodeDeviceAsync(probe, environment, cancellable, callback, index + 1);
            return;
        }
        describeAcceleratorAsync(
            probe.vendorPath(index),
            probe.vendorNames,
            probe.fallbackName,
            environment,
            cancellable,
            (described) => callback(null, {
                id: probe.id(index),
                backend: probe.backend,
                available: true,
                name: described.name,
                kind: probe.kind,
                vendor: described.vendor,
                reason: "",
            }),
        );
    });
}

function detectNpuDeviceAsync(environment, cancellable, callback) {
    detectNodeDeviceAsync({
        maxDevices: MAX_ACCEL_DEVICES,
        nodePath: (index) => `/dev/accel/accel${index}`,
        vendorPath: (index) => `/sys/class/accel/accel${index}/device/vendor`,
        vendorNames: NPU_VENDOR_NAMES,
        fallbackName: "NPU accelerator",
        backend: "npu",
        kind: "accel",
        id: (index) => `npu-accel${index}`,
    }, environment, cancellable, callback);
}

function detectGpuDeviceAsync(environment, cancellable, callback) {
    detectNodeDeviceAsync({
        maxDevices: MAX_RENDER_DEVICES,
        nodePath: (index) => `/dev/dri/renderD${RENDER_NODE_BASE + index}`,
        vendorPath: (index) => `/sys/class/drm/renderD${RENDER_NODE_BASE + index}/device/vendor`,
        vendorNames: GPU_VENDOR_NAMES,
        fallbackName: "GPU (render node)",
        backend: "gpu",
        kind: "dri",
        id: (index) => `gpu-renderD${RENDER_NODE_BASE + index}`,
    }, environment, cancellable, callback);
}

function detectDevicesAsync(environment, cancellable, callback) {
    detectTpuDeviceAsync(environment, cancellable, (tpuError, tpu) => {
        if (tpuError) {
            callback(tpuError, null);
            return;
        }
        detectNpuDeviceAsync(environment, cancellable, (npuError, npu) => {
            if (npuError) {
                callback(npuError, null);
                return;
            }
            detectGpuDeviceAsync(environment, cancellable, (gpuError, gpu) => {
                if (gpuError) {
                    callback(gpuError, null);
                    return;
                }
                callback(null, [tpu, npu, gpu].filter((device) => device !== null));
            });
        });
    });
}

class CachedDeviceDetector {
    constructor(environment, clock = Date, cacheMs = DEVICE_CACHE_MS) {
        this._environment = environment;
        this._clock = clock;
        this._cacheMs = Math.max(0, Number(cacheMs) || 0);
        this._cachedAt = Number.NEGATIVE_INFINITY;
        this._cached = null;
    }

    detect(forceRefresh = false, options = {}, callback) {
        if (typeof callback !== "function") {
            throw new TypeError("A device detection callback is required");
        }
        if (forceRefresh === true) {
            this.invalidate();
        }
        const nowMs = this._clock.now();
        if (this._cached !== null && nowMs - this._cachedAt < this._cacheMs) {
            callback(null, this._cached.map((device) => ({...device})));
            return true;
        }
        detectDevicesAsync(this._environment, options.cancellable || null, (error, devices) => {
            if (!error) {
                this._cached = devices.map((device) => ({...device}));
                this._cachedAt = this._clock.now();
            }
            callback(error, error ? null : devices.map((device) => ({...device})));
        });
        return true;
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

function sendRuntimeCommandText(text, {cancellable}, callback, environment) {
    const connection = environment.Gio.DBus.session;
    connection.call(
        CONTROL_BUS_NAME,
        CONTROL_OBJECT_PATH,
        CONTROL_INTERFACE,
        CONTROL_METHOD,
        new environment.GLib.Variant("(s)", [text]),
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

function createRuntimeControlGateway(environment) {
    return new RuntimeControl.RuntimeControlGateway({
        cancellableFactory: createCancellableFactory(environment),
        sendText: (text, options, callback) => sendRuntimeCommandText(
            text, options, callback, environment,
        ),
    });
}

module.exports = {
    CORAL_USB_IDENTITIES,
    CONTROL_BUS_NAME,
    CONTROL_INTERFACE,
    CONTROL_METHOD,
    CONTROL_OBJECT_PATH,
    CONTROL_TIMEOUT_MS,
    DEVICE_CACHE_MS,
    MAX_PCIE_DEVICES,
    MAX_USB_DEVICES,
    MAX_USB_ID_BYTES,
    USB_BATCH_SIZE,
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
    createRuntimeControlGateway,
    createWorkloadRegistry,
    decodeBytes,
    closeEnumeratorAsync,
    collectUsbNames,
    detectDevicesAsync,
    detectGpuDeviceAsync,
    detectNpuDeviceAsync,
    detectPcieDeviceAsync,
    detectTpuDeviceAsync,
    detectUsbDeviceAsync,
    detectUsbNameAsync,
    expandHome,
    findCoralUsbIdentity,
    fileIdentity,
    isIoError,
    listWorkloadDirectories,
    listUsbDeviceNamesAsync,
    queryExistsAsync,
    readFileText,
    readFileTextAsync,
    readTrimmed,
    readTrimmedAsync,
    finishIo,
    sameIdentity,
    sendRuntimeCommandText,
};
