"use strict";

const fs = require("node:fs");
const path = require("node:path");

const Domain = require("../../files/cinnamon-tpuwm@geraldo-netto/lib/domain.js");
const Manifest = require("../../files/cinnamon-tpuwm@geraldo-netto/lib/workload-manifest.js");
const Registry = require("../../files/cinnamon-tpuwm@geraldo-netto/lib/workload-registry.js");

const ROOT = path.resolve(__dirname, "../../files/cinnamon-tpuwm@geraldo-netto/workloads");

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

module.exports = {
    ROOT,
    catalog,
    coreCatalog,
    coreDescriptors,
    coreRegistry,
    descriptors,
    registry,
};
