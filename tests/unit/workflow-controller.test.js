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

    dispose() {
        return this._dispose();
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
