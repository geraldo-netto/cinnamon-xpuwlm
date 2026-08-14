"use strict";

const Domain = require("./domain.js");
const Registry = require("./workload-registry.js");
const Validation = require("./validation.js");

function versionMap(descriptors) {
    return Object.freeze(Object.fromEntries(descriptors.map((descriptor) => [
        descriptor.id,
        descriptor.version,
    ])));
}

function persistedVersions(candidate) {
    return Domain.isPlainObject(candidate?.pluginVersions)
        ? candidate.pluginVersions
        : {};
}

function persistedProfiles(candidate) {
    return Domain.isPlainObject(candidate?.profiles) ? candidate.profiles : {};
}

function findInstallAndUpgrade(previousProfiles, previousVersions, currentVersions) {
    const installed = [];
    const upgraded = [];
    for (const [id, version] of Object.entries(currentVersions)) {
        if (!Object.hasOwn(previousProfiles, id)) {
            installed.push(id);
        } else if (typeof previousVersions[id] === "string" && previousVersions[id] !== version) {
            upgraded.push(id);
        }
    }
    return {installed, upgraded};
}

function changedIdentifiers(candidate, currentVersions, profiles) {
    const previousVersions = persistedVersions(candidate);
    const previousProfiles = persistedProfiles(candidate);
    const {installed, upgraded} = findInstallAndUpgrade(
        previousProfiles,
        previousVersions,
        currentVersions,
    );
    const known = new Set(Object.keys(profiles));
    const removed = [...new Set([
        ...Object.keys(previousProfiles),
        ...Object.keys(previousVersions),
    ])].filter((id) => !known.has(id)).sort(Validation.compareText);
    return Object.freeze({
        installed: Object.freeze(installed),
        upgraded: Object.freeze(upgraded),
        removed: Object.freeze(removed),
    });
}

function sameState(left, right) {
    return JSON.stringify(left) === JSON.stringify(right);
}

// A first run has no catalog to compare against, so every workload would be
// reported as newly installed. That is noise, not news: change reporting only
// becomes meaningful once a persisted catalog exists.
function hasPersistedCatalog(candidate) {
    return Object.keys(persistedProfiles(candidate)).length > 0
        || Object.keys(persistedVersions(candidate)).length > 0;
}

function reconcilePortfolioState(candidate, registry) {
    const descriptors = [...Registry.validateDescriptors(
        Registry.requireWorkloadRegistry(registry).descriptors(),
    )].sort((left, right) => Registry.compareProfileDefinitions(
        left.profileDefinition(),
        right.profileDefinition(),
    ));
    const catalog = new Domain.WorkloadCatalog(
        descriptors.map((descriptor) => descriptor.profileDefinition())
            .sort(Registry.compareProfileDefinitions),
    );
    const normalized = Domain.sanitizeProfileState(candidate, catalog);
    const pluginVersions = versionMap(descriptors);
    const state = {
        paused: normalized.paused,
        profiles: normalized.profiles,
        deviceChoices: normalized.deviceChoices,
        pluginVersions,
    };
    return Object.freeze({
        catalog,
        state,
        changes: changedIdentifiers(candidate, pluginVersions, normalized.profiles),
        changed: !sameState(candidate, state),
        firstRun: !hasPersistedCatalog(candidate),
    });
}

module.exports = {
    changedIdentifiers,
    findInstallAndUpgrade,
    hasPersistedCatalog,
    persistedProfiles,
    persistedVersions,
    reconcilePortfolioState,
    sameState,
    versionMap,
};
