"use strict";

const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const LIBRARY_ROOT = path.join(
    ROOT,
    "files/cinnamon-xpuwlm@geraldo-netto/lib",
);
const UNIT_ROOT = path.join(ROOT, "tests/unit");
const BEHAVIOR_MODULES = new Set([
    "alert-notifier",
    "artifact-qualification",
    "background-execution",
    "caption-export",
    "document-question",
    "domain",
    "event-import",
    "failure-log-backoff",
    "failure-reporter",
    "file-auto-tagging",
    "file-categorization",
    "file-organizer",
    "generic-workflow-controller",
    "generic-workflow-surface",
    "ics-export",
    "job-submission",
    "layout",
    "manager",
    "media-preprocessing",
    "media-transcription",
    "plugin-inventory",
    "presentation-planning",
    "presentation-review",
    "profile-blockers",
    "readiness-acceptance",
    "rehearsal-briefing",
    "routine-recognition",
    "runtime-contract",
    "runtime-control-contract",
    "runtime-control-service",
    "runtime-job-contract",
    "runtime-refusal-contract",
    "runtime-snapshot-schema-validator",
    "screenshot-assistant",
    "selected-text",
    "snapshot-validator",
    "telemetry-recorder",
    "telemetry-window",
    "tensor-encoder",
    "validation",
    "view-model",
    "workflow-controller",
    "workload-manifest",
    "workload-reconciliation",
    "workload-registry",
    "workload-result",
]);

function relativePath(file) {
    return path.relative(ROOT, file).split(path.sep).join("/");
}

function matchingUnitTests(moduleName) {
    return fs.globSync(path.join(UNIT_ROOT, `${moduleName}*.test.js`))
        .map(relativePath)
        .sort();
}

function mutationTargets() {
    return fs.globSync(path.join(LIBRARY_ROOT, "*.js"))
        .sort()
        .filter((source) => BEHAVIOR_MODULES.has(path.basename(source, ".js")))
        .map((source) => ({
            source: relativePath(source),
            tests: matchingUnitTests(path.basename(source, ".js")),
        }))
        .filter((target) => target.tests.length > 0);
}

module.exports = {BEHAVIOR_MODULES, mutationTargets};
