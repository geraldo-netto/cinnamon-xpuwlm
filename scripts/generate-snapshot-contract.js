"use strict";

// Derive the snapshot validator's vocabulary from the shipped schema.
//
// The validator restates the schema as hand-written allowlists so the applet
// can check a document without a schema engine, and the two drifted: a field
// added to the schema and not to the allowlist made the applet reject *every*
// snapshot the runtime published, reported to the user as "no runtime service
// is publishing state" — indistinguishable from a service that is down.
//
// A gate that compares the two catches that, and still leaves two statements.
// This removes the second one. The schema is written; this file is derived from
// it; `--check` fails when the derived file is stale, so the copy cannot drift
// without a gate going red first.
//
// Deriving rather than reading at runtime is deliberate. The validator runs
// inside Cinnamon's GJS, where a library module cannot locate its own directory
// and the applet would have to thread the parsed schema through twenty-six
// construction sites to reach it — churn that is itself a source of mistakes.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const UUID = "cinnamon-xpuwlm@geraldo-netto";
const repositoryRoot = path.resolve(__dirname, "..");
const appletRoot = path.join(repositoryRoot, "files", UUID);
const schemaPath = path.join(appletRoot, "runtime-snapshot.schema.json");
const outputPath = path.join(appletRoot, "lib", "runtime-snapshot-contract.js");

function compareText(left, right) {
    return left.localeCompare(right);
}

function readSchema(targetSchemaPath = schemaPath) {
    return JSON.parse(fs.readFileSync(targetSchemaPath, "utf8"));
}

// Every closed object in the snapshot, named the way the validator names it.
function objects(schema) {
    const properties = schema.properties;
    const telemetry = properties.pluginTelemetry;
    const kernel = properties.kernelTelemetry;
    return {
        root: schema,
        device: properties.devices.items,
        metric: properties.metrics,
        profile: properties.profiles.additionalProperties,
        alert: properties.alerts.items,
        inputs: properties.inputs,
        kernelTelemetry: kernel,
        kernelHistogram: kernel.properties.histograms.items,
        kernelCounter: kernel.properties.counters.items,
        telemetry,
        telemetryPlugin: telemetry.properties.plugins.items,
    };
}

// Enumerations a snapshot's values are drawn from. Named by what they
// constrain rather than by where they sit, because the validator reads them by
// meaning.
function enumerations(schema) {
    const properties = schema.properties;
    const profile = properties.profiles.additionalProperties.properties;
    const plugin = properties.pluginTelemetry.properties.plugins.items.properties;
    return {
        deviceBackend: properties.devices.items.properties.backend.enum,
        deviceKind: properties.devices.items.properties.kind.enum,
        profileStatus: profile.status.enum,
        profileReason: profile.reason.enum,
        alertSeverity: properties.alerts.items.properties.severity.enum,
        kernelTelemetryState: properties.kernelTelemetry.properties.state.enum,
        telemetryHealth: plugin.health.enum,
        telemetryStage: plugin.stage.enum,
        telemetryArtifactReadiness: plugin.artifactReadiness.enum,
    };
}

// The numbers the schema bounds collections and values by. Derived for the
// same reason the names are: a ceiling raised in the schema and not in the
// validator is a snapshot the runtime publishes and the applet refuses.
function bounds(schema) {
    const properties = schema.properties;
    const telemetry = properties.pluginTelemetry.properties.plugins;
    return {
        maxDevices: properties.devices.maxItems,
        maxAlerts: properties.alerts.maxItems,
        maxProfiles: properties.profiles.maxProperties,
        maxTelemetryPlugins: telemetry.maxItems,
        maxInputRoots: properties.inputs.properties.roots.maxItems,
        maxInputRootLength: properties.inputs.properties.roots.items.maxLength,
        maxInputBytes: properties.inputs.properties.maxBytes.maximum,
        maxKernelSeries: properties.kernelTelemetry.properties.histograms.maxItems,
        maxKernelBuckets: properties.kernelTelemetry.properties.histograms.items.properties.buckets.maxItems,
        maxKernelNameLength: properties.kernelTelemetry.properties.histograms.items.properties.name.maxLength,
        maxKernelDetailLength: properties.kernelTelemetry.properties.detail.maxLength,
        maxKernelCount: schema.$defs.kernelCount.maximum,
        kernelTelemetryVersion: properties.kernelTelemetry.properties.version.const,
        telemetryVersion: properties.pluginTelemetry.properties.version.const,
        snapshotVersion: properties.version.const,
        minimumGeneratedAt: properties.generatedAt.minimum,
    };
}

