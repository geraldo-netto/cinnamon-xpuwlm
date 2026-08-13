"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const Execution = require("../../files/cinnamon-xpuwlm@geraldo-netto/lib/background-execution.js");
const {FakeTimer, leasePort, drain} = require("../helpers/background-execution-fixture.js");

function eventDefinition(id, run = async () => {}) {
    return {id, trigger: {kind: "event", event: "sample-ready"}, run};
}

test("periodic and event triggers defer bounded background work with explicit priority", async () => {
    const timer = new FakeTimer();
    const log = [];
    const errors = [];
    const execution = new Execution.BackgroundExecution({
        timer, leasePort: leasePort(log), reportError: (...args) => errors.push(args), maxQueued: 4,
    });
    execution.register({
        id: "periodic-health",
        trigger: {kind: "periodic", intervalMs: 1000},
        run: async (context) => log.push(["run", context.priority, context.payload]),
    });
    execution.register(eventDefinition(
        "event-health", async (context) => log.push(["run", context.priority, context.payload]),
    ));

    assert.equal(timer.count(1000), 1);
    assert.equal(execution.emit("sample-ready", {value: 1})[0].result, "queued");
    assert.equal(log.length, 0, "an event callback must never execute work synchronously");
    assert.equal(timer.count(0), 1);
    await drain(execution, timer);
    assert.deepEqual(log, [
        ["acquire", "background", "event-health"],
        ["run", "background", {value: 1}],
        ["release", "background", "event-health"],
    ]);

    timer.fireDelay(1000);
    assert.equal(timer.count(1000), 1, "periodic work rearms itself");
    await drain(execution, timer);
    assert.deepEqual(log.slice(-3), [
        ["acquire", "background", "periodic-health"],
        ["run", "background", null],
        ["release", "background", "periodic-health"],
    ]);
    assert.deepEqual(errors, []);
});

test("queue coalescing retains the newest payload and reports backpressure", async () => {
    const timer = new FakeTimer();
    const received = [];
    const execution = new Execution.BackgroundExecution({
        timer, leasePort: leasePort([]), reportError: () => {}, maxQueued: 2,
    });
    execution.register(eventDefinition("one", async ({payload}) => received.push(["one", payload])));
    execution.register(eventDefinition("two", async ({payload}) => received.push(["two", payload])));
    execution.register(eventDefinition("three", async ({payload}) => received.push(["three", payload])));

    assert.equal(execution.triggerNow("one", 1), "queued");
    assert.equal(execution.triggerNow("one", 2), "coalesced");
    assert.equal(execution.triggerNow("two", 3), "queued");
    assert.equal(execution.triggerNow("three", 4), "backpressure");
    assert.deepEqual(execution.state().queuedIds, ["one", "two"]);
    await drain(execution, timer);
    assert.deepEqual(received, [["one", 2], ["two", 3]]);
});

test("interactive work preempts background and acquires only after release", async () => {
    const timer = new FakeTimer();
    const log = [];
    let started;
    const backgroundStarted = new Promise((resolve) => { started = resolve; });
    const execution = new Execution.BackgroundExecution({
        timer, leasePort: leasePort(log), reportError: () => {}, maxQueued: 4,
    });
    execution.register(eventDefinition("long", async ({signal}) => {
        started();
        await new Promise((resolve) => signal.onCancel((reason) => {
            log.push(["cancel", reason]);
            resolve();
        }));
    }));
    execution.register(eventDefinition("later", async () => log.push(["run", "later"])));
    execution.triggerNow("long");
    timer.fireDelay(0);
    await backgroundStarted;
    execution.triggerNow("later");

    const answer = await execution.runInteractive({
        id: "selected-file",
        run: async ({priority}) => {
            log.push(["run", priority]);
            return 42;
        },
    });
    assert.equal(answer, 42);
    assert.deepEqual(log.slice(0, 6), [
        ["acquire", "background", "long"],
        ["cancel", "interactive-preemption"],
        ["release", "background", "long"],
        ["acquire", "interactive", "selected-file"],
        ["run", "interactive"],
        ["release", "interactive", "selected-file"],
    ]);
    assert.equal(log.some((entry) => entry[1] === "later"), false);
    await drain(execution, timer);
    assert.equal(log.some((entry) => entry[1] === "later"), true);
});

test("cancellation, unregistration, failures, and disposal release all resources", async () => {
    const timer = new FakeTimer();
    const log = [];
    const errors = [];
    const execution = new Execution.BackgroundExecution({
        timer, leasePort: leasePort(log), reportError: (...args) => errors.push(args), maxQueued: 4,
    });
    const unregister = execution.register(eventDefinition("failure", async () => {
        throw new Error("provider failed");
    }));
    execution.register(eventDefinition("queued"));
    execution.triggerNow("failure");
    execution.triggerNow("queued");
    assert.equal(execution.cancel("queued"), true);
    assert.equal(execution.cancel("missing"), false);
    await drain(execution, timer);
    assert.equal(errors.length, 1);
    assert.match(errors[0][1].message, /provider failed/u);
    assert.deepEqual(log.slice(-1), [["release", "background", "failure"]]);
    assert.equal(unregister(), true);
    assert.equal(unregister(), false);
    assert.equal(execution.dispose(), true);
    assert.equal(execution.dispose(), false);
    assert.equal(execution.state().disposed, true);
    assert.throws(() => execution.emit("sample-ready"), /disposed/u);
});

