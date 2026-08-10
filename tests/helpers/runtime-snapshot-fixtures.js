"use strict";

const NOW = 1_700_000_000_000;

function validRuntimeSnapshot() {
    return {
        version: 1,
        generatedAt: NOW - 500,
        devices: [
            {
                id: "tpu-usb",
                backend: "tpu",
                available: true,
                name: "Coral USB",
                kind: "usb",
                vendor: "18d1:9302",
                load: 37.5,
                reason: "",
            },
            {
                id: "gpu-renderD128",
                backend: "gpu",
                available: false,
                name: "NVIDIA GPU",
                kind: "dri",
                vendor: "0x10de",
                load: null,
                reason: "Runtime not installed",
            },
        ],
        metrics: {
            queueDepth: 4,
            runningProfiles: 2,
        },
        profiles: {
            "hardware-health": {
                status: "running",
                queued: 3,
                detail: "sampling",
            },
        },
        alerts: [{
            id: "power-risk",
            profileId: "hardware-health",
            title: "Voltage drift",
            summary: "Review voltage history",
            severity: "warning",
            timestamp: NOW - 1000,
            confidence: 0.8,
            riskScore: 0.7,
            resolved: false,
        }],
    };
}

// Time-independent `generatedAt` values: the JSON schema, the handwritten
// validator, and domain normalization must agree on every one of them.
function generatedAtParityCases() {
    return [
        {name: "negative", value: -1, accepted: false},
        {name: "epoch zero", value: 0, accepted: false},
        {name: "smallest accepted", value: 1, accepted: true},
        {name: "fractional", value: 1.5, accepted: false},
        {name: "non-finite", value: Number.NaN, accepted: false},
        {name: "non-numeric", value: "1700000000000", accepted: false},
        {name: "recent", value: NOW - 500, accepted: true},
    ];
}

function snapshotCase(name, expected, change) {
    const value = validRuntimeSnapshot();
    change(value);
    return {name, expected, value};
}

function deviceEntry(overrides = {}) {
    return {
        id: "npu-accel0",
        backend: "npu",
        available: true,
        name: "Intel NPU",
        kind: "accel",
        ...overrides,
    };
}

// The runtime publishes plug-in telemetry as an optional root extension. The
// applet never reads it, but it must validate it exactly as the schema does,
// or a snapshot carrying it is discarded whole.
function pluginTelemetryEntry(overrides = {}) {
    return {
        id: "low-light-enhancement",
        health: "healthy",
        stage: "infer",
        artifactReadiness: "ready",
        queuedJobs: 2,
        activeJobs: 1,
        lastSuccessAt: NOW - 2000,
        lastErrorCode: null,
        lastErrorAt: null,
        deadlineExceeded: 0,
        retries: 3,
        cancellations: 0,
        drops: 0,
        successes: 41,
        failures: 1,
        ...overrides,
    };
}

function pluginTelemetry(overrides = {}) {
    return {version: 1, plugins: [pluginTelemetryEntry()], ...overrides};
}

function telemetryPluginKeys() {
    return Object.keys(pluginTelemetryEntry());
}

function acceptedTelemetryCases() {
    return [
        snapshotCase("plug-in telemetry present", true, (value) => {
            value.pluginTelemetry = pluginTelemetry();
        }),
        snapshotCase("plug-in telemetry with no plug-ins", true, (value) => {
            value.pluginTelemetry = pluginTelemetry({plugins: []});
        }),
        snapshotCase("one hundred and twenty-eight telemetry plug-ins", true, (value) => {
            value.pluginTelemetry = pluginTelemetry({
                plugins: Array.from({length: 128}, (_, index) =>
                    pluginTelemetryEntry({id: `plugin-${index}`})),
            });
        }),
        snapshotCase("telemetry nullable fields null", true, (value) => {
            value.pluginTelemetry = pluginTelemetry({
                plugins: [pluginTelemetryEntry({
                    stage: null,
                    lastSuccessAt: null,
                    lastErrorAt: null,
                    lastErrorCode: null,
                })],
            });
        }),
        snapshotCase("telemetry numeric bounds", true, (value) => {
            value.pluginTelemetry = pluginTelemetry({
                plugins: [
                    pluginTelemetryEntry({
                        queuedJobs: 0,
                        activeJobs: 0,
                        lastSuccessAt: 0,
                        lastErrorAt: 0,
                        deadlineExceeded: 0,
                        retries: 0,
                        cancellations: 0,
                        drops: 0,
                        successes: 0,
                        failures: 0,
                    }),
                    pluginTelemetryEntry({
                        id: "b",
                        queuedJobs: 1_000_000,
                        activeJobs: 1024,
                        lastSuccessAt: Number.MAX_SAFE_INTEGER,
                        lastErrorAt: Number.MAX_SAFE_INTEGER,
                        lastErrorCode: "a".repeat(80),
                        deadlineExceeded: 1_000_000_000,
                        retries: 1_000_000_000,
                        cancellations: 1_000_000_000,
                        drops: 1_000_000_000,
                        successes: 1_000_000_000,
                        failures: 1_000_000_000,
                    }),
                ],
            });
        }),
        snapshotCase("every telemetry health, stage, and readiness value", true, (value) => {
            const healths = ["initializing", "healthy", "degraded", "unavailable", "stopped"];
            const stages = [
                null, "collect", "preprocess", "resolve", "infer", "postprocess", "deliver",
                "terminal",
            ];
            const readiness = [
                "unknown", "resolving", "ready", "missing", "rejected", "incompatible",
            ];
            value.pluginTelemetry = pluginTelemetry({
                plugins: stages.map((stage, index) => pluginTelemetryEntry({
                    id: `plugin-${index}`,
                    stage,
                    health: healths[index % healths.length],
                    artifactReadiness: readiness[index % readiness.length],
                })),
            });
        }),
    ];
}

