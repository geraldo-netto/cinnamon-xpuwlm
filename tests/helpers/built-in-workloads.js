"use strict";

const fs = require("node:fs");
const path = require("node:path");

const Domain = require("../../files/cinnamon-xpuwlm@geraldo-netto/lib/domain.js");
const Manifest = require("../../files/cinnamon-xpuwlm@geraldo-netto/lib/workload-manifest.js");
const Registry = require("../../files/cinnamon-xpuwlm@geraldo-netto/lib/workload-registry.js");

const ROOT = path.resolve(__dirname, "../../files/cinnamon-xpuwlm@geraldo-netto/workloads");

function descriptors() {
    return fs.readdirSync(ROOT, {withFileTypes: true})
        .filter((entry) => entry.isDirectory())
        .sort((left, right) => left.name.localeCompare(right.name))
        .map((entry) => new Manifest.WorkloadDescriptor(JSON.parse(fs.readFileSync(
            path.join(ROOT, entry.name, "manifest.json"),
            "utf8",
        ))));
}

function registry() {
    return new Registry.StaticWorkloadRegistry(descriptors());
}

function coreDescriptors() {
    return descriptors().filter((descriptor) => descriptor.id !== "low-light-enhancement");
}

function coreRegistry() {
    return new Registry.StaticWorkloadRegistry(coreDescriptors());
}

function coreCatalog() {
    return new Domain.WorkloadCatalog(Registry.profileDefinitions(coreRegistry()));
}

function catalog() {
    return new Domain.WorkloadCatalog(Registry.profileDefinitions(registry()));
}

// A runtime that can execute the whole bundled catalog. The service publishes
// "Serving on <backend>" for a profile whose model resolved on an available
// lane, and that sentence is what the popup reads to decide a profile runs, so
// this is the fixture for a host where nothing is missing.
function servingProfiles(detail = "Serving on gpu") {
    return Object.fromEntries(coreDescriptors().map((descriptor) => [
        descriptor.id,
        {status: "watching", queued: 0, detail},
    ]));
}

module.exports = {
    ROOT,
    catalog,
    coreCatalog,
    coreDescriptors,
    coreRegistry,
    descriptors,
    registry,
    servingProfiles,
};
