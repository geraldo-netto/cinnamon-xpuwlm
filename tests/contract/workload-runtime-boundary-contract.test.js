"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const Manager = require("../../files/cinnamon-xpuwlm@geraldo-netto/lib/manager.js");
const Runtime = require(
    "../../files/cinnamon-xpuwlm@geraldo-netto/lib/workload-runtime-controller.js",
);

const MANAGER_PATH = path.join(
    __dirname,
    "../../files/cinnamon-xpuwlm@geraldo-netto/lib/manager.js",
);

test("workload runtime ownership stays outside the manager facade", () => {
    const source = fs.readFileSync(MANAGER_PATH, "utf8");
    assert.match(source, /new WorkloadRuntimeController\(\{/u);
    for (const method of ["_relistPictures", "_sweepOnce", "_dispatchJob", "_pollJob"]) {
        assert.equal(source.includes(`${method}(`), false, `${method} leaked into manager.js`);
        assert.equal(typeof Runtime.WorkloadRuntimeController.prototype[method], "function");
    }
});

test("the manager preserves its workload runtime helper facade", () => {
    for (const name of [
        "JOB_ABANDONED_TEXT",
        "JOB_POLL_INTERVAL_MS",
        "JOB_REFUSAL_TEXTS",
        "JOB_SUBMITTER_METHODS",
        "MAX_JOB_POLLS",
        "NO_JOB",
        "RUNTIME_JOB_FAILURE",
        "inputContracts",
        "requireInputCatalog",
        "requireJobSubmitter",
        "validPictureListing",
    ]) {
        assert.strictEqual(Manager[name], Runtime[name], name);
    }
});
