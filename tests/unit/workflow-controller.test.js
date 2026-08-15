"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const Workflow = require(
    "../../files/cinnamon-xpuwlm@geraldo-netto/lib/workflow-controller.js"
);

const MAX_POLLS = 2;

function initialState() {
    return {
        available: false,
        availabilityDetail: "not ready",
        phase: "idle",
        message: "",
    };
}

function scheduler() {
    return {
        cancelled: [],
        pending: [],
        schedule(delay, callback) {
            const handle = {callback, delay};
            this.pending.push(handle);
            return handle;
        },
        cancel(handle) {
            this.cancelled.push(handle);
            this.pending = this.pending.filter((candidate) => candidate !== handle);
            return true;
        },
        run() {
            const handle = this.pending.shift();
            assert.ok(handle, "a scheduled poll is required");
            handle.callback();
        },
    };
}

function gateway() {
    return {
        cancelled: 0,
        polls: [],
        submit() {},
        requestResult(document, callback) {
            this.polls.push({callback, document});
        },
        cancelJob() {},
        cancel() {
            this.cancelled += 1;
            return true;
        },
    };
}

class HarnessController extends Workflow.RuntimeWorkflowController {
    constructor({jobGateway, timer}) {
        super({
            clock: {now: () => 1_700_000_000_000},
            cloneState: (state) => ({...state}),
            gateway: jobGateway,
            initialState,
            labels: {
                clock: "Harness clock",
                disposed: "Harness controller",
                failure: "Harness failed",
                gateway: "Harness gateway",
                listener: "Harness listener",
                scheduler: "Harness scheduler",
            },
            pollIntervalMs: 25,
            scheduler: timer,
        });
    }

    start() {
        this._ensureActive();
        const sequence = this._nextSequence();
        this._polls = 0;
        this._replace({phase: "running", message: "Queued"});
        this._schedulePoll(sequence);
        return true;
    }

    _poll(sequence) {
        if (!this._current(sequence) || this._state.phase !== "running") {
            return false;
        }
        this._polls += 1;
        if (this._polls > MAX_POLLS) {
            return this._fail("Harness poll cap reached");
        }
        this._gateway.requestResult(
            {poll: this._polls},
            (error, result) => this._result(sequence, error, result),
        );
        return true;
    }

    _result(sequence, error, result) {
        if (!this._current(sequence) || this._state.phase !== "running") {
            return false;
        }
        if (error) {
            return this._fail(String(error));
        }
        if (result.state === "running") {
            this._schedulePoll(sequence);
            return true;
        }
        this._replace({phase: "complete", message: result.message});
        return true;
    }

    reset(blockedPhases = []) {
        return this._reset(blockedPhases);
    }

    dispose(...cancelPorts) {
        return this._dispose(...cancelPorts);
    }
}

function harness() {
    const timer = scheduler();
    const jobGateway = gateway();
    const controller = new HarnessController({jobGateway, timer});
    return {controller, jobGateway, timer};
}

test("runtime workflow polling stops exactly after its cap", () => {
    const {controller, jobGateway, timer} = harness();
    controller.start();
    for (let poll = 0; poll < MAX_POLLS; poll += 1) {
        assert.equal(timer.pending[0].delay, 25);
        timer.run();
        assert.deepEqual(jobGateway.polls[poll].document, {poll: poll + 1});
        jobGateway.polls[poll].callback(null, {state: "running"});
    }

    timer.run();
    assert.equal(jobGateway.polls.length, MAX_POLLS);
    assert.equal(controller.state().phase, "error");
    assert.equal(controller.state().message, "Harness poll cap reached");
    assert.deepEqual(timer.pending, []);
});

test("disposing an in-flight poll cancels the gateway and ignores its callback", () => {
    const {controller, jobGateway, timer} = harness();
    const states = [];
    controller.subscribe((state) => states.push(state));
    controller.start();
    timer.run();
    const callback = jobGateway.polls[0].callback;

    assert.equal(controller.dispose(), true);
    assert.equal(controller.dispose(), false);
    assert.equal(jobGateway.cancelled, 1);
    assert.deepEqual(controller.state(), initialState());
    assert.equal(callback(null, {state: "complete", message: "late"}), false);
    assert.deepEqual(controller.state(), initialState());
    assert.equal(states.at(-1).phase, "running");
    assert.throws(() => controller.start(), /disposed/u);
});

