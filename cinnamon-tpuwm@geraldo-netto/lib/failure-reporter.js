"use strict";

function requireFailureReporter(candidate, name = "failure") {
    if (!candidate
        || typeof candidate.report !== "function"
        || typeof candidate.recover !== "function") {
        throw new TypeError(`A ${name} reporter with report/recover is required`);
    }
    return candidate;
}

module.exports = {requireFailureReporter};
