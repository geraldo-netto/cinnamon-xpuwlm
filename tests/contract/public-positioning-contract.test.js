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
        "desktop coordination and presentation layer",
        "compatible runtime service",
        "https://github.com/geraldo-netto/omnitensor",
        "current reference runtime and test integration, not the definition of this applet",
        "different local runtime can integrate",
        "provider-neutral successor",
        "device-only monitoring",
        "XPU** is an umbrella",
        "not a fourth backend",
        "early preview (`0.1.0`)",
        "no CPU scheduling backend",
        "The host CPU still performs ordinary application work",
        "low-light enhancement and event extraction are not operational workloads",
    ]) {
        assert.ok(compact.includes(statement), `README omits: ${statement}`);
    }
    assert.doesNotMatch(readme, /private repository/iu);
    assert.doesNotMatch(readme, /production Cinnamon panel applet/iu);
});

test("runtime guide distinguishes snapshot observation from D-Bus actions", () => {
    const guide = fs.readFileSync(path.join(ROOT, "docs/applet.md"), "utf8");
    const compact = guide.replace(/\s+/gu, " ");

    assert.match(compact, /snapshot is the observation channel/iu);
    assert.match(compact, /user-session D-Bus/iu);
    assert.match(compact, /handshake, controls, job submission, cancellation, and results/iu);
    assert.match(compact, /no CPU scheduling backend/iu);
    assert.match(compact, /Host-side capture/iu);
    assert.doesNotMatch(guide, /only place the two sides meet/iu);
});
