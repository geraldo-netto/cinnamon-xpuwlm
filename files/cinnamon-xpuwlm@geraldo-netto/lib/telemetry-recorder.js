"use strict";

// The application layer for `telemetry-window.js`.
//
// The window is a consented, redacted, bounded record; this decides what goes
// into it. Only the three load figures the menu already displays are kept, so
// consenting reveals nothing the user was not already being shown, and the
// redactor is the boundary that enforces it: whatever a snapshot carries, only
// these names reach the window.
//
// A snapshot the runtime could not produce is recorded as a gap rather than
// dropped, because "no samples" and "the source was down" are different
// answers and only one of them is a reason to distrust the record.

const Telemetry = require("./telemetry-window.js");

const SOURCE_ID = "runtime-metrics";
const FEATURE_SCHEMA = Object.freeze({
    version: 1,
    names: Object.freeze(["load", "queue-depth", "running-profiles"]),
});
const STALE_REASON = "snapshot-stale";
const UNAVAILABLE_REASON = "runtime-unavailable";
const MAX_SAMPLES = 256;
const RETENTION_MS = 10 * 60 * 1000;

function scalar(value) {
    return Number.isFinite(value) ? value : 0;
}

// Positional, so a snapshot that grows a field cannot widen what is retained.
function redactMetrics(raw) {
    const metrics = raw && typeof raw === "object" ? raw : {};
    return {
        "load": scalar(metrics.load),
        "queue-depth": scalar(metrics.queueDepth),
        "running-profiles": scalar(metrics.runningProfiles),
    };
}

function snapshotReason(state) {
    if (state.stale === true) {
        return STALE_REASON;
    }
    return state.health?.runtime === "connected" ? null : UNAVAILABLE_REASON;
}

class TelemetryRecorder {
    // The window measures elapsed time, not wall-clock time, so it takes a
    // reading function rather than the applet's `clock.now` object.
    constructor({clock = () => Date.now(), window = null} = {}) {
        this._window = window || new Telemetry.TelemetryWindow({
            clock,
            redact: redactMetrics,
            featureSchema: FEATURE_SCHEMA,
            maxSamples: MAX_SAMPLES,
            retentionMs: RETENTION_MS,
        });
    }

    consented() {
        return this._window.consented();
    }

    // Turning consent off clears the window, which is the window's own
    // behaviour; this only has to not re-record afterwards.
    setConsent(consented) {
        return this._window.setConsent(consented === true);
    }

    record(state) {
        if (!this._window.consented() || state === null || typeof state !== "object") {
            return null;
        }
        const reason = snapshotReason(state);
        if (reason !== null) {
            return this._window.markMissing(SOURCE_ID, reason);
        }
        this._window.recover(SOURCE_ID);
        return this._window.capture(SOURCE_ID, state.metrics);
    }

    // What the diagnostics tab shows: enough to tell a live record from an
    // empty one, and never the samples themselves.
    summary() {
        if (!this._window.consented()) {
            return Object.freeze({consented: false, samples: 0, gaps: 0, retentionMs: RETENTION_MS});
        }
        const {entries} = this._window.replay({});
        return Object.freeze({
            consented: true,
            samples: entries.filter((entry) => entry.kind === "sample").length,
            gaps: entries.filter((entry) => entry.kind === "missing").length,
            retentionMs: RETENTION_MS,
        });
    }
}

module.exports = {
    FEATURE_SCHEMA,
    MAX_SAMPLES,
    RETENTION_MS,
    SOURCE_ID,
    STALE_REASON,
    TelemetryRecorder,
    UNAVAILABLE_REASON,
    redactMetrics,
    snapshotReason,
};
