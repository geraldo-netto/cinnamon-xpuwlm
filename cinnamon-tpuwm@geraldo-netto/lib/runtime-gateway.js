"use strict";

const Domain = require("./domain.js");

const MAX_SNAPSHOT_BYTES = 1024 * 1024;
const WARNING_INITIAL_DELAY_MS = 30 * 1000;
const WARNING_MAX_DELAY_MS = 15 * 60 * 1000;
const SNAPSHOT_READ_FAILURE = "snapshot-read";
const DEVICE_PROBE_FAILURE = "device-probe";

function normalizeDelay(value, fallback) {
    const numeric = Number(value);
    const finite = Number.isFinite(numeric) ? numeric : fallback;
    return Math.max(1, Math.trunc(finite || fallback));
}

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

function parseSnapshotDocument(text, nowMs, staleAfterMs = Domain.DEFAULT_STALE_AFTER_MS) {
    if (typeof text !== "string") {
        return Domain.unavailableSnapshot("Runtime snapshot is not text", nowMs, "invalid");
    }
    if (byteLength(text) > MAX_SNAPSHOT_BYTES) {
        return Domain.unavailableSnapshot("Runtime snapshot exceeds 1 MiB", nowMs, "invalid");
    }
    try {
        return Domain.normalizeSnapshot(JSON.parse(text), nowMs, staleAfterMs);
    } catch {
        return Domain.unavailableSnapshot("Runtime snapshot contains invalid JSON", nowMs, "invalid");
    }
}

class FailureWarningBackoff {
    constructor({
        logger,
        initialDelayMs = WARNING_INITIAL_DELAY_MS,
        maximumDelayMs = WARNING_MAX_DELAY_MS,
    }) {
        if (!logger || typeof logger.warn !== "function") {
            throw new TypeError("A warning logger is required");
        }
        this._logger = logger;
        this._initialDelayMs = normalizeDelay(initialDelayMs, WARNING_INITIAL_DELAY_MS);
        this._maximumDelayMs = Math.max(
            this._initialDelayMs,
            normalizeDelay(maximumDelayMs, WARNING_MAX_DELAY_MS),
        );
        this._failures = new Map();
    }

    warn(failureKey, message, nowMs) {
        const key = String(failureKey);
        const numericNow = Number(nowMs);
        const observedAt = Number.isFinite(numericNow) ? numericNow : 0;
        let previous = this._failures.get(key);
        if (previous && observedAt < previous.lastObservedAt) {
            previous = undefined;
        }
        if (previous && observedAt < previous.nextWarningAt) {
            previous.lastObservedAt = observedAt;
            return false;
        }
        this._logger.warn(message);
        const delayMs = previous
            ? Math.min(previous.delayMs * 2, this._maximumDelayMs)
            : this._initialDelayMs;
        this._failures.set(key, {
            delayMs,
            lastObservedAt: observedAt,
            nextWarningAt: observedAt + delayMs,
        });
        return true;
    }

    recover(failureKey) {
        return this._failures.delete(String(failureKey));
    }
}

class RuntimeSnapshotGateway {
    constructor({
        readText,
        detectDevice,
        path,
        clock = Date,
        staleAfterMs = Domain.DEFAULT_STALE_AFTER_MS,
        logger = {warn() {}},
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
        this._warnings = new FailureWarningBackoff({logger});
    }

    read() {
        const nowMs = this._clock.now();
        let text;
        try {
            text = this._readText(this._path);
            this._warnings.recover(SNAPSHOT_READ_FAILURE);
        } catch (error) {
            this._warnings.warn(
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
        if (typeof text === "string" && text.trim() !== "") {
            return parseSnapshotDocument(text, nowMs, this._staleAfterMs);
        }
        try {
            const snapshot = Domain.probeSnapshot(this._detectDevice(), nowMs);
            this._warnings.recover(DEVICE_PROBE_FAILURE);
            return snapshot;
        } catch (error) {
            this._warnings.warn(
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
    FailureWarningBackoff,
    MAX_SNAPSHOT_BYTES,
    RuntimeSnapshotGateway,
    SNAPSHOT_READ_FAILURE,
    WARNING_INITIAL_DELAY_MS,
    WARNING_MAX_DELAY_MS,
    byteLength,
    normalizeDelay,
    parseSnapshotDocument,
};