function requiredOf(object) {
    return object.required ? [...object.required] : [];
}

function propertiesOf(object) {
    assert.ok(object.properties, "every derived object must declare properties");
    return Object.keys(object.properties);
}

function derive(schema) {
    const shapes = objects(schema);
    const allowlists = {};
    const required = {};
    for (const [name, object] of Object.entries(shapes)) {
        allowlists[name] = propertiesOf(object).sort(compareText);
        required[name] = requiredOf(object).sort(compareText);
    }
    return {allowlists, required, enums: enumerations(schema), bounds: bounds(schema)};
}

function literal(value) {
    return JSON.stringify(value);
}

function frozenSets(entries) {
    return Object.entries(entries)
        .map(([name, values]) => `    ${name}: new Set(${literal(values)}),`)
        .join("\n");
}

function frozenLists(entries) {
    return Object.entries(entries)
        .map(([name, values]) => `    ${name}: Object.freeze(${literal(values)}),`)
        .join("\n");
}

function render(schema) {
    const {allowlists, required, enums, bounds: limits} = derive(schema);
    return `"use strict";

// GENERATED by scripts/generate-snapshot-contract.js from
// runtime-snapshot.schema.json. Do not edit by hand: the schema is the
// statement, this is derived from it, and \`npm run check:contract\` fails when
// the two disagree.
//
// It exists because the validator has to check a snapshot without a schema
// engine, and the hand-written copy it used to carry drifted — a field added to
// one and not the other made the applet reject every snapshot the runtime
// published, which reads exactly like a service that is not running.

const ALLOWLISTS = Object.freeze({
${frozenSets(allowlists)}
});

const REQUIRED = Object.freeze({
${frozenLists(required)}
});

const ENUMS = Object.freeze({
${frozenSets(enums)}
});

const BOUNDS = Object.freeze(${JSON.stringify(limits, null, 4).replace(/\n/gu, "\n")});

module.exports = {ALLOWLISTS, BOUNDS, ENUMS, REQUIRED};
`;
}

function mainOptions(options) {
    return {
        argv: process.argv.slice(2),
        logger: console,
        outputPath,
        repositoryRoot,
        schemaPath,
        ...options,
    };
}

function currentOutput(targetOutputPath) {
    const existing = fs.existsSync(targetOutputPath)
        ? fs.readFileSync(targetOutputPath, "utf8")
        : null;
    return existing;
}

function checkOutput(rendered, options) {
    assert.equal(
        currentOutput(options.outputPath),
        rendered,
        `${path.relative(options.repositoryRoot, options.outputPath)} is stale; `
            + "run npm run generate:contract",
    );
    options.logger.log("snapshot contract: derived file matches the schema");
    return true;
}

function writeOutput(rendered, options) {
    fs.writeFileSync(options.outputPath, rendered);
    options.logger.log(
        `snapshot contract: wrote ${path.relative(options.repositoryRoot, options.outputPath)}`,
    );
    return true;
}

function main(overrides = {}) {
    const options = mainOptions(overrides);
    const rendered = render(readSchema(options.schemaPath));
    return options.argv.includes("--check")
        ? checkOutput(rendered, options)
        : writeOutput(rendered, options);
}

if (require.main === module) {
    main();
}

module.exports = {derive, main, readSchema, render};
