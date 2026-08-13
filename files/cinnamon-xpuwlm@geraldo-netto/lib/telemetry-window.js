"use strict";

// This window retains only redacted, scalar features after explicit consent.
// Monotonic time and sequence cursors make replay safe across polling races;
// explicit missing/recovered entries preserve source-loss evidence.

const Validation = require("./validation.js");

const VERSION = 1;
const MAX_FEATURE_VERSION = 255;
const MAX_FEATURES = 64;
const MAX_SAMPLES = 4096;
const MAX_REPLAY_SAMPLES = 512;
const MAX_RETENTION_MS = 24 * 60 * 60 * 1000;
const MAX_IDENTIFIER_LENGTH = 80;
const IDENTIFIER = /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/u;
const ENTRY_KINDS = Object.freeze(["sample", "missing", "recovered"]);

class TelemetryError extends Error {
    constructor(code, detail) {
        super(detail);
        this.name = "TelemetryError";
        this.code = code;
    }
}

const isRecord = Validation.isRecord;
const exactKeys = Validation.exactKeys;

function identifier(value) {
    return typeof value === "string"
        && value.length >= 1
        && value.length <= MAX_IDENTIFIER_LENGTH
        && IDENTIFIER.test(value);
}

function boundedInteger(value, minimum, maximum) {
    return Number.isSafeInteger(value) && value >= minimum && value <= maximum;
}

function validFeatureSchema(schema) {
    if (!exactKeys(schema, ["version", "names"])
        || !boundedInteger(schema.version, 1, MAX_FEATURE_VERSION)
        || !Array.isArray(schema.names)
        || schema.names.length < 1
        || schema.names.length > MAX_FEATURES) {
        return false;
    }
    return schema.names.every(identifier) && new Set(schema.names).size === schema.names.length;
}

function featureValue(value) {
    return value === null
        || typeof value === "boolean"
        || (typeof value === "number" && Number.isFinite(value));
}

function validFeatures(features, names) {
    return exactKeys(features, names) && names.every((name) => featureValue(features[name]));
}

function validReplayRequest(afterSequence, limit) {
    return boundedInteger(afterSequence, 0, Number.MAX_SAFE_INTEGER)
        && boundedInteger(limit, 1, MAX_REPLAY_SAMPLES);
}

function validateOptions(options) {
    if (!isRecord(options)
        || typeof options.clock !== "function"
        || typeof options.redact !== "function"
        || !validFeatureSchema(options.featureSchema)
        || !boundedInteger(options.maxSamples, 1, MAX_SAMPLES)
        || !boundedInteger(options.retentionMs, 1, MAX_RETENTION_MS)) {
        throw new TelemetryError("options-invalid", "telemetry window options are invalid");
    }
}

function frozenFeatureSchema(schema) {
    return Object.freeze({version: schema.version, names: Object.freeze([...schema.names])});
}

function emptyFeatures(names) {
    return Object.fromEntries(names.map((name) => [name, null]));
}

function frozenEntry({sequence, sourceId, monotonicMs, featureVersion, kind, reasonCode, features}) {
    return Object.freeze({
        version: VERSION,
        sequence,
        sourceId,
        monotonicMs,
        featureVersion,
        kind,
        reasonCode,
        features: Object.freeze({...features}),
    });
}

class TelemetryWindow {
    constructor({clock, redact, featureSchema, maxSamples = 256, retentionMs = 10 * 60 * 1000}) {
        const options = {clock, redact, featureSchema, maxSamples, retentionMs};
        validateOptions(options);
        this._clock = clock;
        this._redact = redact;
        this._featureSchema = frozenFeatureSchema(featureSchema);
        this._maxSamples = maxSamples;
        this._retentionMs = retentionMs;
        this._consented = false;
        this._entries = [];
        this._sources = new Map();
        this._sequence = 0;
        this._lastMonotonicMs = null;
    }

    consented() {
        return this._consented;
    }

    setConsent(consented) {
        if (typeof consented !== "boolean") {
            throw new TelemetryError("consent-invalid", "telemetry consent must be boolean");
        }
        if (consented === this._consented) {
            return false;
        }
        this._consented = consented;
        if (!consented) {
            this._entries = [];
            this._sources.clear();
            this._sequence = 0;
            this._lastMonotonicMs = null;
        }
        return true;
    }

