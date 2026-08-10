"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const Blockers = require("../../files/cinnamon-tpuwm@geraldo-netto/lib/profile-blockers.js");

// The popup decides which remedy to offer by reading the sentence the runtime
// publishes about a profile. That makes the sentence a contract, and an
// undeclared contract is one that gets reworded on the other side: the popup
// would then quietly demote every profile to "unrecognised" and stop naming
// any remedy at all. This gate reads the service sources and fails when a
// phrase the classifier depends on is no longer emitted.
const repositoryRoot = path.resolve(__dirname, "../..");

const SERVICE_SOURCES = Object.freeze([
    "src/omnitensor/service.py",
    "src/omnitensor/scheduler.py",
    "src/omnitensor/executors/tpu.py",
    "src/omnitensor/executors/npu.py",
    "src/omnitensor/executors/gpu.py",
    "src/omnitensor/executors/vulkan.py",
]);

// The service repository is a sibling checkout, not a dependency: the gate
// runs wherever both are present and reports itself unavailable, never as
// passing, where only one is.
function serviceRoot() {
    const configured = process.env.TPUWM_OMNITENSOR_ROOT;
    const candidate = configured || path.resolve(repositoryRoot, "../omnitensor");
    return fs.existsSync(path.join(candidate, SERVICE_SOURCES[0])) ? candidate : null;
}

function serviceText(root) {
    return SERVICE_SOURCES
        .map((relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8"))
        .join("\n");
}

test("every classified reason is still a sentence the runtime emits", (t) => {
    const root = serviceRoot();
    if (root === null) {
        t.skip(
            "the OmniTensor checkout is not available; "
            + "set TPUWM_OMNITENSOR_ROOT to run the cross-repository half of this gate",
        );
        return;
    }
    const source = serviceText(root);
    const phrases = [
        ...Blockers.REASON_CLASSES.flatMap(([, values]) => values),
        ...Blockers.POLICY_REASONS,
    ];
    for (const phrase of phrases) {
        assert.equal(
            source.includes(phrase),
            true,
            `the runtime no longer emits "${phrase}"; the popup would stop naming its remedy`,
        );
    }
});

test("the policy sentences the popup ignores are still policy sentences", (t) => {
    const root = serviceRoot();
    if (root === null) {
        t.skip("the OmniTensor checkout is not available");
        return;
    }
    // Reported before the service looks at a backend, so they carry no verdict
    // about whether the profile could run. Treating either as a blocker would
    // tell a user who merely paused a profile to go and install something.
    const status = fs.readFileSync(path.join(root, "src/omnitensor/service.py"), "utf8");
    for (const phrase of Blockers.POLICY_REASONS) {
        assert.match(
            status,
            new RegExp(`"status": "paused"[^}]*"detail": "${phrase}"`, "u"),
            `"${phrase}" is no longer published as a paused status`,
        );
    }
});
