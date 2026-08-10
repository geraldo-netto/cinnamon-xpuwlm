"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const Domain = require("../../files/cinnamon-tpuwm@geraldo-netto/lib/domain.js");
const FailureBackoff = require("../../files/cinnamon-tpuwm@geraldo-netto/lib/failure-log-backoff.js");
const Manager = require("../../files/cinnamon-tpuwm@geraldo-netto/lib/manager.js");
const RuntimeContract = require("../../files/cinnamon-tpuwm@geraldo-netto/lib/runtime-contract.js");
const RuntimeControl = require("../../files/cinnamon-tpuwm@geraldo-netto/lib/runtime-control-contract.js");
const RuntimeControlService = require("../../files/cinnamon-tpuwm@geraldo-netto/lib/runtime-control-service.js");
const RuntimeRefusal = require("../../files/cinnamon-tpuwm@geraldo-netto/lib/runtime-refusal-contract.js");
const Manifest = require("../../files/cinnamon-tpuwm@geraldo-netto/lib/workload-manifest.js");
const Registry = require("../../files/cinnamon-tpuwm@geraldo-netto/lib/workload-registry.js");
const ManifestFixtures = require("../helpers/workload-manifest-fixtures.js");
const BuiltIns = require("../helpers/built-in-workloads.js");

const NOW = 1_700_000_000_000;
const CORE_DESCRIPTORS = BuiltIns.coreDescriptors();
const CORE_VERSIONS = Object.fromEntries(BuiltIns.coreCatalog().definitions().map((definition) => [
    definition.id,
    CORE_DESCRIPTORS.find((descriptor) => descriptor.id === definition.id).version,
]));

function snapshot() {
    return Domain.probeSnapshot(
        [{id: "tpu-usb", backend: "tpu", available: true, name: "Coral", kind: "usb"}],
        NOW,
    );
}

function fakeScheduler() {
    return {
        scheduled: [],
        cancelled: [],
        nextHandle: 1,
        schedule(delayMs, callback) {
            const handle = this.nextHandle;
            this.nextHandle += 1;
            this.scheduled.push({handle, delayMs, callback});
            return handle;
        },
        cancel(handle) {
            this.cancelled.push(handle);
            return true;
        },
        fire() {
            const entry = this.scheduled.at(-1);
            entry.callback();
            return entry;
        },
    };
}

function harness(overrides = {}) {
    const saves = [];
    const warnings = [];
    const errors = [];
    const repository = overrides.repository || {
        load: () => ({
            selectedTab: "alerts",
            portfolio: {
                paused: false,
                profiles: Domain.defaultProfileState(BuiltIns.coreCatalog()).profiles,
                pluginVersions: CORE_VERSIONS,
            },
        }),
        save: (value) => saves.push(value),
    };
    const runtimeGateway = overrides.runtimeGateway
        || {read: (options, callback) => callback(snapshot())};
    const logger = {
        warn: (message) => warnings.push(message),
        error: (message) => errors.push(message),
    };
    const clock = overrides.clock || {now: () => NOW};
    const scheduler = overrides.scheduler || fakeScheduler();
    const runtimePolicy = {revision: 0, portfolio: null};
    const controlService = new RuntimeControlService.RuntimeControlService({
        repository: {
            load: () => structuredClone(runtimePolicy),
            save: (value) => Object.assign(runtimePolicy, structuredClone(value)),
        },
        catalog: BuiltIns.coreCatalog(),
        clock,
    });
    const controlGateway = overrides.controlGateway || {
        send: (command, callback) => callback(null, controlService.handle(command)),
        cancel: () => false,
    };
    const manager = new Manager.WorkloadManager({
        repository,
        runtimeGateway,
        controlGateway,
        contractGateway: overrides.contractGateway || null,
        controlWatch: overrides.controlWatch || null,
        clock,
        errorReporter: new FailureBackoff.FailureErrorBackoff({logger}),
        logger,
        scheduler,
        staleAfterMs: overrides.staleAfterMs,
        workloadRegistry: overrides.workloadRegistry || BuiltIns.coreRegistry(),
    });
    return {
        clock,
        contractGateway: overrides.contractGateway || null,
        controlGateway,
        manager,
        saves,
        warnings,
        errors,
        scheduler,
    };
}

function connectedSnapshot(generatedAt) {
    return Domain.normalizeSnapshot({
        version: Domain.SNAPSHOT_VERSION,
        generatedAt,
        devices: [{id: "tpu-usb", backend: "tpu", available: true, name: "Coral USB", kind: "usb"}],
        metrics: {load: 40, queueDepth: 0, runningProfiles: 0},
        profiles: {},
        alerts: [],
    }, generatedAt);
}