test("listener removal and transport failures have exact notification boundaries", () => {
    const {controller, jobGateway, timer} = harness();
    const states = [];
    const unsubscribe = controller.subscribe((state) => states.push(state));
    controller.start();
    timer.run();
    jobGateway.polls[0].callback(new Error("transport offline"));

    assert.deepEqual(states.map((state) => state.phase), ["running", "error"]);
    assert.equal(states.at(-1).message, "Error: transport offline");
    assert.equal(unsubscribe(), true);
    assert.equal(unsubscribe(), false);
    assert.equal(controller.setAvailability(true, "Ready"), true);
    assert.equal(states.length, 2);
});

test("a failing workflow listener cannot block later subscribers", () => {
    const {controller} = harness();
    const states = [];
    controller.subscribe((state) => {
        state.phase = "corrupted";
        throw new Error("view failed");
    });
    controller.subscribe((state) => states.push(state));

    assert.doesNotThrow(() => controller.start());
    assert.equal(controller.state().phase, "running");
    assert.deepEqual(states.map((state) => state.phase), ["running"]);
});

// Every workflow is constructed from injected ports, and a missing or
// half-implemented one is a programming error that must surface at
// construction rather than as a crash mid-run on a user's desktop.
test("a port missing any required method is refused by name", () => {
    const complete = {submit() {}, requestResult() {}, cancelJob() {}, cancel() {}};

    assert.equal(Workflow.requirePort(complete, ["submit", "cancel"], "Gateway"), complete);
    assert.equal(Workflow.requirePort(complete, [], "Gateway"), complete);

    for (const candidate of [null, undefined, 0, "", false]) {
        assert.throws(
            () => Workflow.requirePort(candidate, ["submit"], "Gateway"),
            /Gateway is required/u,
            JSON.stringify(candidate),
        );
    }

    // One absent method is enough, and the label names which port it was.
    for (const missing of ["submit", "requestResult", "cancelJob", "cancel"]) {
        const partial = {...complete};
        delete partial[missing];
        assert.throws(
            () => Workflow.requirePort(partial, Object.keys(complete), "Media gateway"),
            /Media gateway is required/u,
            missing,
        );
    }

    // A property that exists but is not callable is the same fault.
    assert.throws(
        () => Workflow.requirePort({...complete, submit: true}, ["submit"], "Gateway"),
        /Gateway is required/u,
    );
});

test("a controller refuses a gateway, scheduler, or clock it cannot use", () => {
    const jobGateway = gateway();
    const timer = scheduler();

    assert.throws(() => new HarnessController({jobGateway: {}, timer}), /gateway is required/iu);
    assert.throws(() => new HarnessController({jobGateway, timer: {}}), /scheduler is required/iu);

    // The clock is checked the same way, against a controller that injects one.
    assert.throws(
        () => new Workflow.RuntimeWorkflowController({
            clock: {},
            cloneState: (state) => ({...state}),
            gateway: jobGateway,
            initialState,
            labels: {clock: "Harness clock", listener: "Harness listener"},
            pollIntervalMs: 25,
            scheduler: timer,
        }),
        /clock is required/iu,
    );
});

test("availability publishes only when it changes, and bounds its detail", () => {
    const controller = new HarnessController({jobGateway: gateway(), timer: scheduler()});
    const seen = [];
    controller.subscribe((state) => seen.push([state.available, state.availabilityDetail]));

    assert.equal(controller.setAvailability(true, "Ready on gpu"), true);
    assert.equal(controller.setAvailability(true, "Ready on gpu"), false, "no change");
    assert.equal(controller.setAvailability(false, "Provider stopped"), true);
    assert.equal(controller.setAvailability(false, "Provider stopped"), false, "no change");

    // Only `true` means available: anything else is a refusal to claim it, so
    // this changes the detail and nothing else.
    assert.equal(controller.setAvailability("yes", "Provider stopped"), false, "still false");
    assert.equal(controller.state().available, false);

    // A detail outside the bound is dropped rather than published.
    assert.equal(controller.setAvailability(true, "x".repeat(241)), true);
    assert.equal(controller.state().availabilityDetail, "");
    assert.equal(controller.setAvailability(true, "x".repeat(240)), true);
    assert.equal(controller.state().availabilityDetail, "x".repeat(240));

    assert.deepEqual(seen.map(([available]) => available), [true, false, true, true]);
});

