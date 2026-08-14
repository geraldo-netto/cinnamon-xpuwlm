"use strict";

const path = require("node:path");

const {mutationTargets} = require("./scripts/mutation-plan.js");

const targets = mutationTargets();
const requestedSource = process.env.XPUWLM_MUTATION_SOURCE;
const selected = requestedSource
    ? targets.find((target) => target.source === requestedSource)
    : targets[0];

if (!selected) {
    throw new Error(`unknown scoped mutation source: ${requestedSource || "<none>"}`);
}

const reportPath = process.env.XPUWLM_MUTATION_REPORT
    || path.join("mutation-report", "scoped", `${path.basename(selected.source, ".js")}.json`);

module.exports = {
    testRunner: "command",
    commandRunner: {
        command: [
            "XPUWLM_MUTATION_RUN=1",
            "node --test --test-concurrency=1",
            ...selected.tests,
        ].join(" "),
    },
    coverageAnalysis: "off",
    incremental: false,
    mutate: [selected.source],
    mutator: {excludedMutations: ["StringLiteral"]},
    reporters: ["clear-text", "progress", "json"],
    jsonReporter: {fileName: reportPath},
    thresholds: {high: 80, low: 80, break: 80},
    concurrency: 2,
    timeoutMS: 10000,
    timeoutFactor: 2.5,
    cleanTempDir: "always",
    tempDirName: ".stryker-tmp",
};
