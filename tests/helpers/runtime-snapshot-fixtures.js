"use strict";

const NOW = 1_700_000_000_000;

function validRuntimeSnapshot() {
    return {
        version: 1,
        generatedAt: NOW - 500,
        device: {
            available: true,
            name: "Coral USB",
            kind: "usb",
            reason: "",
        },
        metrics: {
            load: 37.5,
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

function runtimeSnapshotSchemaCases() {
    const cases = [
        {name: "complete snapshot", expected: true, value: validRuntimeSnapshot()},
        snapshotCase("optional fields absent", true, (value) => {
            delete value.device.reason;
            value.profiles = {future: {}};
            delete value.alerts[0].confidence;
            delete value.alerts[0].riskScore;
            delete value.alerts[0].resolved;
        }),
        snapshotCase("nullable measurements", true, (value) => {
            value.metrics.load = null;
            value.alerts[0].confidence = null;
            value.alerts[0].riskScore = null;
        }),
        snapshotCase("zero minima", true, (value) => {
            value.metrics = {load: 0, queueDepth: 0, runningProfiles: 0};
            value.profiles.future = {queued: 0};
            value.alerts[0].timestamp = 0;
            value.alerts[0].confidence = 0;
            value.alerts[0].riskScore = 0;
        }),
        snapshotCase("smallest accepted generatedAt", true, (value) => {
            value.generatedAt = 1;
        }),
        snapshotCase("numeric maxima", true, (value) => {
            value.metrics = {load: 100, queueDepth: 1_000_000, runningProfiles: 8};
            value.profiles["hardware-health"].queued = 1_000_000;
            value.alerts[0].confidence = 1;
            value.alerts[0].riskScore = 1;
        }),
        snapshotCase("Unicode code-point limits", true, (value) => {
            value.device.name = "💡".repeat(120);
            value.device.reason = "💡".repeat(240);
            value.profiles["hardware-health"].detail = "💡".repeat(240);
            value.alerts[0].id = "💡".repeat(120);
            value.alerts[0].profileId = "💡".repeat(80);
            value.alerts[0].title = "💡".repeat(160);
            value.alerts[0].summary = "💡".repeat(500);
        }),
        snapshotCase("one hundred alerts", true, (value) => {
            value.alerts = Array.from({length: 100}, (_, index) => ({
                ...value.alerts[0],
                id: `alert-${index}`,
            }));
        }),
    ];

    for (const key of ["version", "generatedAt", "device", "metrics", "profiles", "alerts"]) {
        cases.push(snapshotCase(`missing root ${key}`, false, (value) => { delete value[key]; }));
    }
    for (const key of ["available", "name", "kind"]) {
        cases.push(snapshotCase(`missing device ${key}`, false, (value) => { delete value.device[key]; }));
    }
    for (const key of ["load", "queueDepth", "runningProfiles"]) {
        cases.push(snapshotCase(`missing metrics ${key}`, false, (value) => { delete value.metrics[key]; }));
    }
    for (const key of ["id", "profileId", "title", "summary", "severity", "timestamp"]) {
        cases.push(snapshotCase(`missing alert ${key}`, false, (value) => { delete value.alerts[0][key]; }));
    }
    for (const [name, target] of [
        ["root", (value) => value],
        ["device", (value) => value.device],
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
        ["device scalar", (value) => value, {device: "usb"}],
        ["available non-boolean", (value) => value.device, {available: 1}],
        ["device name non-string", (value) => value.device, {name: 7}],
        ["device kind unknown", (value) => value.device, {kind: "future"}],
        ["device reason non-string", (value) => value.device, {reason: null}],
        ["metrics scalar", (value) => value, {metrics: []}],
        ["load non-number", (value) => value.metrics, {load: "37"}],
        ["load below minimum", (value) => value.metrics, {load: -0.1}],
        ["load above maximum", (value) => value.metrics, {load: 100.1}],
        ["load non-finite", (value) => value.metrics, {load: Number.NaN}],
        ["fractional queue", (value) => value.metrics, {queueDepth: 1.5}],
        ["negative queue", (value) => value.metrics, {queueDepth: -1}],
        ["queue above maximum", (value) => value.metrics, {queueDepth: 1_000_001}],
        ["fractional running count", (value) => value.metrics, {runningProfiles: 1.5}],
        ["negative running count", (value) => value.metrics, {runningProfiles: -1}],
        ["running count above maximum", (value) => value.metrics, {runningProfiles: 9}],
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
    ];
    for (const [name, target, replacement] of replacements) {
        if (name === "root null" || name === "root array") {
            cases.push({name, expected: false, value: replacement});
            continue;
        }
        cases.push(snapshotCase(name, false, (value) => Object.assign(target(value), replacement)));
    }

    for (const [name, target, maximum] of [
        ["device name", (value) => value.device, 120],
        ["device reason", (value) => value.device, 240],
        ["profile detail", (value) => value.profiles["hardware-health"], 240],
        ["alert id", (value) => value.alerts[0], 120],
        ["alert profile", (value) => value.alerts[0], 80],
        ["alert title", (value) => value.alerts[0], 160],
        ["alert summary", (value) => value.alerts[0], 500],
    ]) {
        const property = {
            "device name": "name",
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
    cases.push(snapshotCase("more than one hundred alerts", false, (value) => {
        value.alerts = Array.from({length: 101}, (_, index) => ({
            ...value.alerts[0],
            id: `alert-${index}`,
        }));
    }));
    return cases;
}

module.exports = {
    NOW,
    generatedAtParityCases,
    runtimeSnapshotSchemaCases,
    snapshotCase,
    validRuntimeSnapshot,
};
