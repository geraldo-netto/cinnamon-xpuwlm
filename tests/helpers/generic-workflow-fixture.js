"use strict";

const {valid: validResult} = require("./workload-result-fixture.js");

function definition(overrides = {}) {
    return {
        version: 1,
        id: "queue-health",
        title: "Queue health",
        description: "Forecast queue pressure from retained scalar telemetry",
        consentPurpose: "Allow bounded queue telemetry for this workload",
        supportsBackground: true,
        retentionText: "Keeps four redacted results until cleared",
        reviewOnly: true,
        ...overrides,
    };
}

function state(overrides = {}) {
    return {
        available: true,
        unavailableReason: "",
        consent: "granted",
        backgroundEnabled: false,
        phase: "idle",
        progress: null,
        warning: "",
        retainedCount: 0,
        result: null,
        ...overrides,
    };
}

module.exports = {definition, state, validResult};
