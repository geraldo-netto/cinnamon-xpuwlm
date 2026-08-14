"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const ROOT = path.resolve(__dirname, "../..");
const {mutationPolicy} = require("../../package.json");
const {
    TEST_FAMILIES,
    TOOL_SOURCES,
    mutationSources,
    mutationTargets,
} = require("../../scripts/mutation-plan.js");

test("mutation plan preserves the complete original 101-source scope", () => {
    const targets = mutationTargets();
    const expected = [
        "files/cinnamon-xpuwlm@geraldo-netto/applet.js",
        ...fs.globSync(path.join(
            ROOT,
            "files/cinnamon-xpuwlm@geraldo-netto/lib/*.js",
        )).sort().map((file) => path.relative(ROOT, file)),
        ...TOOL_SOURCES.map((basename) => `scripts/${basename}`),
    ];
    assert.equal(targets.length, 101);
    assert.equal(targets.length, mutationPolicy.sourceCount);
    assert.deepEqual(mutationSources(), expected);
    assert.deepEqual(targets.map((target) => target.source), expected);
    assert.equal(new Set(targets.map((target) => target.source)).size, targets.length);
    for (const target of targets) {
        assert.equal(fs.existsSync(path.join(ROOT, target.source)), true);
        assert.ok(target.tests.length > 0);
        assert.equal(target.tests.every((file) => (
            TEST_FAMILIES.some((family) => file.startsWith(`tests/${family}/`))
        )), true);
        assert.equal(target.tests.every((file) => fs.existsSync(path.join(ROOT, file))), true);
    }

    const config = require("../../stryker.config.cjs");
    assert.deepEqual(config.mutate, [targets[0].source]);
    assert.equal(config.commandRunner.command.includes(targets[0].tests[0]), true);
    assert.equal(config.incremental, false);
    assert.equal(Object.hasOwn(config, "incrementalFile"), false);
    assert.deepEqual(config.thresholds, {
        high: mutationPolicy.threshold,
        low: mutationPolicy.threshold,
        break: mutationPolicy.threshold,
    });
    assert.deepEqual(config.mutator.excludedMutations, mutationPolicy.excludedMutations);
});
