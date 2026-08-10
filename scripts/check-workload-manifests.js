"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const Ajv2020 = require("ajv/dist/2020").default;

const repositoryRoot = path.resolve(__dirname, "..");
const appletRoot = path.join(repositoryRoot, "files/cinnamon-tpuwm@geraldo-netto");
const schema = JSON.parse(fs.readFileSync(path.join(appletRoot, "workload-manifest.schema.json"), "utf8"));
const validate = new Ajv2020({allErrors: true, strict: true}).compile(schema);

function manifestDirectories(root) {
    return fs.readdirSync(root, {withFileTypes: true})
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
        .sort();
}

function formatErrors(errors) {
    return (errors || [])
        .map((error) => `${error.instancePath || "/"} ${error.message}`)
        .join("; ");
}

// The authoritative verdict of workload-manifest.schema.json, as text: empty
// when the candidate conforms. Third-party tooling needs the same verdict
// without the built-in-only rules this checker adds on top.
function schemaErrors(candidate) {
    return validate(candidate) ? "" : formatErrors(validate.errors);
}

function checkManifestFile(filename, expectedId) {
    const manifest = JSON.parse(fs.readFileSync(filename, "utf8"));
    const errors = schemaErrors(manifest);
    assert.equal(errors, "", `${filename}: ${errors}`);
    assert.equal(manifest.id, expectedId, `${filename}: id must match directory name`);
    const preference = manifest.requirements.acceleratorPreference;
    assert.equal(
        Array.isArray(preference),
        true,
        `${filename}: built-in manifests must declare acceleratorPreference`,
    );
    assert.equal(
        preference[0],
        manifest.requirements.accelerator,
        `${filename}: the first preference must be the designed-for accelerator`,
    );
    return manifest;
}

function checkWorkloadDirectory(root) {
    const identifiers = manifestDirectories(root);
    const manifests = identifiers.map((identifier) => checkManifestFile(
        path.join(root, identifier, "manifest.json"),
        identifier,
    ));
    assert.equal(new Set(manifests.map((manifest) => manifest.id)).size, manifests.length);
    assert.equal(new Set(manifests.map((manifest) => manifest.ui.order)).size, manifests.length);
    return manifests;
}

if (require.main === module) {
    const root = path.resolve(process.argv[2] || path.join(appletRoot, "workloads"));
    const manifests = checkWorkloadDirectory(root);
    console.log(`workload manifests: ${manifests.length} valid`);
}

module.exports = {
    checkManifestFile,
    checkWorkloadDirectory,
    formatErrors,
    manifestDirectories,
    schemaErrors,
};
