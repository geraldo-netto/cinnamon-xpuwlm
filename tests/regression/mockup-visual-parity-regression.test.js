"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const ROOT = path.resolve(__dirname, "../../files/cinnamon-xpuwlm@geraldo-netto");
const stylesheet = fs.readFileSync(path.join(ROOT, "stylesheet.css"), "utf8");
const menuView = fs.readFileSync(path.join(ROOT, "lib/menu-view.js"), "utf8");
const viewModel = fs.readFileSync(path.join(ROOT, "lib/view-model.js"), "utf8");

function rule(selector) {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
    const match = stylesheet.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`, "u"));
    assert.ok(match, `${selector} must exist`);
    return match[1];
}

test("regression: wide popup retains the approved v4 card geometry and alignment", () => {
    assert.match(rule(".xpuwlm-root"), /padding:\s*16px/u);
    assert.match(rule(".xpuwlm-root"), /spacing:\s*12px/u);
    assert.match(rule(".xpuwlm-tool-row"), /min-height:\s*52px/u);
    assert.match(rule(".xpuwlm-tool-row"), /border-radius:\s*9px/u);
    assert.match(rule(".xpuwlm-tab-active"), /border-bottom-width:\s*3px/u);
    assert.match(rule(".xpuwlm-group-value"), /text-align:\s*right/u);
    assert.match(rule(".xpuwlm-tool-chevron"), /text-align:\s*right/u);
});

test("regression: System and Diagnostics keep mockup-specific visual structure", () => {
    assert.match(stylesheet, /\.xpuwlm-screen-profiles \.xpuwlm-content,[\s\S]*?\.xpuwlm-screen-setup \.xpuwlm-content\s*\{/u);
    assert.match(rule(".xpuwlm-diagnostics-current"), /spacing:\s*0/u);
    assert.match(rule(".xpuwlm-diagnostics-metric .xpuwlm-metric-value"), /text-align:\s*right/u);
    assert.match(rule(".xpuwlm-healthy-icon"), /border:\s*2px solid symbolic-success/u);
    assert.match(viewModel, /icon:\s*"xpuwlm-device-symbolic"/u);
    assert.match(viewModel, /icon:\s*"drive-multidisk-symbolic"/u);
    assert.match(menuView, /icon_name:\s*"package-x-generic-symbolic"/u);
    assert.match(menuView, /icon_name:\s*"xpuwlm-sliders-symbolic"/u);
});

test("regression: statuses carry semantic theme colors and still include text", () => {
    assert.match(rule(".xpuwlm-status-healthy"), /color:\s*symbolic-success/u);
    assert.match(rule(".xpuwlm-status-watching"), /color:\s*symbolic-warning/u);
    assert.match(rule(".xpuwlm-status-unavailable"), /color:\s*symbolic-error/u);
    assert.match(menuView, /this\._label\(tool\.status/u);
    assert.match(menuView, /this\._label\(status\.status/u);
});
