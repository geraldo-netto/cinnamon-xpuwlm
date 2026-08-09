"use strict";

function ioError(environment, name) {
    const code = environment.Gio.IOErrorEnum[name];
    return {matches: (enumeration, candidate) => enumeration === environment.Gio.IOErrorEnum && candidate === code};
}

function createAsyncDeviceEnvironment({pcie = [], usb = [], accel = [], dri = [], sysfsVendors = {}} = {}) {
    const pciePaths = new Set(pcie.map((index) => `/dev/apex_${index}`));
    const nodePaths = new Set([
        ...accel.map((index) => `/dev/accel/accel${index}`),
        ...dri.map((node) => `/dev/dri/renderD${node}`),
    ]);
    const nodeExists = (path) => pciePaths.has(path) || nodePaths.has(path);
    const usbByName = new Map(usb.map((device, index) => [device.name || `${index + 1}`, device]));
    const environment = {
        closed: false,
        Gio: {
            FileQueryInfoFlags: {NOFOLLOW_SYMLINKS: 1},
            IOErrorEnum: {NOT_FOUND: 1, CANCELLED: 2},
            FileType: {REGULAR: 1, DIRECTORY: 2},
        },
        ByteArray: {toString: (value) => String(value)},
    };

    function textAt(path) {
        if (Object.hasOwn(sysfsVendors, path)) {
            return sysfsVendors[path];
        }
        const match = path.match(/^\/sys\/bus\/usb\/devices\/([^/]+)\/(idVendor|idProduct)$/u);
        if (!match) {
            return null;
        }
        const device = usbByName.get(match[1]);
        return device ? (match[2] === "idVendor" ? device.vendor : device.product) : null;
    }

    class File {
        constructor(path) { this.path = path; }

        query_info_async(attributes, flags, priority, cancellable, callback) { callback(this, {}); }

        query_info_finish() {
            const text = textAt(this.path);
            if (!nodeExists(this.path) && text === null) {
                throw ioError(environment, "NOT_FOUND");
            }
            return {
                get_file_type: () => environment.Gio.FileType.REGULAR,
                // Real sysfs attribute files declare a page-sized st_size no
                // matter how short their content is; the fake mirrors that so
                // bounded id reads are tested against the real kernel behavior.
                get_size: () => (this.path.startsWith("/sys/") ? 4096 : (text === null ? 0 : String(text).length)),
                get_attribute_uint64: () => 1,
                get_attribute_uint32: () => 1,
            };
        }

        enumerate_children_async(attributes, flags, priority, cancellable, callback) {
            callback(this, {});
        }

        enumerate_children_finish() {
            if (this.path !== "/sys/bus/usb/devices" || usbByName.size === 0) {
                throw ioError(environment, "NOT_FOUND");
            }
            const entries = [...usbByName.keys()].map((name) => ({
                get_name: () => name,
                get_file_type: () => environment.Gio.FileType.DIRECTORY,
            }));
            let offset = 0;
            return {
                next_files_async(count, priority, cancellable, callback) { callback(this, {count}); },
                next_files_finish(result) {
                    const batch = entries.slice(offset, offset + result.count);
                    offset += batch.length;
                    return batch;
                },
                close_async(priority, cancellable, callback) { callback(this, {}); },
                close_finish() { environment.closed = true; },
            };
        }

        read_async(priority, cancellable, callback) { callback(this, {}); }

        read_finish() {
            const text = String(textAt(this.path));
            return {
                query_info: () => ({
                    get_attribute_uint64: () => 1,
                    get_attribute_uint32: () => 1,
                }),
                read_bytes_async(count, priority, cancellable, callback) { callback(this, {}); },
                read_bytes_finish: () => ({get_data: () => text}),
            };
        }
    }

    environment.Gio.File = {new_for_path: (path) => new File(path)};
    return {environment, pciePaths, usbByName};
}

function detectAsync(detect, environment) {
    return new Promise((resolve, reject) => detect(environment, null, (error, device) => {
        if (error) {
            reject(error);
        } else {
            resolve(device);
        }
    }));
}

module.exports = {createAsyncDeviceEnvironment, detectAsync};