test("tab sanitization and silent logger are safe defaults", () => {
    assert.equal(Manager.sanitizeTab("profiles"), "profiles");
    assert.equal(Manager.sanitizeTab("future"), "overview");
    assert.doesNotThrow(() => Manager.createSilentLogger().warn("ignored"));
    assert.doesNotThrow(() => Manager.createSilentLogger().error("ignored"));
});

test("manager validates collaborators", () => {
    const base = {
        repository: {load() {}, save() {}},
        runtimeGateway: {read() {}},
        errorReporter: {report() {}, recover() {}},
        workloadRegistry: BuiltIns.coreRegistry(),
    };
    assert.throws(() => new Manager.WorkloadManager({...base, repository: null}), /repository/);
    assert.throws(() => new Manager.WorkloadManager({...base, runtimeGateway: null}), /gateway/);
    assert.throws(() => new Manager.WorkloadManager({...base, clock: {}}), /clock/);
    assert.throws(() => new Manager.WorkloadManager({...base, errorReporter: {}}), /reporter/);
    assert.throws(() => new Manager.WorkloadManager({...base, workloadRegistry: {}}), /registry/);
});

test("manager builds portfolio from injected workload registry", () => {
    const descriptor = new Manifest.WorkloadDescriptor(ManifestFixtures.validWorkloadManifest({
        id: "custom-workload",
    }));
    const workloadRegistry = new Registry.StaticWorkloadRegistry([descriptor]);
    const {manager} = harness({workloadRegistry});
    manager.start();
    assert.deepEqual(manager.state().profiles.map((profile) => profile.id), ["custom-workload"]);
});

// Reconciliation used to compute plug-in changes and drop them. They now
// reach the projection so the popup can state them, and stay there until the
// user acknowledges the notice.
test("catalog changes are projected once and cleared on acknowledgement", () => {
    const previous = new Manifest.WorkloadDescriptor(ManifestFixtures.validWorkloadManifest({
        id: "retired-workload",
    }));
    const current = new Manifest.WorkloadDescriptor(ManifestFixtures.validWorkloadManifest({
        id: "custom-workload",
    }));
    const {manager} = harness({
        repository: {
            load: () => ({
                selectedTab: "overview",
                portfolio: {
                    paused: false,
                    profiles: {"retired-workload": {enabled: false, weight: 1}},
                    pluginVersions: {"retired-workload": "1.0.0"},
                },
            }),
            save() {},
        },
        workloadRegistry: new Registry.StaticWorkloadRegistry([current]),
    });
    assert.deepEqual(previous.id, "retired-workload");
    manager.start();
    assert.deepEqual(manager.state().catalogChanges, {
        installed: ["custom-workload"],
        upgraded: [],
        removed: ["retired-workload"],
    });

    const states = [];
    manager.subscribe((state) => states.push(state));
    assert.equal(manager.acknowledgeCatalogChanges(), true);
    assert.deepEqual(manager.state().catalogChanges, {installed: [], upgraded: [], removed: []});
    assert.deepEqual(states.at(-1).catalogChanges, {installed: [], upgraded: [], removed: []});
    assert.equal(manager.acknowledgeCatalogChanges(), false);
    assert.equal(Manager.hasCatalogChanges(Manager.NO_CATALOG_CHANGES), false);
    assert.equal(Manager.hasCatalogChanges({installed: [], upgraded: ["a"], removed: []}), true);
});

// A first run installs the whole catalog and a failed load has no baseline;
// neither is a plug-in change the user needs to be told about.
test("a first run and a failed state load report no catalog changes", () => {
    const empty = {installed: [], upgraded: [], removed: []};
    const {manager: first} = harness({repository: {load: () => ({}), save() {}}});
    first.start();
    assert.deepEqual(first.state().catalogChanges, empty);
    assert.equal(first.acknowledgeCatalogChanges(), false);

    const {manager: failed} = harness({
        repository: {load: () => { throw new Error("unreadable"); }, save() {}},
    });
    failed.start();
    assert.deepEqual(failed.state().catalogChanges, empty);
});

test("start loads state once, refreshes, and publishes immutable projections", () => {
    const {manager} = harness();
    const states = [];
    const unsubscribe = manager.subscribe((state) => states.push(state));
    assert.equal(manager.start(), true);
    assert.equal(manager.start(), false);
    assert.equal(states.length, 1);
    assert.equal(states[0].selectedTab, "alerts");
    assert.equal(states[0].device.available, true);
    let immediate = 0;
    manager.subscribe(() => { immediate += 1; });
    assert.equal(immediate, 1);
    assert.throws(() => manager.subscribe(null), /listener/);
    states[0].device.name = "mutated";
    assert.equal(manager.state().device.name, "Coral");
    assert.equal(unsubscribe(), true);
    assert.equal(unsubscribe(), false);
});