    _now() {
        const observed = this._clock();
        if (!Number.isSafeInteger(observed) || observed < 0) {
            throw new TelemetryError("clock-invalid", "monotonic clock must return a non-negative integer");
        }
        if (this._lastMonotonicMs !== null && observed < this._lastMonotonicMs) {
            throw new TelemetryError("clock-regressed", "monotonic clock moved backwards");
        }
        this._lastMonotonicMs = observed;
        return observed;
    }

    _prune(now) {
        const earliest = Math.max(0, now - this._retentionMs);
        this._entries = this._entries.filter((entry) => entry.monotonicMs >= earliest);
        if (this._entries.length > this._maxSamples) {
            this._entries = this._entries.slice(-this._maxSamples);
        }
    }

    _append(sourceId, monotonicMs, kind, reasonCode, features) {
        this._sequence += 1;
        const entry = frozenEntry({
            sequence: this._sequence,
            sourceId,
            monotonicMs,
            featureVersion: this._featureSchema.version,
            kind,
            reasonCode,
            features,
        });
        this._entries.push(entry);
        this._prune(monotonicMs);
        return entry;
    }

    capture(sourceId, raw) {
        if (!this._consented) {
            return false;
        }
        if (!identifier(sourceId)) {
            throw new TelemetryError("source-invalid", "telemetry source id is invalid");
        }
        if (this._sources.has(sourceId)) {
            throw new TelemetryError("source-lost", `telemetry source ${sourceId} has not recovered`);
        }
        const monotonicMs = this._now();
        const features = this._redact(raw, Object.freeze({
            sourceId, featureVersion: this._featureSchema.version,
        }));
        if (!validFeatures(features, this._featureSchema.names)) {
            throw new TelemetryError("features-invalid", "redactor returned invalid telemetry features");
        }
        return this._append(sourceId, monotonicMs, "sample", null, features);
    }

    markMissing(sourceId, reasonCode) {
        if (!this._consented) {
            return false;
        }
        if (!identifier(sourceId) || !identifier(reasonCode)) {
            throw new TelemetryError("marker-invalid", "missing-sample marker is invalid");
        }
        const monotonicMs = this._now();
        this._sources.set(sourceId, reasonCode);
        return this._append(
            sourceId, monotonicMs, "missing", reasonCode, emptyFeatures(this._featureSchema.names),
        );
    }

    recover(sourceId) {
        if (!this._consented) {
            return false;
        }
        if (!identifier(sourceId)) {
            throw new TelemetryError("source-invalid", "telemetry source id is invalid");
        }
        const reasonCode = this._sources.get(sourceId);
        if (reasonCode === undefined) {
            return false;
        }
        const monotonicMs = this._now();
        this._sources.delete(sourceId);
        return this._append(
            sourceId, monotonicMs, "recovered", reasonCode, emptyFeatures(this._featureSchema.names),
        );
    }

    replay({afterSequence = 0, limit = MAX_REPLAY_SAMPLES} = {}) {
        if (!validReplayRequest(afterSequence, limit)) {
            throw new TelemetryError("replay-invalid", "telemetry replay request is invalid");
        }
        if (this._consented) {
            this._prune(this._now());
        }
        const available = this._entries.filter((entry) => entry.sequence > afterSequence);
        const entries = Object.freeze(available.slice(0, limit));
        const oldestSequence = this._entries.length === 0
            ? this._sequence + 1
            : this._entries[0].sequence;
        return Object.freeze({
            version: VERSION,
            consented: this._consented,
            featureSchema: this._featureSchema,
            oldestSequence,
            latestSequence: this._sequence,
            historyGap: afterSequence < oldestSequence - 1,
            hasMore: available.length > entries.length,
            nextSequence: entries.length === 0 ? afterSequence : entries.at(-1).sequence,
            entries,
        });
    }
}

module.exports = {
    VERSION,
    MAX_FEATURE_VERSION,
    MAX_FEATURES,
    MAX_SAMPLES,
    MAX_REPLAY_SAMPLES,
    MAX_RETENTION_MS,
    MAX_IDENTIFIER_LENGTH,
    ENTRY_KINDS,
    TelemetryError,
    TelemetryWindow,
    validFeatureSchema,
    validFeatures,
};
