"use strict";

const ACCEPTED_REPORT = Object.freeze({valid: true, code: "accepted"});

function validationAccepted() {
    return ACCEPTED_REPORT;
}

function validationRejected(code = "schema") {
    const trimmedCode = typeof code === "string" ? code.trim() : "";
    const normalizedCode = trimmedCode === "" ? "schema" : trimmedCode;
    return Object.freeze({valid: false, code: normalizedCode});
}

function requireSnapshotValidator(candidate) {
    if (!candidate || typeof candidate.validate !== "function") {
        throw new TypeError("A runtime snapshot validator is required");
    }
    return candidate;
}

function validateSnapshot(validator, candidate) {
    const report = requireSnapshotValidator(validator).validate(candidate);
    if (!report
        || typeof report.valid !== "boolean"
        || typeof report.code !== "string"
        || report.code.trim() === ""
        || (report.valid && report.code !== "accepted")) {
        throw new TypeError("Runtime snapshot validator returned an invalid report");
    }
    return report;
}

module.exports = {
    requireSnapshotValidator,
    validateSnapshot,
    validationAccepted,
    validationRejected,
};