test("load and runtime failures fall back safely and are logged", () => {
    const {manager, warnings, errors} = harness({
        repository: {load() { throw new Error("bad state"); }, save() {}},
        runtimeGateway: {read() { throw new Error("runtime down"); }},
    });
    manager.start();
    assert.equal(manager.state().selectedTab, "overview");
    assert.equal(manager.state().device.available, false);
    assert.equal(manager.state().source, "error");
    assert.match(warnings[0], /Could not load/);
    assert.match(errors[0], /Could not read/);
});

test("state changes persist only when effective values change", () => {
    const {manager, saves} = harness();
    manager.start();
    assert.equal(manager.selectTab("alerts"), false);
    assert.equal(manager.selectTab("profiles"), true);
    assert.equal(manager.toggleProfile("hardware-health"), true);
    assert.equal(manager.changeWeight("hardware-health", 1), true);
    assert.equal(manager.pauseAll(), true);
    assert.equal(manager.pauseAll(), false);
    assert.equal(manager.resumeAll(), true);
    assert.equal(manager.resumeAll(), false);
    assert.equal(manager.changeWeight("hardware-health", 0), false);
    assert.equal(manager.changeWeight("hardware-health", 0.5), false);
    assert.equal(saves.length, 5);
    assert.equal(saves.at(-1).portfolio.paused, false);
    assert.deepEqual(saves.at(-1).portfolio.pluginVersions, CORE_VERSIONS);
});

test("runtime controls wait for acknowledgement and roll back failures", () => {
    const requests = [];
    const controlGateway = {
        send(command, callback) { requests.push({command, callback}); },
        cancel() { this.cancelled = true; return true; },
    };
    const {manager, saves, errors} = harness({controlGateway});
    const states = [];
    manager.subscribe((state) => states.push(state));
    manager.start();

    assert.equal(manager.toggleProfile("hardware-health"), true);
    assert.equal(manager.pauseAll(), false, "a second control is blocked while pending");
    assert.equal(manager.state().profiles.find((profile) => profile.id === "hardware-health").enabled, true);
    assert.equal(manager.state().control.pending, true);
    requests[0].callback(new Error("service offline"), null);
    assert.equal(manager.state().profiles.find((profile) => profile.id === "hardware-health").enabled, true);
    assert.match(manager.state().control.message, /could not apply the change/u);
    assert.equal(saves.length, 0);

    assert.equal(manager.toggleProfile("hardware-health"), true);
    // The revision matches what was sent, so this is a refusal to apply, not
    // revision drift, and it is reported instead of resynchronised.
    requests[1].callback(null, {
        version: 1,
        commandId: requests[1].command.id,
        status: "rejected",
        revision: requests[1].command.expectedRevision,
        appliedAt: NOW,
        message: "",
        portfolio: new Domain.WorkloadPortfolio(null, BuiltIns.coreCatalog()).serialize(),
    });
    assert.equal(manager.state().control.pending, false);
    assert.match(manager.state().control.message, /rejected/u);
    assert.equal(errors.some((message) => message.includes("service offline")), true);
    assert.equal(states.some((state) => state.control.pending), true);
});

test("weight control clamps boundaries without sending ineffective commands", () => {
    const requests = [];
    const {manager} = harness({
        controlGateway: {
            send(command) { requests.push(command); },
            cancel: () => false,
        },
    });
    manager.start();
    const desktop = manager.state().profiles.find((profile) => profile.id === "desktop-context");
    assert.equal(desktop.weight, Domain.MIN_WEIGHT);
    assert.equal(manager.changeWeight(desktop.id, -1), false);
    assert.deepEqual(requests, []);
});

test("runtime control is unavailable safely and teardown cancels pending work", () => {
    const withoutControl = new Manager.WorkloadManager({
        repository: {load: () => ({}), save() {}},
        runtimeGateway: {read: (options, callback) => callback(snapshot())},
        errorReporter: {report() {}, recover() {}},
        workloadRegistry: BuiltIns.coreRegistry(),
    });
    withoutControl.start();
    assert.equal(withoutControl.pauseAll(), false);
    assert.match(withoutControl.state().control.message, /unavailable/u);

    const {manager, controlGateway} = harness({
        controlGateway: {
            send(command, callback) { this.command = command; this.callback = callback; },
            cancel() { this.cancelled = true; return true; },
        },
    });
    manager.start();
    manager.pauseAll();
    const pending = manager.state();
    manager.dispose();
    assert.equal(controlGateway.cancelled, true);
    assert.equal(pending.control.pending, true);
    assert.doesNotThrow(() => controlGateway.callback(new Error("late"), null));
});

test("explicit device retry requests a fresh probe and publishes its result", () => {
    const readOptions = [];
    const {manager} = harness({
        runtimeGateway: {
            read(options, callback) {
                readOptions.push(options);
                callback(snapshot());
            },
        },
    });
    let publications = 0;
    manager.subscribe(() => { publications += 1; });
    manager.start();
    assert.equal(manager.retryDeviceDetection(), true);
    assert.equal(manager.state().device.available, true);
    assert.deepEqual(readOptions, [
        {forceDeviceDetection: false},
        {forceDeviceDetection: true},
    ]);
    assert.equal(publications, 2);
});

