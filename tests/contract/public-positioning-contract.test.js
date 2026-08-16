"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const ROOT = path.resolve(__dirname, "../..");

test("public README defines the applet and XPU boundary without readiness overclaims", () => {
    const readme = fs.readFileSync(path.join(ROOT, "README.md"), "utf8");
    const compact = readme.replace(/^>\s?/gmu, "").replace(/\s+/gu, " ");

    for (const statement of [
        "third-party Cinnamon",
        "panel presence and a way into the client",
        "never talks to the runtime's control socket",
        "compatible runtime service",
        "https://github.com/geraldo-netto/omnitensor",
        "current reference runtime and test integration, not the definition of this applet",
        "starts the Python client",
        "different local runtime can integrate",
        "provider-neutral successor",
        "device-only monitoring",
        "XPU** is an umbrella",
        "not a fourth backend",
        "early preview (`0.1.0`)",
        "no CPU scheduling backend",
        "The host CPU still performs ordinary application work",
        "Most built-in profiles are readiness-gated",
        "Event extraction becomes available only when a compatible external provider is installed",
        "reported ready by the live runtime inventory",
    ]) {
        assert.ok(compact.includes(statement), `README omits: ${statement}`);
    }
    assert.doesNotMatch(readme, /private repository/iu);
    assert.doesNotMatch(readme, /production Cinnamon panel applet/iu);
});

test("the helper guide states what the panel reads and what it never does", () => {
    const guide = fs.readFileSync(path.join(ROOT, "docs/applet.md"), "utf8");
    const compact = guide.replace(/\s+/gu, " ");

    // The two halves of the boundary: what the panel is allowed to do, and
    // what a reader must not assume it does. A guide that only states the
    // first is how a panel grows a control surface again.
    assert.match(compact, /reads the published snapshot file and nothing else/iu);
    assert.match(compact, /never talks to the runtime's control socket/iu);
    assert.match(compact, /ships no schema copies/iu);
    assert.match(compact, /reports that the client \*started\*, not that it succeeded/iu);
    // Every read outcome is a state the panel draws, not an error it swallows.
    for (const state of ["connected", "absent", "stale", "malformed", "unreadable"]) {
        assert.match(compact, new RegExp(`\`${state}\``, "u"), state);
    }
});
