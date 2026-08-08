"use strict";

const FAILURE_INITIAL_DELAY_MS = 30 * 1000;
const FAILURE_MAX_DELAY_MS = 15 * 60 * 1000;

function normalizeDelay(value, fallback) {
    const numeric = Number(value);
    const finite = Number.isFinite(numeric) ? numeric : fallback;
    return Math.max(1, Math.trunc(finite || fallback));
}

class FailureLogBackoff {
    constructor({
        emit,
        initialDelayMs = FAILURE_INITIAL_DELAY_MS,
        maximumDelayMs = FAILURE_MAX_DELAY_MS,
    }) {
        if (typeof emit !== "function") {
            throw new TypeError("A log emitter is required");
        }
        this._emit = emit;
        this._initialDelayMs = normalizeDelay(initialDelayMs, FAILURE_INITIAL_DELAY_MS);
        this._maximumDelayMs = Math.max(
            this._initialDelayMs,
            normalizeDelay(maximumDelayMs, FAILURE_MAX_DELAY_MS),
        );
        this._failures = new Map();
    }

    report(failureKey, message, nowMs) {
        const numericNow = Number(nowMs);
        const observedAt = Number.isFinite(numericNow) ? numericNow : 0;
        let previous = this._failures.get(failureKey);
        if (previous && observedAt < previous.lastObservedAt) {
            previous = undefined;
        }
        if (previous && observedAt < previous.nextLogAt) {
            previous.lastObservedAt = observedAt;
            return false;
        }
        this._emit(message);
        const delayMs = previous
            ? Math.min(previous.delayMs * 2, this._maximumDelayMs)
            : this._initialDelayMs;
        this._failures.set(failureKey, {
            delayMs,
            lastObservedAt: observedAt,
            nextLogAt: observedAt + delayMs,
        });
        return true;
    }

    recover(failureKey) {
        return this._failures.delete(failureKey);
    }
}

class FailureErrorBackoff extends FailureLogBackoff {
    constructor({
        logger,
        initialDelayMs = FAILURE_INITIAL_DELAY_MS,
        maximumDelayMs = FAILURE_MAX_DELAY_MS,
    }) {
        if (!logger || typeof logger.error !== "function") {
            throw new TypeError("An error logger is required");
        }
        super({
            emit: (message) => logger.error(message),
            initialDelayMs,
            maximumDelayMs,
        });
    }

    error(failureKey, message, nowMs) {
        return this.report(failureKey, message, nowMs);
    }
}

class FailureWarningBackoff extends FailureLogBackoff {
    constructor({
        logger,
        initialDelayMs = FAILURE_INITIAL_DELAY_MS,
        maximumDelayMs = FAILURE_MAX_DELAY_MS,
    }) {
        if (!logger || typeof logger.warn !== "function") {
            throw new TypeError("A warning logger is required");
        }
        super({
            emit: (message) => logger.warn(message),
            initialDelayMs,
            maximumDelayMs,
        });
    }

    warn(failureKey, message, nowMs) {
        return this.report(String(failureKey), message, nowMs);
    }

    recover(failureKey) {
        return super.recover(String(failureKey));
    }
}

module.exports = {
    FAILURE_INITIAL_DELAY_MS,
    FAILURE_MAX_DELAY_MS,
    FailureErrorBackoff,
    FailureLogBackoff,
    FailureWarningBackoff,
    normalizeDelay,
};