test("save and listener failures do not stop other observers", () => {
    const {manager, errors} = harness({
        repository: {load: () => ({}), save() { throw new Error("readonly"); }},
    });
    let delivered = 0;
    manager.subscribe(() => { throw new Error("observer"); });
    manager.subscribe(() => { delivered += 1; });
    manager.start();
    manager.selectTab("profiles");
    assert.equal(delivered, 2);
    assert.equal(errors.some((message) => message.includes("listener")), true);
    assert.equal(errors.some((message) => message.includes("save")), true);
});

test("listeners receive isolated state projections", () => {
    const {manager} = harness();
    let observedName = null;
    manager.subscribe((state) => {
        state.device.name = "mutated by first listener";
        state.profiles[0].title = "mutated";
    });
    manager.subscribe((state) => {
        observedName = `${state.device.name}:${state.profiles[0].title}`;
    });
    manager.start();
    assert.equal(observedName, "Coral:Hardware health");
});

test("runtime gateway replacement validates input and refreshes after start", () => {
    const {manager} = harness();
    assert.throws(() => manager.replaceRuntimeGateway({}), /gateway/);
    const beforeStart = {read: (options, callback) => callback(Domain.unavailableSnapshot("before", NOW))};
    assert.equal(manager.replaceRuntimeGateway(beforeStart), undefined);
    assert.equal(manager.state().device.reason, "Monitoring has not started");
    manager.start();
    assert.equal(manager.state().device.reason, "before");
    manager.replaceRuntimeGateway({read: (options, callback) => callback(snapshot())});
    assert.equal(manager.state().device.available, true);
});

test("manager validates an injected scheduler port", () => {
    const base = {
        repository: {load() {}, save() {}},
        runtimeGateway: {read() {}},
        errorReporter: {report() {}, recover() {}},
    };
    assert.throws(() => new Manager.WorkloadManager({...base, scheduler: {}}), /scheduler/);
    assert.throws(() => Manager.requireScheduler({schedule() {}}), /scheduler/);
    const inert = Manager.createInertScheduler();
    assert.equal(inert.schedule(1, () => {}), null);
    assert.equal(inert.cancel(null), false);
});

test("connected state expires at its freshness deadline instead of at the next poll", () => {
    let nowMs = NOW;
    const {manager, scheduler} = harness({
        clock: {now: () => nowMs},
        runtimeGateway: {read: (options, callback) => callback(connectedSnapshot(NOW))},
    });
    const states = [];
    manager.subscribe((state) => states.push(state));
    manager.start();

    assert.equal(states.at(-1).source, "runtime");
    assert.equal(states.at(-1).stale, false);
    assert.equal(states.at(-1).device.available, true);
    assert.equal(scheduler.scheduled.at(-1).delayMs, Domain.DEFAULT_STALE_AFTER_MS + 1);

    nowMs = NOW + Domain.DEFAULT_STALE_AFTER_MS + 1;
    scheduler.fire();

    assert.equal(states.at(-1).stale, true);
    assert.equal(states.at(-1).device.available, false);
    assert.match(states.at(-1).device.reason, /stale/u);
    assert.equal(manager.state().stale, true);
});

test("expiry is re-armed on every refresh and never fires twice for one snapshot", () => {
    let nowMs = NOW;
    let generatedAt = NOW;
    const {manager, scheduler} = harness({
        clock: {now: () => nowMs},
        runtimeGateway: {read: (options, callback) => callback(connectedSnapshot(generatedAt))},
    });
    let publications = 0;
    manager.subscribe(() => { publications += 1; });
    manager.start();
    const armedOnStart = scheduler.scheduled.length;

    nowMs = NOW + 5000;
    generatedAt = nowMs;
    manager.refresh();
    assert.equal(scheduler.cancelled.length, 1);
    assert.equal(scheduler.scheduled.length, armedOnStart + 1);
    assert.equal(scheduler.scheduled.at(-1).delayMs, Domain.DEFAULT_STALE_AFTER_MS + 1);

    const before = publications;
    scheduler.fire();
    assert.equal(publications, before, "an unexpired snapshot must not republish");

    nowMs = generatedAt + Domain.DEFAULT_STALE_AFTER_MS + 1;
    scheduler.fire();
    assert.equal(publications, before + 1);
    scheduler.fire();
    assert.equal(publications, before + 1);
});

test("snapshots that cannot expire leave the scheduler idle", () => {
    const {manager, scheduler} = harness();
    manager.start();
    assert.deepEqual(scheduler.scheduled, []);
    assert.equal(manager.state().source, "probe");
});

