"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const WorkflowMenu = require(
    "../../files/cinnamon-xpuwlm@geraldo-netto/lib/workflow-menu-view.js",
);

test("job detail never renders non-string transport fields", () => {
    const hostile = {
        message: {toString: () => "[object leaked]"},
        stateText: "Finished",
        progressText: ["100%"],
        jobId: "job-17",
    };

    assert.equal(WorkflowMenu.jobDetail(hostile), "Finished · job-17");
});
