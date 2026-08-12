"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const SOURCE = fs.readFileSync(path.join(
    __dirname,
    "../../files/cinnamon-xpuwlm@geraldo-netto/lib/menu-view.js",
), "utf8");
const APPLET_SOURCE = fs.readFileSync(path.join(
    __dirname,
    "../../files/cinnamon-xpuwlm@geraldo-netto/applet.js",
), "utf8");
const INSTRUMENTED = SOURCE.includes("stryMutAct_") || APPLET_SOURCE.includes("stryMutAct_");

test("regression: every menu button crosses the deferred dispatch boundary", (context) => {
    if (INSTRUMENTED) {
        context.skip("exact source assertion is not applicable to Stryker-instrumented code");
        return;
    }
    const clickedConnections = SOURCE.match(/\.connect\("clicked"/gu) || [];
    assert.equal(clickedConnections.length, 1, "all buttons must use MenuView._button");
    assert.match(
        SOURCE,
        /button\.connect\("clicked", \(\) => this\._deferAction\(button, callback\)\)/u,
    );
    assert.doesNotMatch(SOURCE, /button\.connect\("clicked", \(\) => callback\(\)\)/u);
});

test("regression: production popup injects Cinnamon's main-loop scheduler", (context) => {
    if (INSTRUMENTED) {
        context.skip("exact source assertion is not applicable to Stryker-instrumented code");
        return;
    }
    assert.match(
        APPLET_SOURCE,
        /actionScheduler: this\._scheduler,/u,
    );
});