test("dispose cancels a pending expiry and ignores late callbacks", () => {
    let nowMs = NOW;
    const {manager, scheduler} = harness({
        clock: {now: () => nowMs},
        runtimeGateway: {read: (options, callback) => callback(connectedSnapshot(NOW))},
    });
    manager.start();
    const armed = scheduler.scheduled.at(-1);
    assert.equal(manager.dispose(), true);
    assert.deepEqual(scheduler.cancelled, [armed.handle]);

    nowMs = NOW + Domain.DEFAULT_STALE_AFTER_MS + 1;
    assert.doesNotThrow(() => armed.callback());
});

test("dispose is idempotent and blocks subsequent work", () => {
    const {manager} = harness();
    manager.start();
    assert.equal(manager.dispose(), true);
    assert.equal(manager.dispose(), false);
    assert.throws(() => manager.refresh(), /disposed/);
    assert.throws(() => manager.retryDeviceDetection(), /disposed/);
    assert.throws(() => manager.subscribe(() => {}), /disposed/);
});

function revisionHarness() {
    const requests = [];
    const {manager, saves} = harness({
        controlGateway: {
            send(command, callback) { requests.push({command, callback}); },
            cancel: () => false,
        },
    });
    const reject = (index, revision) => requests[index].callback(null, {
        version: 1,
        commandId: requests[index].command.id,
        status: "rejected",
        revision,
        appliedAt: NOW,
        message: "Runtime policy revision changed; refresh and retry",
        portfolio: new Domain.WorkloadPortfolio(null, BuiltIns.coreCatalog()).serialize(),
    });
    const apply = (index, revision) => requests[index].callback(null, {
        version: 1,
        commandId: requests[index].command.id,
        status: "applied",
        revision,
        appliedAt: NOW,
        message: "",
        portfolio: new Domain.WorkloadPortfolio(null, BuiltIns.coreCatalog()).serialize(),
    });
    return {apply, manager, reject, requests, saves};
}

test("the cold revision guess is corrected and the command resent, not surfaced", () => {
    const {apply, manager, reject, requests, saves} = revisionHarness();
    manager.start();
    assert.equal(manager.toggleProfile("hardware-health"), true);
    assert.equal(requests[0].command.expectedRevision, 0);

    reject(0, 7);
    assert.equal(requests.length, 2, "the rejected command is resent once");
    assert.equal(requests[1].command.expectedRevision, 7, "with the revision the runtime reported");
    assert.deepEqual(
        [requests[1].command.operation, requests[1].command.profileId, requests[1].command.value],
        [requests[0].command.operation, requests[0].command.profileId, requests[0].command.value],
        "the user's intent is resent verbatim",
    );
    assert.notEqual(requests[1].command.id, requests[0].command.id);
    assert.equal(manager.state().control.pending, true, "the resend is still one pending change");
    assert.equal(manager.state().control.message, "Applying change in runtime…");

    apply(1, 8);
    assert.equal(manager.state().control.pending, false);
    assert.equal(manager.state().control.message, "");
    assert.equal(saves.length, 1);
});

test("a transport that throws on send completes the change instead of hanging it", () => {
    const {manager, errors} = harness({
        controlGateway: {
            send() { throw new Error("the session bus is gone"); },
            cancel: () => false,
        },
    });
    manager.start();
    assert.equal(manager.toggleProfile("hardware-health"), true);
    assert.equal(manager.state().control.pending, false, "no change is left pending");
    assert.equal(manager.state().control.message, "The runtime service could not apply the change");
    assert.equal(errors.some((message) => message.includes("the session bus is gone")), true);
    assert.equal(manager.toggleProfile("hardware-health"), true, "the next change is not blocked");
});

test("revision drift after the runtime is known is reported, never silently resent", () => {
    const {apply, manager, reject, requests} = revisionHarness();
    manager.start();
    manager.toggleProfile("hardware-health");
    apply(0, 3);
    assert.equal(manager.toggleProfile("hardware-health"), true);
    assert.equal(requests[1].command.expectedRevision, 3, "the learned revision is reused");

    reject(1, 9);
    assert.equal(requests.length, 2, "a conflict with another writer is not overwritten");
    assert.equal(manager.state().control.pending, false);
    assert.match(manager.state().control.message, /revision changed/u);
});

test("a cold resend that is rejected again reports instead of retrying forever", () => {
    const {manager, reject, requests} = revisionHarness();
    manager.start();
    manager.toggleProfile("hardware-health");
    reject(0, 7);
    reject(1, 11);
    assert.equal(requests.length, 2);
    assert.equal(manager.state().control.pending, false);
    assert.match(manager.state().control.message, /revision changed/u);
});

