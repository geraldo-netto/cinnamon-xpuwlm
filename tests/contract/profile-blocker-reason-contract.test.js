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
    // Where the machine-readable codes are declared, beside the sentences.
    "src/omnitensor/executors/base.py",
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

// The code is now the contract and the sentence is only its fallback, so the
// codes need the stronger gate: the applet must classify exactly what the
// service can publish, and the two schemas must agree on the closed set.
test("the applet classifies exactly the codes the service can publish", (t) => {
    const root = serviceRoot();
    if (root === null) {
        t.skip("the OmniTensor checkout is not available");
        return;
    }
    const schema = JSON.parse(fs.readFileSync(
        path.join(root, "schemas/runtime-snapshot.schema.json"),
        "utf8",
    ));
    const service = schema.properties.profiles.additionalProperties.properties.reason;
    assert.notEqual(service, undefined, "the service no longer publishes a reason code");

    const mirrored = require(
        "../../files/cinnamon-tpuwm@geraldo-netto/runtime-snapshot.schema.json",
    ).properties.profiles.additionalProperties.properties.reason;
    assert.deepEqual(
        mirrored,
        service,
        "the mirrored schema drifted; the applet would reject every snapshot",
    );

    const classified = new Set([
        ...Object.keys(Blockers.REASON_CODE_KINDS),
        ...Blockers.NON_BLOCKING_REASON_CODES,
    ]);
    assert.deepEqual(
        [...service.enum].sort(),
        [...classified].sort(),
        "a code the service can publish has no remedy here, or vice versa",
    );
});

test("every code the applet classifies is a literal the service emits", (t) => {
    const root = serviceRoot();
    if (root === null) {
        t.skip("the OmniTensor checkout is not available");
        return;
    }
    // The schema alone would pass if the enum listed a code no branch sets.
    const source = serviceText(root);
    for (const code of [
        ...Object.keys(Blockers.REASON_CODE_KINDS),
        ...Blockers.NON_BLOCKING_REASON_CODES,
    ]) {
        assert.equal(
            source.includes(`"${code}"`),
            true,
            `no service branch emits "${code}"; the popup classifies a state that cannot occur`,
        );
    }
});
