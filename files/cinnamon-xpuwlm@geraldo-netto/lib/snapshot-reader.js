"use strict";

// Reading the runtime's published snapshot, for the panel and nothing else.
//
// The helper no longer models the runtime — the Python client does, against
// the canonical schemas with a real schema engine. What survives here is the
// smallest read that can colour an icon and fill a five-line popup: open the
// file the service writes, bound it, parse it, and take the half-dozen fields
// the panel shows. Anything the panel does not draw is not read, not
// validated, and not mirrored.
//
// That is the whole reason this is 130 lines where the applet used to carry
// about 2,700 lines of hand-written contract mirrors: a reader that renders
// six fields needs to agree with the writer about six fields.

const MAX_SNAPSHOT_BYTES = 512 * 1024;
// The service republishes every two seconds; three misses is a runtime that
// has stopped, not one that is briefly busy.
const STALE_AFTER_MS = 15000;
const RUNTIME_STATE_PATH = "~/.local/state/xpu-workload-manager/state.json";

const EMPTY_STATE = Object.freeze({
    runtime: "absent",
    detail: "",
    available: false,
    backend: null,
    load: null,
    reason: "",
    queued: 0,
    running: 0,
    attention: 0,
    generatedAt: null,
});

function expandHome(environment, filename) {
    if (typeof filename !== "string" || !filename.startsWith("~/")) {
        return filename;
    }
    return `${environment.GLib.get_home_dir()}/${filename.slice(2)}`;
}

function isRecord(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function boundedCount(value) {
    return Number.isInteger(value) && value >= 0 ? value : 0;
}

// Absent and zero are different facts: a device that published no load reads
// as unknown rather than as idle.
function boundedLoad(value) {
    return typeof value === "number" && Number.isFinite(value)
        ? Math.max(0, Math.min(100, value))
        : null;
}

// The device the panel speaks for: the runtime orders backends tpu > npu >
// gpu and never schedules onto a CPU, so the first available device in that
// order is the one whose load the label carries.
const BACKEND_ORDER = Object.freeze(["tpu", "npu", "gpu"]);

function primaryDevice(devices) {
    const usable = devices.filter((device) => isRecord(device));
    for (const backend of BACKEND_ORDER) {
        const available = usable.find(
            (device) => device.backend === backend && device.available === true,
        );
        if (available) {
            return available;
        }
    }
    return usable.find((device) => device.available === true) || usable[0] || null;
}

function unresolvedAlerts(alerts) {
    return alerts.filter((alert) => isRecord(alert) && alert.resolved !== true).length;
}

// A runtime word rather than an exception: every failure to read is a state
// the panel has to draw, so each one is named instead of thrown.
function failed(runtime, detail) {
    return Object.freeze({...EMPTY_STATE, runtime, detail});
}

function deviceFields(device) {
    if (!isRecord(device)) {
        return {available: false, backend: null, load: null, reason: ""};
    }
    return {
        available: device.available === true,
        backend: typeof device.backend === "string" ? device.backend : null,
        load: boundedLoad(device.load),
        reason: typeof device.reason === "string" ? device.reason : "",
    };
}

function isStale(generatedAt, nowMs) {
    return generatedAt !== null && nowMs - generatedAt > STALE_AFTER_MS;
}

function stateFromDocument(document, nowMs) {
    if (!isRecord(document)) {
        return failed("malformed", "The runtime snapshot is not an object");
    }
    const generatedAt = Number.isInteger(document.generatedAt) ? document.generatedAt : null;
    if (isStale(generatedAt, nowMs)) {
        return Object.freeze({
            ...EMPTY_STATE,
            runtime: "stale",
            detail: "The runtime stopped publishing",
            generatedAt,
        });
    }
    const metrics = isRecord(document.metrics) ? document.metrics : {};
    return Object.freeze({
        runtime: "connected",
        detail: "",
        ...deviceFields(primaryDevice(Array.isArray(document.devices) ? document.devices : [])),
        queued: boundedCount(metrics.queueDepth),
        running: boundedCount(metrics.runningProfiles),
        attention: unresolvedAlerts(Array.isArray(document.alerts) ? document.alerts : []),
        generatedAt,
    });
}

// `environment` carries GLib and Gio so this stays testable off a desktop:
// the applet passes the real ones, a test passes doubles.
function readSnapshot(environment, filename, nowMs) {
    const target = expandHome(environment, filename);
    let text;
    try {
        const file = environment.Gio.File.new_for_path(target);
        const [ok, contents] = file.load_contents(null);
        if (!ok) {
            return failed("unreadable", "The runtime snapshot could not be read");
        }
        if (contents.length > MAX_SNAPSHOT_BYTES) {
            return failed("malformed", "The runtime snapshot is larger than the panel reads");
        }
        text = environment.decode(contents);
    } catch (error) {
        // Not-found is the ordinary case — the service is not running — and it
        // is reported as absence rather than as a failure someone should act
        // on.
        return environment.Gio.IOErrorEnum !== undefined
            && error?.code === environment.Gio.IOErrorEnum.NOT_FOUND
            ? failed("absent", "The runtime is not running")
            : failed("unreadable", `The runtime snapshot could not be read: ${error}`);
    }
    let document;
    try {
        document = JSON.parse(text);
    } catch (error) {
        return failed("malformed", `The runtime snapshot is not valid JSON: ${error}`);
    }
    return stateFromDocument(document, nowMs);
}

module.exports = {
    BACKEND_ORDER,
    deviceFields,
    EMPTY_STATE,
    MAX_SNAPSHOT_BYTES,
    RUNTIME_STATE_PATH,
    STALE_AFTER_MS,
    expandHome,
    primaryDevice,
    readSnapshot,
    stateFromDocument,
};
