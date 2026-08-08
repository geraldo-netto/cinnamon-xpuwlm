"use strict";

const Domain = require("./domain.js");
const FailureReporter = require("./failure-reporter.js");
const SnapshotValidator = require("./snapshot-validator.js");

const MAX_SNAPSHOT_BYTES = 1024 * 1024;
const SNAPSHOT_READ_FAILURE = "snapshot-read";
const DEVICE_PROBE_FAILURE = "device-probe";

function byteLength(text) {
    let length = 0;
    for (const character of text) {
        const codePoint = character.codePointAt(0);
        if (codePoint <= 0x7f) {
            length += 1;
        } else if (codePoint <= 0x7ff) {
            length += 2;
        } else if (codePoint <= 0xffff) {
            length += 3;
        } else {
            length += 4;
        }
    }
    return length;
}

function parseSnapshotDocument(
    text,
    nowMs,
    snapshotValidator,
    staleAfterMs = Domain.DEFAULT_STALE_AFTER_MS,
    workloadCatalog = Domain.EMPTY_WORKLOAD_CATALOG,
) {
    if (typeof text !== "string") {
        return Domain.unavailableSnapshot("Runtime snapshot is not text", nowMs, "invalid");
    }
    if (byteLength(text) > MAX_SNAPSHOT_BYTES) {
        return Domain.unavailableSnapshot("Runtime snapshot exceeds 1 MiB", nowMs, "invalid");
    }
    let candidate;
    try {
        candidate = JSON.parse(text);
    } catch {
        return Domain.unavailableSnapshot("Runtime snapshot contains invalid JSON", nowMs, "invalid");
    }
    try {
        const report = SnapshotValidator.validateSnapshot(snapshotValidator, candidate);
        if (!report.valid) {
            return Domain.unavailableSnapshot(
                "Runtime snapshot does not match the version 1 schema",
                nowMs,
                "invalid",
            );
        }
    } catch {
        return Domain.unavailableSnapshot("Runtime snapshot validation failed", nowMs, "invalid");
    }
    return Domain.normalizeSnapshot(candidate, nowMs, staleAfterMs, workloadCatalog);
}

// Reads are asynchronous, sequenced, and cancellable: only one read is ever in
// flight, a completion that arrives after a newer read (or after teardown) is
// discarded, and teardown cancels whatever is still pending.
function requirePorts({readTextAsync, detectDevice, clock, cancellableFactory}) {
    for (const [port, description] of [
        [readTextAsync, "An asynchronous text reader is required"],
        [detectDevice, "A device detector is required"],
        [cancellableFactory, "A cancellable factory is required"],
    ]) {
        if (typeof port !== "function") {
            throw new TypeError(description);
        }
    }
    if (!clock || typeof clock.now !== "function") {
        throw new TypeError("A clock with now is required");
    }
    return true;
}

class RuntimeSnapshotGateway {
    constructor({
        readTextAsync,
        detectDevice,
        path,
        snapshotValidator,
        warningReporter,
        clock = Date,
        staleAfterMs = Domain.DEFAULT_STALE_AFTER_MS,
        cancellableFactory = () => null,
        workloadCatalog = Domain.EMPTY_WORKLOAD_CATALOG,
    }) {
        requirePorts({readTextAsync, detectDevice, clock, cancellableFactory});
        this._readTextAsync = readTextAsync;
        this._detectDevice = detectDevice;
        this._cancellableFactory = cancellableFactory;
        this._path = String(path || "");
        this._clock = clock;
        this._staleAfterMs = Domain.normalizeStaleAfterMs(staleAfterMs);
        this._snapshotValidator = SnapshotValidator.requireSnapshotValidator(snapshotValidator);
        this._workloadCatalog = Domain.requireWorkloadCatalog(workloadCatalog);
        this._warnings = FailureReporter.requireFailureReporter(warningReporter, "runtime warning");
        this._sequence = 0;
        this._pending = null;
    }

    read(options, callback) {
        if (typeof callback !== "function") {
            throw new TypeError("A snapshot callback is required");
        }
        const forceDeviceDetection = options?.forceDeviceDetection === true;
        const nowMs = this._clock.now();
        this.cancel();
        this._sequence += 1;
        const sequence = this._sequence;
        const cancellable = this._cancellableFactory();
        this._pending = {sequence, cancellable};

        let settled = false;
        const deliver = (snapshot) => {
            if (settled || sequence !== this._sequence) {
                return false;
            }
            settled = true;
            this._pending = null;
            callback(snapshot);
            return true;
        };

        try {
            this._readTextAsync(
                this._path,
                {maximumBytes: MAX_SNAPSHOT_BYTES + 1, cancellable},
                (error, text) => this._complete(
                    error,
                    text,
                    nowMs,
                    forceDeviceDetection,
                    cancellable,
                    deliver,
                ),
            );
        } catch (error) {
            this._reportReadFailure(error, nowMs, deliver);
        }
        return true;
    }

    cancel() {
        if (this._pending === null) {
            return false;
        }
        const {cancellable} = this._pending;
        this._pending = null;
        this._sequence += 1;
        if (cancellable && typeof cancellable.cancel === "function") {
            cancellable.cancel();
        }
        return true;
    }

    _complete(error, text, nowMs, forceDeviceDetection, cancellable, deliver) {
        if (error) {
            this._reportReadFailure(error, nowMs, deliver);
            return false;
        }
        this._warnings.recover(SNAPSHOT_READ_FAILURE);
        const snapshotIsMissing = text === null;
        const snapshotIsEmpty = typeof text === "string" && text.trim() === "";
        if (!snapshotIsMissing && !snapshotIsEmpty) {
            return deliver(parseSnapshotDocument(
                text,
                nowMs,
                this._snapshotValidator,
                this._staleAfterMs,
                this._workloadCatalog,
            ));
        }
        return this._probe(nowMs, forceDeviceDetection, cancellable, deliver);
    }

    _probe(nowMs, forceDeviceDetection, cancellable, deliver) {
        try {
            const accept = (error, device) => {
                if (error) {
                    this._reportProbeFailure(error, nowMs, deliver);
                    return;
                }
                this._warnings.recover(DEVICE_PROBE_FAILURE);
                deliver(Domain.probeSnapshot(device, nowMs));
            };
            const result = this._detectDevice(forceDeviceDetection, {cancellable}, accept);
            if (result && typeof result === "object") {
                accept(null, result);
            }
            return true;
        } catch (error) {
            return this._reportProbeFailure(error, nowMs, deliver);
        }
    }

    _reportProbeFailure(error, nowMs, deliver) {
        this._warnings.report(
            DEVICE_PROBE_FAILURE,
            `Could not probe TPU devices: ${error}`,
            nowMs,
        );
        return deliver(Domain.unavailableSnapshot("TPU device discovery failed", nowMs, "probe"));
    }

    _reportReadFailure(error, nowMs, deliver) {
        this._warnings.report(
            SNAPSHOT_READ_FAILURE,
            `Could not read ${this._path}: ${error}`,
            nowMs,
        );
        return deliver(Domain.unavailableSnapshot(
            "Runtime snapshot could not be read",
            nowMs,
            "error",
        ));
    }
}

module.exports = {
    DEVICE_PROBE_FAILURE,
    MAX_SNAPSHOT_BYTES,
    RuntimeSnapshotGateway,
    SNAPSHOT_READ_FAILURE,
    byteLength,
    parseSnapshotDocument,
    requirePorts,
};
