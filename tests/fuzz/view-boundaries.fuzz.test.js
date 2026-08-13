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
