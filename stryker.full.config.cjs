"use strict";

const base = require("./stryker.config.json");

const config = {
    ...base,
    concurrency: 2,
    incremental: false,
    jsonReporter: {fileName: "mutation-report/full-rebaseline.json"},
    reporters: [...base.reporters, "json"],
};
delete config.incrementalFile;

module.exports = config;
