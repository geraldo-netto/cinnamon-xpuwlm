"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const WorkflowMenu = require(
    "../../files/cinnamon-xpuwlm@geraldo-netto/lib/workflow-menu-view.js",
);

test("property: renderer installation is repeatable for arbitrary host prototypes", () => {
    for (let seed = 0; seed < 256; seed += 1) {
        const marker = {seed};
        const prototype = {marker};
        const installed = WorkflowMenu.installWorkflowRenderers(prototype);
        assert.equal(installed, prototype);
        assert.equal(prototype.marker, marker);
        for (const name of WorkflowMenu.WORKFLOW_RENDERER_NAMES) {
            assert.equal(
                prototype[name],
                WorkflowMenu.WorkflowMenuView.prototype[name],
                `seed ${seed}: ${name}`,
            );
        }
        assert.equal(WorkflowMenu.installWorkflowRenderers(prototype), prototype);
    }
});

test("property: job detail is the ordered join of non-empty string fields", () => {
    const values = [
        "", "ready", "שלום", "готово", "100%", null, undefined,
        false, true, 0, 17, ["array"], {toString: () => "object"},
    ];
    for (let seed = 0; seed < 4096; seed += 1) {
        const fields = Array.from({length: 4}, (_item, index) => (
            values[(seed >> (index * 3)) % values.length]
        ));
        const job = {
            message: fields[0],
            stateText: fields[1],
            progressText: fields[2],
            jobId: fields[3],
        };
        const expected = fields
            .filter((value) => typeof value === "string" && value.length > 0)
            .join(" · ");

        assert.equal(WorkflowMenu.jobDetail(job), expected, `seed ${seed}`);
    }
});
