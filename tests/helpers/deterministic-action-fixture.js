"use strict";

const DIGEST_A = "a".repeat(64);
const DIGEST_B = "b".repeat(64);

function request(overrides = {}) {
    return {
        requestId: "action-request-1",
        actionId: "publish-file",
        sourceResultSha256: DIGEST_A,
        targets: ["/private/output/report.txt"],
        parameters: {mode: "create-new", title: "שלום Привет"},
        ...overrides,
    };
}

function effect(target = "/private/output/report.txt", overrides = {}) {
    return {
        id: "effect-1",
        kind: "create-file",
        target,
        summary: "Create a new report",
        beforeSha256: null,
        afterSha256: DIGEST_B,
        ...overrides,
    };
}

function harness(options = {}) {
    const events = [];
    let auditSequence = 0;
    let time = options.time ?? 1000;
    const actionPort = {
        async preview(value) {
            events.push(["preview", value]);
            return Object.hasOwn(options, "preview")
                ? options.preview
                : {revision: "revision-1", effects: [effect()]};
        },
        async conflicts(preview, value) {
            events.push(["conflicts", preview, value]);
            return Object.hasOwn(options, "conflicts") ? options.conflicts : [];
        },
        async apply(preview, value) {
            events.push(["apply", preview, value]);
            if (options.applyError) {
                throw options.applyError;
            }
            return Object.hasOwn(options, "receipt") ? options.receipt : {
                revision: "revision-2",
                changedTargets: ["/private/output/report.txt"],
                detail: "Report created",
            };
        },
        async rollback(preview, value, code) {
            events.push(["rollback", preview, value, code]);
            if (options.rollbackError) {
                throw options.rollbackError;
            }
            return Object.hasOwn(options, "rollback") ? options.rollback : {
                restoredTargets: ["/private/output/report.txt"],
                detail: "Report removed",
            };
        },
    };
    const definition = {
        id: "publish-file",
        maxTargets: 4,
        maxEffects: 8,
        allowedEffects: ["create-file", "replace-file"],
        rollbackSupported: options.rollbackSupported ?? true,
        validate: options.validate ?? ((parameters) => parameters.mode === "create-new"),
        port: actionPort,
    };
    const confirmation = {
        issued: [],
        consumed: [],
        async issue(metadata) {
            this.issued.push(metadata);
            events.push(["issue", metadata]);
            return options.token ?? "confirmation-token-0001";
        },
        async consume(token, metadata) {
            this.consumed.push({token, metadata});
            events.push(["consume", token, metadata]);
            return options.confirmationAccepted ?? true;
        },
    };
    const audit = {
        records: [],
        async record(value) {
            this.records.push(value);
            events.push(["audit", value]);
            auditSequence += 1;
            if (options.auditErrorAt === auditSequence) {
                throw new Error("audit unavailable");
            }
            return {sequence: auditSequence, recordedAt: time, digest: DIGEST_A};
        },
    };
    const clock = {now: () => time};
    return {
        actionPort,
        audit,
        clock,
        confirmation,
        definition,
        events,
        setTime(value) { time = value; },
    };
}

module.exports = {DIGEST_A, DIGEST_B, effect, harness, request};
