"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const Ajv2020 = require("ajv/dist/2020").default;
const Contract = require("../../files/cinnamon-xpuwlm@geraldo-netto/lib/workload-manifest.js");
const Fixtures = require("../helpers/workload-manifest-fixtures.js");

// The applet ships its own copy of every schema it shares with the runtime
// service, because a Cinnamon applet cannot fetch one at load time. Nothing
// compared the copies, and one had already drifted: the runtime published
// media-transcription with a `ggml-whisper` artifact the applet's copy did not
// list, so the applet refused the only manifest of five that used it.
const SHARED_SCHEMAS = [
    "runtime-acknowledgement",
    "runtime-command",
    "runtime-contract",
    "runtime-refusal",
    "runtime-snapshot",
    "workload-manifest",
];

// The two schemas are one contract in two dialects. The applet compiles every
// shipped schema under ajv `strict: true` — asserted by
// `scripts/validate-artifacts.js` — and ajv strict refuses two constructs the
// runtime's Python validator accepts. Each entry below is a construct the
// applet may legitimately spell differently, with the reason it must; anything
// else that differs is drift and fails this gate.
const DIALECT_EXCEPTIONS = [
    {
        pointer: "/oneOf",
        why: "ajv strictRequired refuses `not: {required: [plugin]}` unless the "
            + "subschema also declares the property, so the applet spells the "
            + "version 1 discriminator as `plugin: false`",
    },
    {
        pointer: "/properties/requirements/allOf",
        why: "the runtime constrains `acceleratorPreference[0]` with a one-entry "
            + "`prefixItems`; ajv strictTuples rejects an open-ended tuple and no "
            + "`minItems`/`maxItems`/`items` combination both satisfies it and "
            + "admits two and three-entry preferences, so the applet enforces the "
            + "rule in `declaresDesignedForFirst` instead",
    },
];

const repositoryRoot = path.resolve(__dirname, "../..");
const appletRoot = path.join(repositoryRoot, "files/cinnamon-xpuwlm@geraldo-netto");

// The service repository is a sibling checkout, not a dependency: this gate
// runs wherever both are present and is reported as unavailable, never as
// passing, where only one is.
function runtimeSchemaRoot() {
    const configured = process.env.XPUWLM_OMNITENSOR_ROOT;
    const roots = configured
        ? [configured]
        : [path.join(repositoryRoot, "../omnitensor"), path.join(repositoryRoot, "../../omnitensor")];
    for (const root of roots) {
        const candidate = path.join(root, "schemas");
        if (fs.existsSync(candidate)) {
            return candidate;
        }
    }
    return null;
}

function readSchema(root, name) {
    return JSON.parse(fs.readFileSync(path.join(root, `${name}.schema.json`), "utf8"));
}

function excepted(pointer) {
    return DIALECT_EXCEPTIONS.some((exception) => pointer === exception.pointer
        || pointer.startsWith(`${exception.pointer}/`));
}

// Report every difference rather than the first, so one run names the whole
// drift instead of one edit per re-run.
function differences(runtime, applet, pointer = "") {
    if (excepted(pointer)) {
        return [];
    }
    if (Array.isArray(runtime) !== Array.isArray(applet)) {
        return [`${pointer || "/"}: array on one side only`];
    }
    if (Array.isArray(runtime)) {
        return arrayDifferences(runtime, applet, pointer);
    }
    if (isRecord(runtime) && isRecord(applet)) {
        return recordDifferences(runtime, applet, pointer);
    }
    return runtime === applet ? [] : [`${pointer || "/"}: ${describe(runtime)} in the runtime, ${describe(applet)} here`];
}

function isRecord(value) {
    return typeof value === "object" && value !== null;
}

function describe(value) {
    const rendered = JSON.stringify(value) ?? String(value);
    return rendered.length > 80 ? `${rendered.slice(0, 77)}...` : rendered;
}

function arrayDifferences(runtime, applet, pointer) {
    if (runtime.length !== applet.length) {
        return [`${pointer}: ${runtime.length} entries in the runtime, ${applet.length} here`];
    }
    return runtime.flatMap((entry, index) => differences(entry, applet[index], `${pointer}/${index}`));
}

function recordDifferences(runtime, applet, pointer) {
    const keys = [...new Set([...Object.keys(runtime), ...Object.keys(applet)])].sort();
    return keys.flatMap((key) => {
        const child = `${pointer}/${key}`;
        if (excepted(child)) {
            return [];
        }
        if (!(key in runtime)) {
            return [`${child}: present here, absent from the runtime`];
        }
        if (!(key in applet)) {
            return [`${child}: published by the runtime, missing here`];
        }
        return differences(runtime[key], applet[key], child);
    });
}

const schemaRoot = runtimeSchemaRoot();

test("every schema shared with the runtime service is vendored without drift", (t) => {
    if (schemaRoot === null) {
        t.skip("set XPUWLM_OMNITENSOR_ROOT to run the cross-repository schema parity gate");
        return;
    }
    const drift = SHARED_SCHEMAS.flatMap((name) => differences(
        readSchema(schemaRoot, name),
        readSchema(appletRoot, name),
    ).map((detail) => `${name}.schema.json${detail}`));
    assert.deepEqual(drift, [], `vendored schemas have drifted:\n${drift.join("\n")}`);
});

// The second exception is only defensible while the applet enforces the rule
// its schema cannot carry, so prove both halves against the runtime's own
// schema: it rejects a preference that does not begin with the declared
// accelerator, and so does the applet.
test("the positional preference rule the shipped schema cannot carry is still enforced", (t) => {
    if (schemaRoot === null) {
        t.skip("set XPUWLM_OMNITENSOR_ROOT to run the cross-repository schema parity gate");
        return;
    }
    // `strict: false` because this is the runtime's dialect, and compiling it
    // under the applet's settings is exactly what the exception records.
    const runtime = new Ajv2020({strict: false}).compile(readSchema(schemaRoot, "workload-manifest"));
    const manifest = Fixtures.validWorkloadManifest();
    assert.equal(manifest.requirements.accelerator, "tpu");

    manifest.requirements.acceleratorPreference = ["gpu", "tpu"];
    assert.equal(runtime(manifest), false, "the runtime schema must reject a gpu-first tpu profile");
    assert.equal(Contract.isWorkloadManifest(manifest), false, "so must the applet");

    manifest.requirements.acceleratorPreference = ["tpu", "gpu"];
    assert.equal(runtime(manifest), true, "the runtime schema must accept a tpu-first tpu profile");
    assert.equal(Contract.isWorkloadManifest(manifest), true, "so must the applet");
});

// An exception that stops being needed is an exception that starts hiding
// drift, so each one has to still describe a real difference.
test("each recorded dialect exception still covers a real difference", (t) => {
    if (schemaRoot === null) {
        t.skip("set XPUWLM_OMNITENSOR_ROOT to run the cross-repository schema parity gate");
        return;
    }
    const runtime = readSchema(schemaRoot, "workload-manifest");
    const applet = readSchema(appletRoot, "workload-manifest");
    for (const {pointer, why} of DIALECT_EXCEPTIONS) {
        const [, ...segments] = pointer.split("/");
        const resolve = (document) => segments.reduce((node, key) => node?.[key], document);
        assert.notDeepEqual(
            resolve(runtime),
            resolve(applet),
            `${pointer} no longer differs; drop the exception (${why})`,
        );
    }
});
