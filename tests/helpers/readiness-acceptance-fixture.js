"use strict";

const Readiness = require(
    "../../files/cinnamon-xpuwlm@geraldo-netto/lib/readiness-acceptance.js"
);

const A = "a".repeat(64);
const B = "b".repeat(64);

function scenario(id, index) {
    const resultRequired = id === "click-to-result" || id === "recovery";
    return {
        id,
        execution: "real-cinnamon",
        clickControlId: `generic-health-${id}`,
        startedAt: 1100 + (index * 100),
        endedAt: 1150 + (index * 100),
        expectedOutcome: Readiness.EXPECTED_OUTCOMES[id],
        observedOutcome: Readiness.EXPECTED_OUTCOMES[id],
        resultValid: resultRequired,
        resultSha256: resultRequired ? B : null,
        errors: [],
        warnings: [],
    };
}

function valid(overrides = {}) {
    return {
        version: 1,
        workloadId: "queue-health",
        measuredAt: 2000,
        hardware: {
            hostId: "workstation-1",
            deviceName: "AMD Radeon RX 7900 XTX",
            backend: "gpu",
            driverVersion: "mesa-26.1.0",
            runtimeVersion: "omnitensor-0.1.0",
        },
        recording: {
            sessionType: "cinnamon-screen-recording",
            startedAt: 1000,
            endedAt: 2000,
            replaySha256: A,
        },
        scenarios: Readiness.SCENARIOS.map(scenario),
        ...overrides,
    };
}

function clone(value) {
    return JSON.parse(JSON.stringify(value));
}

module.exports = {A, B, clone, scenario, valid};
