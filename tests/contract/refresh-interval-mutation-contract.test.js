"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const ROOT = path.resolve(__dirname, "../..");
const packageJson = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
const mainConfig = JSON.parse(fs.readFileSync(path.join(ROOT, "stryker.config.json"), "utf8"));
const config = JSON.parse(fs.readFileSync(
    path.join(ROOT, "stryker.refresh-interval.config.json"),
    "utf8",
));
const TARGETS = Object.freeze([
    "files/cinnamon-xpuwlm@geraldo-netto/applet.js:90-93",
    "files/cinnamon-xpuwlm@geraldo-netto/applet.js:95-111",
    "files/cinnamon-xpuwlm@geraldo-netto/lib/cinnamon-state-adapter.js:20-24",
    "files/cinnamon-xpuwlm@geraldo-netto/lib/cinnamon-state-adapter.js:92-100",
    "files/cinnamon-xpuwlm@geraldo-netto/lib/cinnamon-state-adapter.js:102-104",
    "files/cinnamon-xpuwlm@geraldo-netto/lib/cinnamon-state-adapter.js:106-110",
    "files/cinnamon-xpuwlm@geraldo-netto/lib/cinnamon-state-adapter.js:112-128",
    "files/cinnamon-xpuwlm@geraldo-netto/lib/cinnamon-state-adapter.js:130-138",
    "files/cinnamon-xpuwlm@geraldo-netto/lib/cinnamon-state-adapter.js:140-142",
    "files/cinnamon-xpuwlm@geraldo-netto/lib/cinnamon-state-adapter.js:144-146",
    "files/cinnamon-xpuwlm@geraldo-netto/lib/cinnamon-state-adapter.js:148-156",
    "files/cinnamon-xpuwlm@geraldo-netto/applet.js:206-225",
]);
const SCRIPTS = Object.freeze([
    "test:mutation:refresh-applet-instance",
    "test:mutation:refresh-applet-settings",
    "test:mutation:refresh-defaults",
    "test:mutation:refresh-instance-name",
    "test:mutation:refresh-valid-uuid",
    "test:mutation:refresh-settings-api",
    "test:mutation:refresh-settings-paths",
    "test:mutation:refresh-selected-path",
    "test:mutation:refresh-current-path",
    "test:mutation:refresh-current-settings",
    "test:mutation:refresh-restore",
    "test:mutation:refresh-applet-owner",
]);
const SIGNATURES = Object.freeze([
    /^function settingsInstanceId\(metadata, instanceId\)/u,
    /^function createAppletSettings\(owner, metadata, instanceId, overrides, environment\)/u,
    /^const MIGRATABLE_SETTING_DEFAULTS = Object\.freeze\(/u,
    /^function settingsInstanceName\(instanceId\)/u,
    /^function validSettingsUuid\(uuid\)/u,
    /^function hasSettingsFileApi\(environment\)/u,
    /^function appletSettingsPaths\(uuid, instanceId, environment\)/u,
    /^function selectedAppletSettingsPath\(paths, environment\)/u,
    /^function currentAppletSettingsPath\(uuid, instanceId, environment\)/u,
    /^function readCurrentIdentitySettings\(uuid, instanceId, environment\)/u,
    /^function restoreCurrentRefreshInterval\(settings, snapshot\)/u,
    /^\s+_createSettings\(metadata, instanceId, overrides\)/u,
]);

function targetSource(target) {
    const match = target.match(/^(.*):(\d+)-(\d+)$/u);
    assert.ok(match, `invalid mutation target ${target}`);
    const lines = fs.readFileSync(path.join(ROOT, match[1]), "utf8").split("\n");
    return lines.slice(Number(match[2]) - 1, Number(match[3])).join("\n");
}

test("refresh mutation target is deterministic and non-incremental", () => {
    assert.equal(packageJson.scripts["test:mutation:refresh-default-target"], [
        "node --test",
        "tests/regression/refresh-interval-default-regression.test.js",
        "tests/regression/identity-rename-regression.test.js",
        "tests/integration/applet.test.js",
        "tests/fuzz/refresh-interval.fuzz.test.js",
    ].join(" "));
    assert.equal(config.testRunner, "command");
    assert.equal(config.commandRunner.command, "npm run test:mutation:refresh-default-target");
    assert.equal(config.coverageAnalysis, "off");
    assert.equal(config.incremental, false);
    assert.equal(config.concurrency, 1);
    assert.deepEqual(config.mutate, TARGETS);
    assert.deepEqual(config.mutator, mainConfig.mutator);
    assert.deepEqual(config.thresholds, {high: 80, low: 80, break: 80});
    assert.equal(config.cleanTempDir, "always");
});

test("refresh mutation command applies the threshold per callable", () => {
    for (const [index, script] of SCRIPTS.entries()) {
        assert.equal(
            packageJson.scripts[script],
            `stryker run stryker.refresh-interval.config.json --mutate='${TARGETS[index]}'`,
        );
    }
    assert.equal(
        packageJson.scripts["test:mutation:refresh-default"],
        SCRIPTS.map((script) => `npm run ${script}`).join(" && "),
    );
});

test("refresh mutation ranges still start at their intended owners", () => {
    for (const [index, target] of TARGETS.entries()) {
        assert.match(targetSource(target), SIGNATURES[index]);
    }
});