test("a listener is a function, and unsubscribing stops delivery", () => {
    const controller = new HarnessController({jobGateway: gateway(), timer: scheduler()});
    for (const candidate of [null, undefined, 7, "listener", {}]) {
        assert.throws(() => controller.subscribe(candidate), /listener is required/iu);
    }

    const seen = [];
    const unsubscribe = controller.subscribe((state) => seen.push(state.available));
    controller.setAvailability(true);
    assert.deepEqual(seen, [true]);

    assert.equal(unsubscribe(), true);
    assert.equal(unsubscribe(), false, "unsubscribing twice removes nothing");
    controller.setAvailability(false);
    assert.deepEqual(seen, [true], "no delivery after unsubscribe");
});

test("state is handed out as a copy, so a caller cannot edit the controller", () => {
    const controller = new HarnessController({jobGateway: gateway(), timer: scheduler()});
    controller.setAvailability(true, "Ready");

    const first = controller.state();
    first.available = false;
    first.availabilityDetail = "tampered";

    assert.equal(controller.state().available, true);
    assert.equal(controller.state().availabilityDetail, "Ready");
    assert.notEqual(controller.state(), controller.state(), "each call is its own copy");
});

// Reset returns a workflow to its starting state without forgetting what the
// runtime said about availability, and refuses while work the user can still
// see is in flight.
test("reset keeps availability, clears everything else, and is refused mid-flight", () => {
    const controller = new HarnessController({jobGateway: gateway(), timer: scheduler()});
    controller.setAvailability(true, "Ready on gpu");
    controller.start();
    assert.equal(controller.state().phase, "running");

    assert.equal(controller.reset(["running"]), false, "running work is not discarded silently");
    assert.equal(controller.state().phase, "running");

    assert.equal(controller.reset(["cancelling"]), true);
    const state = controller.state();
    assert.equal(state.phase, "idle", "back to the initial phase");
    assert.equal(state.message, "", "and the initial message");
    assert.equal(state.available, true, "availability is the runtime's answer, not ours");
    assert.equal(state.availabilityDetail, "Ready on gpu");
});

// Disposal has to be final and idempotent: a second teardown must not cancel a
// transport twice or hand a listener a state after the applet is gone.
test("disposal cancels once, forgets listeners, and refuses later work", () => {
    const jobGateway = gateway();
    const timer = scheduler();
    const controller = new HarnessController({jobGateway, timer});
    const seen = [];
    controller.subscribe((state) => seen.push(state.phase));

    controller.setAvailability(true);
    controller.start();
    assert.equal(timer.pending.length, 1, "a poll is armed");

    const extra = {cancelled: 0, cancel() { this.cancelled += 1; }};
    assert.equal(controller.dispose(extra), true);
    assert.equal(jobGateway.cancelled, 1);
    assert.equal(extra.cancelled, 1, "every supplied port is cancelled");
    assert.equal(timer.cancelled.length, 1, "the armed poll is cancelled");
    assert.equal(controller.state().phase, "idle", "state returns to its initial shape");

    const delivered = seen.length;
    assert.equal(controller.dispose(extra), false, "disposal is idempotent");
    assert.equal(jobGateway.cancelled, 1, "and cancels nothing a second time");
    assert.equal(extra.cancelled, 1);
    assert.equal(seen.length, delivered, "a disposed controller publishes nothing");

    assert.throws(() => controller.start(), /is disposed/u);
    assert.throws(() => controller.reset([]), /is disposed/u);
});

// A reply belonging to a superseded run must be ignored, and disposal
// supersedes everything: both are the same guard.
test("only the current sequence is acted on, and disposal supersedes all of them", () => {
    const timer = scheduler();
    const controller = new HarnessController({jobGateway: gateway(), timer});
    controller.setAvailability(true);

    controller.start();
    const stale = timer.pending[0];
    controller.start();
    // The superseded poll is still armed: it is neutralised by the sequence it
    // captured, not by being cancelled, which is what makes a late transport
    // reply safe too.
    assert.equal(timer.pending.length, 2);

    // Firing the superseded poll must not move the current run.
    stale.callback();
    assert.equal(controller.state().phase, "running");

    controller.dispose();
    assert.doesNotThrow(() => timer.pending.forEach((handle) => handle.callback()));
    assert.equal(controller.state().phase, "idle");
});
