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
    return Domain.normalizeSnapshot(candidate, nowMs, staleAfterMs);
}

class RuntimeSnapshotGateway {
    constructor({
        readText,
        detectDevice,
        path,
        snapshotValidator,
        warningReporter,
        clock = Date,
        staleAfterMs = Domain.DEFAULT_STALE_AFTER_MS,
    }) {
        if (typeof readText !== "function") {
            throw new TypeError("A text reader is required");
        }
        if (typeof detectDevice !== "function") {
            throw new TypeError("A device detector is required");
        }
        if (!clock || typeof clock.now !== "function") {
            throw new TypeError("A clock with now is required");
        }
        this._readText = readText;
        this._detectDevice = detectDevice;
        this._path = String(path || "");
        this._clock = clock;
        this._staleAfterMs = Domain.normalizeStaleAfterMs(staleAfterMs);
        this._snapshotValidator = SnapshotValidator.requireSnapshotValidator(snapshotValidator);
        this._warnings = FailureReporter.requireFailureReporter(warningReporter, "runtime warning");
    }

    read(options = {}) {
        const forceDeviceDetection = options?.forceDeviceDetection === true;
        const nowMs = this._clock.now();
        let text;
        try {
            text = this._readText(this._path);
            this._warnings.recover(SNAPSHOT_READ_FAILURE);
        } catch (error) {
            this._warnings.report(
                SNAPSHOT_READ_FAILURE,
                `Could not read ${this._path}: ${error}`,
                nowMs,
            );
            return Domain.unavailableSnapshot(
                "Runtime snapshot could not be read",
                nowMs,
                "invalid",
            );
        }
        const snapshotIsMissing = text === null;
        const snapshotIsEmpty = typeof text === "string" && text.trim() === "";
        if (!snapshotIsMissing && !snapshotIsEmpty) {
            return parseSnapshotDocument(
                text,
                nowMs,
                this._snapshotValidator,
                this._staleAfterMs,
            );
        }
        try {
            const snapshot = Domain.probeSnapshot(
                this._detectDevice(forceDeviceDetection),
                nowMs,
            );
            this._warnings.recover(DEVICE_PROBE_FAILURE);
            return snapshot;
        } catch (error) {
            this._warnings.report(
                DEVICE_PROBE_FAILURE,
                `Could not probe TPU devices: ${error}`,
                nowMs,
            );
            return Domain.unavailableSnapshot("TPU device discovery failed", nowMs, "probe");
        }
    }
}

module.exports = {
    DEVICE_PROBE_FAILURE,
    MAX_SNAPSHOT_BYTES,
    RuntimeSnapshotGateway,
    SNAPSHOT_READ_FAILURE,
    byteLength,
    parseSnapshotDocument,
};