function rejectedTelemetryCases() {
    const cases = [
        snapshotCase("telemetry scalar", false, (value) => {
            value.pluginTelemetry = "on";
        }),
        snapshotCase("telemetry array", false, (value) => {
            value.pluginTelemetry = [];
        }),
        snapshotCase("telemetry wrong version", false, (value) => {
            value.pluginTelemetry = pluginTelemetry({version: 2});
        }),
        snapshotCase("telemetry missing plugins", false, (value) => {
            value.pluginTelemetry = {version: 1};
        }),
        snapshotCase("telemetry additional property", false, (value) => {
            value.pluginTelemetry = pluginTelemetry({unexpected: true});
        }),
        snapshotCase("telemetry plugins object", false, (value) => {
            value.pluginTelemetry = pluginTelemetry({plugins: {}});
        }),
        snapshotCase("telemetry plug-in scalar", false, (value) => {
            value.pluginTelemetry = pluginTelemetry({plugins: [null]});
        }),
        snapshotCase("more than one hundred and twenty-eight telemetry plug-ins", false, (value) => {
            value.pluginTelemetry = pluginTelemetry({
                plugins: Array.from({length: 129}, (_, index) =>
                    pluginTelemetryEntry({id: `plugin-${index}`})),
            });
        }),
        snapshotCase("telemetry plug-in additional property", false, (value) => {
            value.pluginTelemetry = pluginTelemetry({
                plugins: [pluginTelemetryEntry({unexpected: true})],
            });
        }),
    ];
    const replacements = [
        ["telemetry id empty", {id: ""}],
        ["telemetry id uppercase", {id: "Low-Light"}],
        ["telemetry id trailing dash", {id: "low-"}],
        ["telemetry id above maximum", {id: `a${"-a".repeat(40)}`}],
        ["telemetry id non-string", {id: 7}],
        ["telemetry health unknown", {health: "future"}],
        ["telemetry stage unknown", {stage: "future"}],
        ["telemetry readiness unknown", {artifactReadiness: "future"}],
        ["telemetry queued fractional", {queuedJobs: 1.5}],
        ["telemetry queued negative", {queuedJobs: -1}],
        ["telemetry queued above maximum", {queuedJobs: 1_000_001}],
        ["telemetry active above maximum", {activeJobs: 1025}],
        ["telemetry last success fractional", {lastSuccessAt: 1.5}],
        ["telemetry last success negative", {lastSuccessAt: -1}],
        ["telemetry last success above maximum", {lastSuccessAt: Number.MAX_SAFE_INTEGER + 2}],
        ["telemetry last error at wrong type", {lastErrorAt: "now"}],
        ["telemetry error code empty", {lastErrorCode: ""}],
        ["telemetry error code uppercase", {lastErrorCode: "Timeout"}],
        ["telemetry error code wrong type", {lastErrorCode: 7}],
        ["telemetry counter fractional", {retries: 1.5}],
        ["telemetry counter negative", {drops: -1}],
        ["telemetry counter above maximum", {successes: 1_000_000_001}],
        ["telemetry counter wrong type", {failures: "1"}],
    ];
    for (const [name, overrides] of replacements) {
        cases.push(snapshotCase(name, false, (value) => {
            value.pluginTelemetry = pluginTelemetry({plugins: [pluginTelemetryEntry(overrides)]});
        }));
    }
    for (const key of telemetryPluginKeys()) {
        cases.push(snapshotCase(`missing telemetry plug-in ${key}`, false, (value) => {
            const entry = pluginTelemetryEntry();
            delete entry[key];
            value.pluginTelemetry = pluginTelemetry({plugins: [entry]});
        }));
    }
    return cases;
}