test("snapshot content addressed to unknown workloads is counted and logged once", () => {
    const document = {
        version: Domain.SNAPSHOT_VERSION,
        generatedAt: NOW,
        devices: [{id: "tpu-usb", backend: "tpu", available: true, name: "Coral USB", kind: "usb"}],
        metrics: {queueDepth: 0, runningProfiles: 0},
        profiles: {
            "hardware-health": {status: "running", queued: 1, detail: ""},
            "not-installed": {status: "running", queued: 4, detail: "invisible"},
            "also-missing": {status: "idle", queued: 0, detail: ""},
        },
        alerts: [
            {id: "a1", profileId: "hardware-health", title: "Known", summary: "", severity: "warning", timestamp: NOW},
            {id: "a2", profileId: "not-installed", title: "Hidden", summary: "", severity: "critical", timestamp: NOW},
        ],
    };
    const catalog = BuiltIns.coreCatalog();
    const {manager, warnings} = harness({
        runtimeGateway: {
            read: (_options, callback) => callback(Domain.normalizeSnapshot(
                document,
                NOW,
                Domain.DEFAULT_STALE_AFTER_MS,
                catalog,
            )),
        },
    });
    manager.start();

    const state = manager.state();
    assert.deepEqual(state.unknownContent, {profiles: 2, alerts: 1});
    assert.equal(state.alerts.length, 1, "an alert for a missing workload is still not rendered");
    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /2 profile\(s\) and 1 alert\(s\)/u);

    manager.refresh();
    assert.equal(warnings.length, 1, "an unchanged disagreement is not logged every poll");
});

test("a snapshot addressed only to known workloads reports and logs nothing", () => {
    const {manager, warnings} = harness();
    manager.start();
    assert.deepEqual(manager.state().unknownContent, {profiles: 0, alerts: 0});
    assert.deepEqual(warnings, []);
});

test("control transport failures surface plain guidance, never raw D-Bus errors", () => {
    assert.equal(
        Manager.controlFailureText(new Error("GDBus.Error:org.freedesktop.DBus.Error.ServiceUnknown: The name org.cinnamon.OmniTensor1 was not provided by any .service files")),
        "The runtime service is not running; the change was not applied",
    );
    assert.equal(
        Manager.controlFailureText(new Error("GDBus.Error:org.freedesktop.DBus.Error.NameHasNoOwner: x")),
        "The runtime service is not running; the change was not applied",
    );
    assert.equal(
        Manager.controlFailureText(new Error("GDBus.Error:org.freedesktop.DBus.Error.TimedOut: y")),
        "The runtime service did not respond; the change was not applied",
    );
    assert.equal(
        Manager.controlFailureText(new Error("Command timed out: Timeout was reached")),
        "The runtime service did not respond; the change was not applied",
    );
    assert.equal(
        Manager.controlFailureText(new Error("mystery")),
        "The runtime service could not apply the change",
    );
    assert.doesNotMatch(Manager.controlFailureText(new Error("GDBus.Error:org.freedesktop.DBus.Error.ServiceUnknown")), /GDBus/u);
});

test("an older service and an unreadable reply are told apart from an absent one", () => {
    const distinct = new Map([
        ["GDBus.Error:org.freedesktop.DBus.Error.UnknownMethod: No such method", "does not support this request"],
        ["GDBus.Error:org.freedesktop.DBus.Error.UnknownInterface: x", "does not support this request"],
        ["GDBus.Error:org.freedesktop.DBus.Error.UnknownObject: x", "does not support this request"],
        ["GDBus.Error:org.freedesktop.DBus.Error.AccessDenied: x", "refused access"],
        ["GDBus.Error:org.freedesktop.DBus.Error.NoReply: x", "did not respond"],
    ]);
    for (const [raw, expected] of distinct) {
        const text = Manager.controlFailureText(new Error(raw));
        assert.match(text, new RegExp(expected, "u"), raw);
        assert.doesNotMatch(text, /GDBus/u, raw);
    }

    for (const violation of [
        RuntimeControl.contractViolation(TypeError, "Runtime acknowledgement is not text"),
        RuntimeControl.contractViolation(SyntaxError, "Runtime acknowledgement contains invalid JSON"),
        RuntimeControl.contractViolation(TypeError, "Runtime acknowledgement does not match version 1 contract"),
        RuntimeControl.contractViolation(RangeError, "Runtime acknowledgement command ID does not match request"),
    ]) {
        assert.equal(
            Manager.controlFailureText(violation),
            Manager.UNINTELLIGIBLE_REPLY_TEXT,
            String(violation),
        );
    }
    assert.equal(RuntimeControl.isContractViolation(new Error("plain")), false);
    assert.equal(RuntimeControl.isContractViolation(null), false);
    assert.equal(RuntimeControl.isContractViolation("text"), false);
});

