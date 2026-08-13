"use strict";

const FileSystem = require("./gio-file-adapter.js");

const {
    isIoError,
    readFileTextAsync,
} = FileSystem;

const USB_VENDOR = "18d1";
const USB_PRODUCT = "9302";
const USB_DFU_VENDOR = "1a6e";
const USB_DFU_PRODUCT = "089a";
const CORAL_USB_IDENTITIES = Object.freeze([
    Object.freeze({vendor: USB_VENDOR, product: USB_PRODUCT, name: "Coral USB Accelerator"}),
    Object.freeze({vendor: USB_DFU_VENDOR, product: USB_DFU_PRODUCT, name: "Coral USB Accelerator (DFU)"}),
]);
const DEVICE_CACHE_MS = 10000;
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

module.exports = {
    CORAL_USB_IDENTITIES,
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
    closeEnumeratorAsync,
    collectUsbNames,
    detectDevicesAsync,
    detectGpuDeviceAsync,
    detectNpuDeviceAsync,
    detectPcieDeviceAsync,
    detectTpuDeviceAsync,
    detectUsbDeviceAsync,
    detectUsbNameAsync,
    findCoralUsbIdentity,
    finishIo,
    listUsbDeviceNamesAsync,
    queryExistsAsync,
    readTrimmedAsync,
};
