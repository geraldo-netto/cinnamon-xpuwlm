"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const Domain = require("../../files/cinnamon-tpuwm@geraldo-netto/lib/domain.js");
const FailureBackoff = require("../../files/cinnamon-tpuwm@geraldo-netto/lib/failure-log-backoff.js");
const Manager = require("../../files/cinnamon-tpuwm@geraldo-netto/lib/manager.js");

const NOW = 1_700_000_000_000;

function snapshot() {
    return Domain.probeSnapshot({available: true, name: "Coral", kind: "usb"}, NOW);
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
            portfolio: {paused: false, profiles: {"hardware-health": {enabled: true, weight: 2}}},
        }),
        save: (value) => saves.push(value),
    };
    const runtimeGateway = overrides.runtimeGateway || {read: snapshot};
    const logger = {
        warn: (message) => warnings.push(message),
        error: (message) => errors.push(message),
    };
    const clock = overrides.clock || {now: () => NOW};
    const scheduler = overrides.scheduler || fakeScheduler();
    const manager = new Manager.WorkloadManager({
        repository,
        runtimeGateway,
        clock,
        errorReporter: new FailureBackoff.FailureErrorBackoff({logger}),
        logger,
        scheduler,
        staleAfterMs: overrides.staleAfterMs,
    });
    return {clock, manager, saves, warnings, errors, scheduler};
}

function connectedSnapshot(generatedAt) {
    return Domain.normalizeSnapshot({
        version: Domain.SNAPSHOT_VERSION,
        generatedAt,
        device: {available: true, name: "Coral USB", kind: "usb"},
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
    };
    assert.throws(() => new Manager.WorkloadManager({...base, repository: null}), /repository/);
    assert.throws(() => new Manager.WorkloadManager({...base, runtimeGateway: null}), /gateway/);
    assert.throws(() => new Manager.WorkloadManager({...base, clock: {}}), /clock/);
    assert.throws(() => new Manager.WorkloadManager({...base, errorReporter: {}}), /reporter/);
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
    assert.equal(saves.length, 5);
    assert.equal(saves.at(-1).portfolio.paused, false);
});

test("explicit device retry requests a fresh probe and publishes its result", () => {
    const readOptions = [];
    const {manager} = harness({
        runtimeGateway: {
            read(options) {
                readOptions.push(options);
                return snapshot();
            },
        },
    });
    let publications = 0;
    manager.subscribe(() => { publications += 1; });
    manager.start();
    assert.equal(manager.retryDeviceDetection().device.available, true);
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
    const beforeStart = {read: () => Domain.unavailableSnapshot("before", NOW)};
    assert.equal(manager.replaceRuntimeGateway(beforeStart), undefined);
    assert.equal(manager.state().device.reason, "Monitoring has not started");
    manager.start();
    assert.equal(manager.state().device.reason, "before");
    manager.replaceRuntimeGateway({read: snapshot});
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
        runtimeGateway: {read: () => connectedSnapshot(NOW)},
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
        runtimeGateway: {read: () => connectedSnapshot(generatedAt)},
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
        runtimeGateway: {read: () => connectedSnapshot(NOW)},
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