function watchHarness(overrides = {}) {
    let listener = null;
    let unwatched = 0;
    const controlWatch = {
        watch(candidate) {
            listener = candidate;
            return () => { unwatched += 1; };
        },
    };
    const requests = [];
    const built = harness({
        ...overrides,
        controlGateway: overrides.controlGateway || {
            send(command, callback) { requests.push({command, callback}); },
            cancel: () => false,
        },
        controlWatch,
    });
    return {
        ...built,
        announce: (available) => listener(available),
        requests,
        unwatchedCount: () => unwatched,
    };
}

test("the manager validates and releases an injected control service watch", () => {
    assert.throws(() => harness({controlWatch: {}}), /control service watch/u);
    assert.equal(Manager.optionalPort(null, () => { throw new Error("unreachable"); }), null);

    const {manager, unwatchedCount} = watchHarness();
    assert.equal(manager.state().control.available, null, "nothing is claimed before the bus speaks");
    manager.start();
    assert.equal(manager.dispose(), true);
    assert.equal(unwatchedCount(), 1);
});

test("a watch that reports no handle is still safe to dispose", () => {
    const {manager} = harness({controlWatch: {watch: () => null}});
    manager.start();
    assert.equal(manager.dispose(), true);
});

test("the applet notices the control service stopping and starting", () => {
    const {announce, manager, requests} = watchHarness();
    manager.start();

    announce(true);
    assert.equal(manager.state().control.available, true);
    assert.equal(announce(true), false, "a repeated announcement changes nothing");

    announce(false);
    const stopped = manager.state();
    assert.equal(stopped.control.available, false);
    assert.equal(stopped.control.message, Manager.SERVICE_STOPPED_TEXT);
    assert.equal(
        manager.toggleProfile("hardware-health"),
        false,
        "a known-absent service is not called at all",
    );
    assert.deepEqual(requests, [], "no round trip is spent waiting for a timeout");

    announce(true);
    const restarted = manager.state();
    assert.equal(restarted.control.available, true);
    assert.equal(restarted.control.message, "", "the stale failure is cleared");
    assert.equal(manager.toggleProfile("hardware-health"), true);
    assert.equal(requests.length, 1);
});

test("a restarted service has its policy revision relearned, not replayed", () => {
    const {announce, manager, requests} = watchHarness();
    manager.start();
    announce(true);
    manager.toggleProfile("hardware-health");
    requests[0].callback(null, {
        version: 1,
        commandId: requests[0].command.id,
        status: "applied",
        revision: 12,
        appliedAt: NOW,
        message: "",
        portfolio: new Domain.WorkloadPortfolio(null, BuiltIns.coreCatalog()).serialize(),
    });
    manager.toggleProfile("hardware-health");
    assert.equal(requests[1].command.expectedRevision, 12);

    requests[1].callback(null, {
        version: 1,
        commandId: requests[1].command.id,
        status: "applied",
        revision: 13,
        appliedAt: NOW,
        message: "",
        portfolio: new Domain.WorkloadPortfolio(null, BuiltIns.coreCatalog()).serialize(),
    });
    announce(false);
    announce(true);
    manager.toggleProfile("hardware-health");
    assert.equal(
        requests[2].command.expectedRevision,
        0,
        "a fresh service instance starts its revisions over",
    );
});

test("an announcement after disposal is ignored", () => {
    const {announce, manager} = watchHarness();
    manager.start();
    manager.dispose();
    assert.equal(announce(true), false);
});

test("every guard refusal code reaches the user as its own sentence", () => {
    const rendered = new Set();
    for (const code of RuntimeRefusal.REFUSAL_CODES) {
        const error = new RuntimeRefusal.RuntimeRefusedError({
            version: 1,
            status: "rejected",
            code,
            message: `ApplyCommand refused: ${code}`,
            method: "ApplyCommand",
        });
        const text = Manager.controlFailureText(error);
        assert.equal(text, Manager.REFUSAL_TEXTS[code], code);
        assert.equal(text.length > 0, true, code);
        assert.notEqual(text, "The runtime service could not apply the change", code);
        rendered.add(text);
    }
    assert.equal(rendered.size, RuntimeRefusal.REFUSAL_CODES.size);
});

test("a refused command surfaces its code and leaves the local policy untouched", () => {
    const refusal = {
        version: 1,
        status: "rejected",
        code: "rate-limit-exceeded",
        message: "ApplyCommand allows 30 calls per 10s",
        method: "ApplyCommand",
    };
    const {manager} = harness({
        controlGateway: {
            send: (_command, callback) => callback(
                new RuntimeRefusal.RuntimeRefusedError(refusal),
                null,
            ),
            cancel: () => false,
        },
    });
    manager.start();
    const before = manager.state().profiles.map((profile) => profile.enabled);
    assert.equal(manager.toggleProfile("hardware-health"), true);
    const after = manager.state();
    assert.equal(after.control.pending, false);
    assert.equal(after.control.message, Manager.REFUSAL_TEXTS["rate-limit-exceeded"]);
    assert.deepEqual(after.profiles.map((profile) => profile.enabled), before);
});

