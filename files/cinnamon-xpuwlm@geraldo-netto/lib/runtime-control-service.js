"use strict";

const Contract = require("./runtime-control-contract.js");
const Domain = require("./domain.js");

function requirePolicyRepository(candidate) {
    if (!candidate || typeof candidate.load !== "function" || typeof candidate.save !== "function") {
        throw new TypeError("A runtime policy repository with load/save is required");
    }
    return candidate;
}

function requireClock(candidate) {
    if (!candidate || typeof candidate.now !== "function") {
        throw new TypeError("A clock with now is required");
    }
    return candidate;
}

function requireGpuDeviceIds(candidate) {
    if (typeof candidate !== "function") {
        throw new TypeError("A GPU device identity provider is required");
    }
    return candidate;
}

function availableGpuDeviceIds(provider) {
    const supplied = provider();
    if (!Array.isArray(supplied) || !supplied.every(Domain.validGpuDeviceId)) {
        throw new TypeError("GPU device identities must be a valid array");
    }
    return new Set(supplied);
}

function normalizeRevision(value) {
    return Number.isInteger(value) && value >= 0 ? value : 0;
}

function rejection(command, revision, portfolio, appliedAt, message) {
    return {
        version: Contract.CONTROL_VERSION,
        commandId: command.id,
        status: "rejected",
        revision,
        appliedAt,
        message: Domain.safeText(message, 240, "Runtime rejected the command"),
        portfolio,
    };
}

function applyDeviceChoice(portfolio, profileId, deviceId, gpuDeviceIds) {
    if (deviceId !== null && !gpuDeviceIds.has(deviceId)) {
        throw new RangeError(`GPU device is unavailable: ${deviceId}`);
    }
    return portfolio.setDeviceChoice(profileId, deviceId);
}

function applyCommand(portfolio, command, gpuDeviceIds = new Set()) {
    switch (command.operation) {
    case "set-profile-enabled":
        return portfolio.setEnabled(command.profileId, command.value);
    case "set-profile-weight": {
        const current = portfolio.profile(command.profileId).weight;
        return portfolio.adjustWeight(command.profileId, command.value - current);
    }
    case "set-profile-device":
        return applyDeviceChoice(portfolio, command.profileId, command.value, gpuDeviceIds);
    case "set-paused":
        return command.value ? portfolio.pauseAll() : portfolio.resumeAll();
    case "apply-profiles":
        return applyChanges(portfolio, command.changes, gpuDeviceIds);
    default:
        return false;
    }
}

// Checked whole before anything is changed, so a batch naming one unknown
// profile does not apply the ones before it and then stop. Unknown is raised
// rather than returned: a `false` here means "changed nothing", which is a
// legitimate outcome for the single-setting operations and would let a batch
// naming a profile that does not exist spend a revision and alter nothing.
function applyChanges(portfolio, changes, gpuDeviceIds = new Set()) {
    const unknown = changes.find((change) => !portfolio.has(change.profileId));
    if (unknown !== undefined) {
        throw new RangeError(`Unknown workload profile: ${unknown.profileId}`);
    }
    const unavailable = changes.find(
        (change) => Object.hasOwn(change, "deviceId")
            && change.deviceId !== null
            && !gpuDeviceIds.has(change.deviceId),
    );
    if (unavailable !== undefined) {
        throw new RangeError(`GPU device is unavailable: ${unavailable.deviceId}`);
    }
    for (const change of changes) {
        if (Object.hasOwn(change, "enabled")) {
            portfolio.setEnabled(change.profileId, change.enabled);
        }
        if (Object.hasOwn(change, "weight")) {
            const current = portfolio.profile(change.profileId).weight;
            portfolio.adjustWeight(change.profileId, change.weight - current);
        }
        if (Object.hasOwn(change, "deviceId")) {
            portfolio.setDeviceChoice(change.profileId, change.deviceId);
        }
    }
    return true;
}

class RuntimeControlService {
    constructor({repository, catalog, clock = Date, gpuDeviceIds = () => []}) {
        this._repository = requirePolicyRepository(repository);
        this._catalog = Domain.requireWorkloadCatalog(catalog);
        this._clock = requireClock(clock);
        this._gpuDeviceIds = requireGpuDeviceIds(gpuDeviceIds);
        const loaded = this._repository.load();
        this._revision = normalizeRevision(loaded?.revision);
        this._portfolio = new Domain.WorkloadPortfolio(loaded?.portfolio, this._catalog);
    }

    handle(command) {
        if (!Contract.isRuntimeCommand(command)) {
            throw new TypeError("Runtime command does not match version 2 contract");
        }
        const nowMs = this._clock.now();
        if (command.expectedRevision !== this._revision) {
            return rejection(
                command,
                this._revision,
                this._portfolio.serialize(),
                nowMs,
                "Runtime policy revision changed; refresh and retry",
            );
        }
        const next = new Domain.WorkloadPortfolio(this._portfolio.serialize(), this._catalog);
        try {
            const usesGpuDevice = command.operation === "set-profile-device"
                || (command.operation === "apply-profiles"
                    && command.changes.some((change) => Object.hasOwn(change, "deviceId")));
            const gpuDeviceIds = usesGpuDevice
                ? availableGpuDeviceIds(this._gpuDeviceIds)
                : new Set();
            applyCommand(next, command, gpuDeviceIds);
            const nextRevision = this._revision + 1;
            this._repository.save({revision: nextRevision, portfolio: next.serialize()});
            this._portfolio = next;
            this._revision = nextRevision;
            return {
                version: Contract.CONTROL_VERSION,
                commandId: command.id,
                status: "applied",
                revision: this._revision,
                appliedAt: nowMs,
                message: "",
                portfolio: this._portfolio.serialize(),
            };
        } catch (error) {
            return rejection(
                command,
                this._revision,
                this._portfolio.serialize(),
                nowMs,
                `Runtime could not apply command: ${error}`,
            );
        }
    }

    state() {
        return {
            revision: this._revision,
            portfolio: this._portfolio.serialize(),
        };
    }
}

module.exports = {
    RuntimeControlService,
    applyDeviceChoice,
    availableGpuDeviceIds,
    applyCommand,
    normalizeRevision,
    rejection,
    requireClock,
    requireGpuDeviceIds,
    requirePolicyRepository,
};