test("execution validates ports, bounds, definitions, events, leases, and listeners", async () => {
    const timer = new FakeTimer();
    const options = {timer, leasePort: leasePort([]), reportError: () => {}, maxQueued: 1};
    assert.throws(() => new Execution.BackgroundExecution({...options, timer: null}), /timer port/u);
    assert.throws(() => new Execution.BackgroundExecution({
        ...options, timer: {schedule: () => 1},
    }), /timer port/u);
    assert.throws(() => new Execution.BackgroundExecution({
        ...options, timer: {cancel: () => true},
    }), /timer port/u);
    assert.throws(() => new Execution.BackgroundExecution({...options, leasePort: null}), /lease port/u);
    assert.throws(() => new Execution.BackgroundExecution({...options, leasePort: {}}), /lease port/u);
    assert.throws(() => new Execution.BackgroundExecution({...options, reportError: null}), /reporter/u);
    assert.throws(() => new Execution.BackgroundExecution({...options, maxQueued: 0}), /queue bound/u);
    assert.throws(() => new Execution.BackgroundExecution({
        ...options, maxQueued: Execution.MAX_QUEUED + 1,
    }), /queue bound/u);
    assert.doesNotThrow(() => new Execution.BackgroundExecution({
        ...options, maxQueued: Execution.MAX_QUEUED,
    }));
    const execution = new Execution.BackgroundExecution(options);
    assert.deepEqual(Execution.TRIGGER_KINDS, ["event", "periodic"]);
    assert.deepEqual(Execution.QUEUE_RESULTS, ["queued", "coalesced", "backpressure"]);
    assert.equal(Execution.MAX_INTERVAL_MS, 86_400_000);
    assert.equal(Execution.validTrigger({kind: "event", event: "tick"}), true);
    assert.equal(Execution.validTrigger({kind: "periodic", intervalMs: 1000}), true);
    const invalidTriggers = [
        null,
        [],
        {},
        {kind: "unknown"},
        {kind: "event", event: "tick", extra: true},
        {kind: "event", event: "Bad event"},
        {kind: "periodic", intervalMs: 999},
        {kind: "periodic", intervalMs: Execution.MAX_INTERVAL_MS + 1},
        {kind: "periodic", intervalMs: Execution.MAX_INTERVAL_MS, extra: true},
        {kind: "periodic", intervalMs: 1000.5},
    ];
    for (const trigger of invalidTriggers) {
        assert.equal(Execution.validTrigger(trigger), false);
    }
    assert.equal(Execution.validTrigger({
        kind: "periodic", intervalMs: Execution.MAX_INTERVAL_MS,
    }), true);
    assert.equal(Execution.validDefinition(eventDefinition("valid")), true);
    const invalidDefinitions = [
        null,
        {...eventDefinition("bad"), run: null},
        {...eventDefinition("Bad id")},
        {...eventDefinition("bad-trigger"), trigger: {kind: "event", event: "Bad event"}},
        {...eventDefinition("extra"), extra: true},
    ];
    for (const definition of invalidDefinitions) {
        assert.equal(Execution.validDefinition(definition), false);
        assert.throws(() => execution.register(definition), /definition/u);
    }
    execution.register(eventDefinition("valid"));
    assert.throws(() => execution.register(eventDefinition("valid")), /conflicts/u);
    assert.throws(() => execution.emit("Bad event"), /event is invalid/u);
    assert.throws(() => execution.triggerNow("missing"), /is missing/u);
    await assert.rejects(execution.runInteractive({id: "Bad id", run: async () => {}}), /interactive/u);

    const signal = new Execution.CancellationSignal();
    assert.throws(() => signal.onCancel(null), /listener/u);
    assert.equal(signal.cancel("stop"), true);
    assert.equal(signal.cancel("again"), false);
    assert.throws(() => signal.throwIfCancelled(), /stop/u);
    let immediate = null;
    assert.equal(signal.onCancel((reason) => { immediate = reason; })(), false);
    assert.equal(immediate, "stop");
    const removable = new Execution.CancellationSignal();
    let called = false;
    assert.equal(removable.onCancel(() => { called = true; })(), true);
    removable.cancel("removed");
    assert.equal(called, false);

    const errors = [];
    const invalidLease = new Execution.BackgroundExecution({
        timer, leasePort: {acquire: async () => ({})}, reportError: (...args) => errors.push(args), maxQueued: 1,
    });
    invalidLease.register(eventDefinition("invalid-lease"));
    invalidLease.triggerNow("invalid-lease");
    await drain(invalidLease, timer);
    assert.equal(errors[0][1].code, "lease-invalid");
    assert.equal(invalidLease._release(null, "none"), false);
});

