"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const ROOT = path.resolve(__dirname, "../..");
const {BEHAVIOR_MODULES, mutationTargets} = require("../../scripts/mutation-plan.js");

test("scoped mutation config pairs every source with focused unit tests", () => {
    const targets = mutationTargets();
    assert.equal(targets.length, 47);
    assert.equal(targets.length, BEHAVIOR_MODULES.size);
    assert.equal(new Set(targets.map((target) => target.source)).size, targets.length);
    for (const target of targets) {
        assert.equal(fs.existsSync(path.join(ROOT, target.source)), true);
        assert.ok(target.tests.length > 0);
        assert.equal(target.tests.every((file) => file.startsWith("tests/unit/")), true);
        assert.equal(target.tests.every((file) => fs.existsSync(path.join(ROOT, file))), true);
        assert.equal(target.source.includes("/scripts/"), false);
        assert.doesNotMatch(target.source, /cinnamon-.*-adapter|gio-file-adapter/u);
    }

    const config = require("../../stryker.scoped.config.cjs");
    assert.deepEqual(config.mutate, [targets[0].source]);
    assert.equal(config.commandRunner.command.includes(targets[0].tests[0]), true);
    assert.deepEqual(config.thresholds, {high: 80, low: 80, break: 80});
});