function contractDocument(overrides = {}) {
    return {
        version: 1,
        methods: ["ApplyCommand", "DescribeContract"],
        schemas: {
            "runtime-command": 1,
            "runtime-acknowledgement": 1,
            "runtime-refusal": 1,
            "runtime-snapshot": 1,
        },
        ...overrides,
    };
}

function recordingContractGateway() {
    const calls = [];
    return {
        calls,
        cancelled: 0,
        describe(callback) {
            calls.push(callback);
            return true;
        },
        cancel() {
            this.cancelled += 1;
            return true;
        },
    };
}

test("the manager rejects a contract gateway that cannot describe or cancel", () => {
    const base = {
        repository: {load() {}, save() {}},
        runtimeGateway: {read() {}},
        errorReporter: {report() {}, recover() {}},
        workloadRegistry: BuiltIns.coreRegistry(),
    };
    assert.throws(
        () => new Manager.WorkloadManager({...base, contractGateway: {describe() {}}}),
        /contract gateway/u,
    );
});

test("the handshake is issued on start and its answer reaches the view", () => {
    const contractGateway = recordingContractGateway();
    const {manager} = harness({contractGateway});

    manager.start();
    assert.equal(contractGateway.calls.length, 1);
    // Nothing has answered yet, and the applet must not claim it knows.
    assert.equal(manager.state().contract.known, false);

    contractGateway.calls[0](null, new RuntimeContract.RuntimeContract(contractDocument()));

    const {contract} = manager.state();
    assert.equal(contract.known, true);
    assert.equal(contract.compatible, true);
    assert.deepEqual(contract.methods, ["ApplyCommand", "DescribeContract"]);
});

test("a version disagreement is reported before anything is attempted", () => {
    // The whole point: after the fact, a mismatch is indistinguishable from a
    // service that is simply down.
    const contractGateway = recordingContractGateway();
    const {manager, errors} = harness({contractGateway});
    manager.start();

    contractGateway.calls[0](null, new RuntimeContract.RuntimeContract(contractDocument({
        schemas: {...contractDocument().schemas, "runtime-command": 2},
    })));

    assert.equal(manager.state().contract.compatible, false);
    assert.equal(errors.some((entry) => /different versions/u.test(entry.message || entry)), true);
});

test("a failed handshake is silent, because it leaves the applet no worse off", () => {
    // Every reason it can fail is already reported by the call that needed it,
    // and an applet that cannot ask knows exactly what it knew before asking.
    const contractGateway = recordingContractGateway();
    const {manager, errors} = harness({contractGateway});
    manager.start();
    const before = errors.length;

    contractGateway.calls[0](new Error("UnknownMethod"), null);

    assert.equal(manager.state().contract.known, false);
    assert.equal(errors.length, before);
});

test("a gateway that throws synchronously does not stop the applet starting", () => {
    const contractGateway = {
        describe() {
            throw new Error("bus is gone");
        },
        cancel: () => false,
    };
    const {manager} = harness({contractGateway});

    assert.equal(manager.start(), true);
    assert.equal(manager.state().contract.known, false);
});

test("a service that reappears is asked again rather than assumed unchanged", () => {
    // A name that changed owner may be a different build from the one that
    // answered, so the previous answer describes a service that is not there.
    const contractGateway = recordingContractGateway();
    let listener = null;
    const {manager} = harness({
        contractGateway,
        controlWatch: {
            watch(callback) {
                listener = callback;
                return () => true;
            },
        },
    });
    manager.start();
    assert.equal(contractGateway.calls.length, 1);

    listener(true);
    assert.equal(contractGateway.calls.length, 2);
    listener(false);
    assert.equal(contractGateway.calls.length, 2);
});

test("a late answer from a superseded handshake is ignored", () => {
    const contractGateway = recordingContractGateway();
    let listener = null;
    const {manager} = harness({
        contractGateway,
        controlWatch: {
            watch(callback) {
                listener = callback;
                return () => true;
            },
        },
    });
    manager.start();
    listener(true);

    contractGateway.calls[0](null, new RuntimeContract.RuntimeContract(contractDocument()));

    assert.equal(manager.state().contract.known, false);
});

test("disposing cancels the outstanding handshake and clears its report", () => {
    const contractGateway = recordingContractGateway();
    const {manager} = harness({contractGateway});
    manager.start();

    manager.dispose();

    assert.equal(contractGateway.cancelled, 1);
    contractGateway.calls[0](null, new RuntimeContract.RuntimeContract(contractDocument()));
    assert.equal(contractGateway.calls.length, 1);
});

test("an applet built with no contract gateway simply never knows", () => {
    const {manager} = harness({});

    manager.start();

    assert.equal(manager.state().contract.known, false);
    assert.equal(manager.state().contract.compatible, true);
    assert.equal(manager.dispose(), true);
});