test("registration and event routing enforce definition and trigger bounds", () => {
    const timer = new FakeTimer();
    const execution = new Execution.BackgroundExecution({
        timer, leasePort: leasePort([]), reportError: () => {}, maxQueued: 4,
    });
    execution.register(eventDefinition("matching"));
    execution.register({
        id: "different", trigger: {kind: "event", event: "different-event"}, run: async () => {},
    });
    execution.register({
        id: "periodic", trigger: {kind: "periodic", intervalMs: 1000}, run: async () => {},
    });
    assert.deepEqual(execution.emit("sample-ready").map((entry) => entry.id), ["matching"]);

    const periodicTask = [...timer.tasks.values()].find((task) => task.delayMs === 1000);
    assert.equal(execution.unregister("periodic"), true);
    const taskCount = timer.tasks.size;
    periodicTask.callback();
    assert.equal(timer.tasks.size, taskCount, "an unregistered periodic callback cannot rearm");

    const bounded = new Execution.BackgroundExecution({
        timer: new FakeTimer(), leasePort: leasePort([]), reportError: () => {}, maxQueued: 1,
    });
    for (let index = 0; index < Execution.MAX_DEFINITIONS; index += 1) {
        bounded.register(eventDefinition(`bounded-${index}`));
    }
    assert.throws(() => bounded.register(eventDefinition("one-too-many")), /exceeds its bound/u);
});

test("lifecycle edge paths cancel timers, active jobs, stale drains, and busy interaction", async () => {
    const timer = new FakeTimer();
    const periodic = new Execution.BackgroundExecution({
        timer, leasePort: leasePort([]), reportError: () => {}, maxQueued: 2,
    });
    const unregister = periodic.register({
        id: "periodic", trigger: {kind: "periodic", intervalMs: 1000}, run: async () => {},
    });
    assert.equal(unregister(), true);
    assert.equal(timer.cancelled.length, 1);
    assert.equal(periodic._drainOne(), false);
    await periodic.idle();

    const pending = new Execution.BackgroundExecution({
        timer, leasePort: leasePort([]), reportError: () => {}, maxQueued: 2,
    });
    pending.register(eventDefinition("pending"));
    pending.triggerNow("pending");
    const staleDispatch = [...timer.tasks.values()].find((task) => task.delayMs === 0).callback;
    const pendingIdle = pending.idle();
    assert.equal(pending.state().dispatchPending, true);
    assert.equal(pending.dispose(), true);
    await pendingIdle;
    staleDispatch();
    assert.equal(pending._drainOne(), false);

    let started;
    const activeStarted = new Promise((resolve) => { started = resolve; });
    const active = new Execution.BackgroundExecution({
        timer, leasePort: leasePort([]), reportError: () => {}, maxQueued: 2,
    });
    active.register(eventDefinition("active", async ({signal}) => {
        started();
        await new Promise((resolve) => signal.onCancel(resolve));
    }));
    active.triggerNow("active");
    timer.fireDelay(0);
    await activeStarted;
    assert.equal(active.state().activeBackgroundId, "active");
    assert.equal(active._drainOne(), false);
    assert.equal(active.cancel("active"), true);
    await active.idle();

    const disposedActive = new Execution.BackgroundExecution({
        timer, leasePort: leasePort([]), reportError: () => {}, maxQueued: 2,
    });
    let disposedStarted;
    const disposedReady = new Promise((resolve) => { disposedStarted = resolve; });
    disposedActive.register(eventDefinition("disposed-active", async ({signal}) => {
        disposedStarted();
        await new Promise((resolve) => signal.onCancel(resolve));
    }));
    disposedActive.triggerNow("disposed-active");
    timer.fireDelay(0);
    await disposedReady;
    const disposedIdle = disposedActive.idle();
    disposedActive.dispose();
    await disposedIdle;

    let grantLease;
    const interactive = new Execution.BackgroundExecution({
        timer,
        leasePort: {acquire: () => new Promise((resolve) => { grantLease = resolve; })},
        reportError: () => {},
        maxQueued: 2,
    });
    const interactiveRun = interactive.runInteractive({id: "interactive", run: async () => "ok"});
    assert.equal(interactive.state().interactive, true);
    assert.equal(interactive._drainOne(), false);
    await assert.rejects(
        interactive.runInteractive({id: "second", run: async () => {}}), /already active/u,
    );
    const interactiveIdle = interactive.idle();
    grantLease({release: () => {}});
    assert.equal(await interactiveRun, "ok");
    await interactiveIdle;
});