function runtimeSnapshotSchemaCases() {
    const cases = [
        {name: "complete snapshot", expected: true, value: validRuntimeSnapshot()},
        snapshotCase("optional fields absent", true, (value) => {
            value.devices = [deviceEntry()];
            value.profiles = {future: {}};
            delete value.alerts[0].confidence;
            delete value.alerts[0].riskScore;
            delete value.alerts[0].resolved;
        }),
        snapshotCase("nullable measurements", true, (value) => {
            value.devices[0].load = null;
            value.alerts[0].confidence = null;
            value.alerts[0].riskScore = null;
        }),
        snapshotCase("zero minima", true, (value) => {
            value.devices[0].load = 0;
            value.metrics = {queueDepth: 0, runningProfiles: 0};
            value.profiles.future = {queued: 0};
            value.alerts[0].timestamp = 0;
            value.alerts[0].confidence = 0;
            value.alerts[0].riskScore = 0;
        }),
        snapshotCase("smallest accepted generatedAt", true, (value) => {
            value.generatedAt = 1;
        }),
        snapshotCase("numeric maxima", true, (value) => {
            value.devices[0].load = 100;
            value.metrics = {queueDepth: 1_000_000, runningProfiles: 128};
            value.profiles["hardware-health"].queued = 1_000_000;
            value.alerts[0].confidence = 1;
            value.alerts[0].riskScore = 1;
        }),
        snapshotCase("every backend and kind", true, (value) => {
            value.devices = [
                deviceEntry({id: "tpu-pcie-0", backend: "tpu", kind: "pcie"}),
                deviceEntry({id: "npu-accel0", backend: "npu", kind: "accel"}),
                deviceEntry({id: "gpu-renderD128", backend: "gpu", kind: "dri"}),
                deviceEntry({id: "tpu-usb", backend: "tpu", kind: "usb"}),
                deviceEntry({id: "mystery", backend: "gpu", kind: "unknown"}),
            ];
        }),
        snapshotCase("sixteen devices", true, (value) => {
            value.devices = Array.from({length: 16}, (_, index) =>
                deviceEntry({id: `npu-accel${index}`}));
        }),
        // Neither JSON Schema 2020-12 nor the handwritten mirror rejects
        // duplicate ids; domain normalization dedupes first-wins instead.
        snapshotCase("duplicate device ids accepted", true, (value) => {
            value.devices = [deviceEntry(), deviceEntry({name: "Impostor"})];
        }),
        snapshotCase("Unicode code-point limits", true, (value) => {
            value.devices[0].id = "💡".repeat(80);
            value.devices[0].name = "💡".repeat(120);
            value.devices[0].vendor = "💡".repeat(80);
            value.devices[0].reason = "💡".repeat(240);
            value.profiles["hardware-health"].detail = "💡".repeat(240);
            value.alerts[0].id = "💡".repeat(120);
            value.alerts[0].profileId = "💡".repeat(80);
            value.alerts[0].title = "💡".repeat(160);
            value.alerts[0].summary = "💡".repeat(500);
        }),
        snapshotCase("alert result reference", true, (value) => {
            value.alerts[0].resultRef = "result-x";
        }),
        // The machine-readable blocker code. Absent from the fixtures, a new
        // optional field is invisible to the equivalence fuzz test, which is
        // how the validator came to reject every snapshot the runtime
        // published while the fuzz test stayed green.
        snapshotCase("profile reason code", true, (value) => {
            value.profiles["hardware-health"].reason = "serving";
        }),
        snapshotCase("profile reason the applet does not know", false, (value) => {
            value.profiles["hardware-health"].reason = "invented";
        }),
        snapshotCase("profile reason of the wrong type", false, (value) => {
            value.profiles["hardware-health"].reason = 1;
        }),
        snapshotCase("alert result reference at the maximum", true, (value) => {
            value.alerts[0].resultRef = `result-${"a".repeat(113)}`;
        }),
        snapshotCase("alert result reference punctuation", true, (value) => {
            value.alerts[0].resultRef = "result-A.9_z-0";
        }),
        snapshotCase("one hundred alerts", true, (value) => {
            value.alerts = Array.from({length: 100}, (_, index) => ({
                ...value.alerts[0],
                id: `alert-${index}`,
            }));
        }),
    ];

    for (const key of ["version", "generatedAt", "devices", "metrics", "profiles", "alerts"]) {
        cases.push(snapshotCase(`missing root ${key}`, false, (value) => { delete value[key]; }));
    }
    for (const key of ["id", "backend", "available", "name", "kind"]) {
        cases.push(snapshotCase(`missing device ${key}`, false, (value) => { delete value.devices[0][key]; }));
    }
    for (const key of ["queueDepth", "runningProfiles"]) {
        cases.push(snapshotCase(`missing metrics ${key}`, false, (value) => { delete value.metrics[key]; }));
    }
    for (const key of ["id", "profileId", "title", "summary", "severity", "timestamp"]) {
        cases.push(snapshotCase(`missing alert ${key}`, false, (value) => { delete value.alerts[0][key]; }));
    }
    for (const [name, target] of [
        ["root", (value) => value],
        ["device", (value) => value.devices[0]],
        ["metrics", (value) => value.metrics],
        ["profile", (value) => value.profiles["hardware-health"]],
        ["alert", (value) => value.alerts[0]],
    ]) {
        cases.push(snapshotCase(`additional ${name} property`, false, (value) => {
            target(value).unexpected = true;
        }));
    }

    const replacements = [
        ["root null", (value) => value, null],
        ["root array", (value) => value, []],
        ["wrong version", (value) => value, {version: 2}],
        ["fractional generatedAt", (value) => value, {generatedAt: 1.5}],
        ["zero generatedAt", (value) => value, {generatedAt: 0}],
        ["negative generatedAt", (value) => value, {generatedAt: -1}],
        ["devices scalar", (value) => value, {devices: "usb"}],
        ["devices object", (value) => value, {devices: {}}],
        ["devices empty", (value) => value, {devices: []}],
        ["device entry scalar", (value) => value.devices, {0: "usb"}],
        ["device id empty", (value) => value.devices[0], {id: ""}],
        ["device id non-string", (value) => value.devices[0], {id: 7}],
        ["device backend unknown", (value) => value.devices[0], {backend: "future"}],
        ["device backend cpu rejected", (value) => value.devices[0], {backend: "cpu"}],
        ["device backend legacy edge-tpu", (value) => value.devices[0], {backend: "edge-tpu"}],
        ["available non-boolean", (value) => value.devices[0], {available: 1}],
        ["device name non-string", (value) => value.devices[0], {name: 7}],
        ["device kind unknown", (value) => value.devices[0], {kind: "future"}],
        ["device vendor non-string", (value) => value.devices[0], {vendor: 7}],
        ["device load non-number", (value) => value.devices[0], {load: "37"}],
        ["device load below minimum", (value) => value.devices[0], {load: -0.1}],
        ["device load above maximum", (value) => value.devices[0], {load: 100.1}],
        ["device load non-finite", (value) => value.devices[0], {load: Number.NaN}],
        ["device reason non-string", (value) => value.devices[0], {reason: null}],
        ["metrics scalar", (value) => value, {metrics: []}],
        ["metrics legacy load property", (value) => value.metrics, {load: 37.5}],
        ["fractional queue", (value) => value.metrics, {queueDepth: 1.5}],
        ["negative queue", (value) => value.metrics, {queueDepth: -1}],
        ["queue above maximum", (value) => value.metrics, {queueDepth: 1_000_001}],
        ["fractional running count", (value) => value.metrics, {runningProfiles: 1.5}],
        ["negative running count", (value) => value.metrics, {runningProfiles: -1}],
        ["running count above maximum", (value) => value.metrics, {runningProfiles: 129}],
        ["profiles array", (value) => value, {profiles: []}],
        ["profile scalar", (value) => value.profiles, {"hardware-health": null}],
        ["profile status unknown", (value) => value.profiles["hardware-health"], {status: "future"}],
        ["profile queue fractional", (value) => value.profiles["hardware-health"], {queued: 0.5}],
        ["profile queue negative", (value) => value.profiles["hardware-health"], {queued: -1}],
        ["profile queue above maximum", (value) => value.profiles["hardware-health"], {queued: 1_000_001}],
        ["profile detail non-string", (value) => value.profiles["hardware-health"], {detail: false}],
        ["alerts object", (value) => value, {alerts: {}}],
        ["alert scalar", (value) => value.alerts, {0: null}],
        ["empty alert id", (value) => value.alerts[0], {id: ""}],
        ["empty alert profile", (value) => value.alerts[0], {profileId: ""}],
        ["empty alert title", (value) => value.alerts[0], {title: ""}],
        ["alert summary non-string", (value) => value.alerts[0], {summary: null}],
        ["alert severity unknown", (value) => value.alerts[0], {severity: "future"}],
        ["alert timestamp fractional", (value) => value.alerts[0], {timestamp: 1.5}],
        ["alert timestamp negative", (value) => value.alerts[0], {timestamp: -1}],
        ["confidence below minimum", (value) => value.alerts[0], {confidence: -0.1}],
        ["confidence above maximum", (value) => value.alerts[0], {confidence: 1.1}],
        ["confidence wrong type", (value) => value.alerts[0], {confidence: "0.5"}],
        ["risk below minimum", (value) => value.alerts[0], {riskScore: -0.1}],
        ["risk above maximum", (value) => value.alerts[0], {riskScore: 1.1}],
        ["risk wrong type", (value) => value.alerts[0], {riskScore: false}],
        ["resolved wrong type", (value) => value.alerts[0], {resolved: 0}],
        ["result reference wrong prefix", (value) => value.alerts[0], {resultRef: "job-12345"}],
        ["result reference bare prefix", (value) => value.alerts[0], {resultRef: "result-"}],
        ["result reference illegal character", (value) => value.alerts[0], {resultRef: "result-a b"}],
        ["result reference non-ASCII", (value) => value.alerts[0], {resultRef: "result-💡"}],
        ["result reference wrong type", (value) => value.alerts[0], {resultRef: 7}],
        ["result reference null", (value) => value.alerts[0], {resultRef: null}],
        ["result reference above maximum", (value) => value.alerts[0], {resultRef: `result-${"a".repeat(114)}`}],
    ];
    for (const [name, target, replacement] of replacements) {
        if (name === "root null" || name === "root array") {
            cases.push({name, expected: false, value: replacement});
            continue;
        }
        cases.push(snapshotCase(name, false, (value) => Object.assign(target(value), replacement)));
    }

    for (const [name, target, maximum] of [
        ["device id", (value) => value.devices[0], 80],
        ["device name", (value) => value.devices[0], 120],
        ["device vendor", (value) => value.devices[0], 80],
        ["device reason", (value) => value.devices[0], 240],
        ["profile detail", (value) => value.profiles["hardware-health"], 240],
        ["alert id", (value) => value.alerts[0], 120],
        ["alert profile", (value) => value.alerts[0], 80],
        ["alert title", (value) => value.alerts[0], 160],
        ["alert summary", (value) => value.alerts[0], 500],
    ]) {
        const property = {
            "device id": "id",
            "device name": "name",
            "device vendor": "vendor",
            "device reason": "reason",
            "profile detail": "detail",
            "alert id": "id",
            "alert profile": "profileId",
            "alert title": "title",
            "alert summary": "summary",
        }[name];
        cases.push(snapshotCase(`${name} above Unicode limit`, false, (value) => {
            target(value)[property] = "💡".repeat(maximum + 1);
        }));
    }
    cases.push(snapshotCase("more than sixteen devices", false, (value) => {
        value.devices = Array.from({length: 17}, (_, index) =>
            deviceEntry({id: `npu-accel${index}`}));
    }));
    cases.push(snapshotCase("one hundred and twenty-eight profiles", true, (value) => {
        value.profiles = Object.fromEntries(
            Array.from({length: 128}, (_, index) => [`plugin-${index}`, {queued: 0}]),
        );
    }));
    cases.push(snapshotCase("more than one hundred and twenty-eight profiles", false, (value) => {
        value.profiles = Object.fromEntries(
            Array.from({length: 129}, (_, index) => [`plugin-${index}`, {queued: 0}]),
        );
    }));
    cases.push(snapshotCase("more than one hundred alerts", false, (value) => {
        value.alerts = Array.from({length: 101}, (_, index) => ({
            ...value.alerts[0],
            id: `alert-${index}`,
        }));
    }));
    cases.push(...acceptedTelemetryCases(), ...rejectedTelemetryCases());
    return cases;
}

module.exports = {
    NOW,
    acceptedTelemetryCases,
    deviceEntry,
    generatedAtParityCases,
    pluginTelemetry,
    pluginTelemetryEntry,
    rejectedTelemetryCases,
    telemetryPluginKeys,
    runtimeSnapshotSchemaCases,
    snapshotCase,
    validRuntimeSnapshot,
};
