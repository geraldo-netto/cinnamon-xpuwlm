"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const Controller = require("../../files/cinnamon-xpuwlm@geraldo-netto/lib/generic-workflow-controller.js");
const Surface = require("../../files/cinnamon-xpuwlm@geraldo-netto/lib/generic-workflow-surface.js");

const DEFINITION = Object.freeze({
    version: 1,
    id: "hardware-health",
    title: "Hardware health",
    description: "Review local anomaly evidence",
    consentPurpose: "",
    supportsBackground: true,
    retentionText: "Results stay on this computer.",
    reviewOnly: true,
});

function riskResult(operationId = "op-1") {
    return {
        version: 1,
        kind: "risk-score",
        workloadId: "hardware-health",
        operationId,
        createdAt: 1,
        payload: {label: "Fan", score: 0.4, threshold: 0.8, evidenceIds: ["e1"]},
    };
}

function harness({definition = DEFINITION, result = riskResult(), states = null, accept = true} = {}) {
    const calls = [];
    const pending = [];
    const replies = states === null ? [{state: "succeeded", output: result, message: ""}] : [...states];
    const gateway = {
        submit(request, callback) {
            calls.push(["submit", request.requestId, request.workloadId]);
            callback(null, accept
                ? {status: "accepted", jobId: "job-1", message: "queued"}
                : {status: "refused", message: "no capacity"});
        },
        requestResult(request, callback) {
            calls.push(["result", request.jobId]);
            callback(null, {jobId: "job-1", message: "", ...replies.shift()});
        },
        cancelJob(request, callback) {
            calls.push(["cancel", request.jobId]);
            callback(null, {});
        },
        cancel() {
            calls.push(["dispose"]);
        },
    };
    const scheduler = {
        schedule(_delay, run) {
            pending.push(run);
            return pending.length;
        },
        cancel(handle) {
            calls.push(["unschedule", handle]);
        },
    };
    const controller = new Controller.GenericWorkflowController({
        definition,
        gateway,
        scheduler,
        clock: {now: () => 1000},
        buildRequest: (requestId) => ({requestId, workloadId: definition.id}),
    });
    const drain = () => {
        while (pending.length > 0) {
            pending.shift()();
        }
    };
    // One poll at a time, so a test can observe the running state instead of
    // racing past it to the terminal one.
    const step = () => {
        const run = pending.shift();
        if (run !== undefined) {
            run();
        }
    };
    return {calls, controller, drain, gateway, pending, scheduler, step};
}

test("a definition the surface would refuse is refused at construction", () => {
    assert.throws(() => harness({definition: {...DEFINITION, reviewOnly: false}}), /definition/u);
    assert.throws(
        () => new Controller.GenericWorkflowController({
            definition: DEFINITION,
            gateway: {submit() {}, requestResult() {}, cancelJob() {}, cancel() {}},
            scheduler: {schedule() {}, cancel() {}},
            buildRequest: null,
        }),
        /request builder/u,
    );
});

test("a run reaches the runtime and its evidence becomes a surface model", () => {
    const {calls, controller, drain} = harness();
    controller.setAvailability(true);
    assert.equal(controller.model().status.label, "Ready");

    assert.equal(controller.runNow(), true);
    drain();

    const model = controller.model();
    assert.equal(model.status.tone, "healthy");
    assert.equal(model.result.kind, "risk-score");
    assert.equal(model.result.rows.length, 1);
    assert.equal(model.retention.count, 1);
    assert.equal(model.reviewOnly, true);
    assert.deepEqual(calls[0], ["submit", "xpuwlm-hardware-health-1000-1", "hardware-health"]);
});

test("an unavailable or unconsented workflow never reaches the runtime", () => {
    const {calls, controller} = harness();
    assert.equal(controller.runNow(), false, "unavailable");

    controller.setAvailability(true);
    const consenting = harness({definition: {...DEFINITION, consentPurpose: "Reads local sensors"}});
    consenting.controller.setAvailability(true);
    const gated = new Controller.GenericWorkflowController({
        definition: {...DEFINITION, consentPurpose: "Reads local sensors"},
        gateway: consenting.gateway,
        scheduler: consenting.scheduler,
        clock: {now: () => 1},
        buildRequest: (requestId) => ({requestId}),
        consentRequired: true,
    });
    gated.setAvailability(true);
    assert.equal(gated.model().consent.state, "required");
    assert.equal(gated.runNow(), false, "consent required");
    assert.equal(gated.grantConsent(), true);
    assert.equal(gated.runNow(), true);
    assert.equal(calls.length, 0, "the unavailable controller never submitted");
});

test("a refused submission and an unparseable result both surface as a warning", () => {
    const refused = harness({accept: false});
    refused.controller.setAvailability(true);
    refused.controller.runNow();
    assert.equal(refused.controller.model().status.tone, "attention");
    assert.equal(refused.controller.model().warning, "no capacity");

    const malformed = harness({result: {version: 1, kind: "risk-score"}});
    malformed.controller.setAvailability(true);
    malformed.controller.runNow();
    malformed.drain();
    assert.equal(malformed.controller.model().status.tone, "attention");
    assert.notEqual(malformed.controller.model().warning, "");
});

test("progress is reported while running and the job is cancellable", () => {
    const {calls, controller, step} = harness({
        states: [
            {state: "running", progress: {fraction: 0.5, detail: "Reading sensors"}},
            {state: "succeeded", output: riskResult()},
        ],
    });
    controller.setAvailability(true);
    controller.runNow();
    step();

    const running = controller.model();
    assert.equal(running.progress.visible, true);
    assert.equal(running.progress.text, "50% · Reading sensors");
    assert.equal(running.actions.some((action) => action.id === "cancel"), true);

    assert.equal(controller.cancel(), true);
    assert.equal(controller.model().status.label, "Ready");
    assert.equal(calls.some(([name]) => name === "cancel"), true);
    assert.equal(controller.cancel(), false, "an idle workflow has nothing to cancel");
});

test("retained evidence is only cleared when the user clears it", () => {
    const {controller, drain} = harness();
    controller.setAvailability(true);
    controller.runNow();
    drain();
    assert.equal(controller.model().retention.count, 1);

    assert.equal(controller.clearResults(), true);
    assert.equal(controller.model().result, null);
    assert.equal(controller.model().retention.count, 0);
    assert.equal(controller.clearResults(), false, "nothing left to clear");
});

test("background is opt-in and only where the definition supports it", () => {
    const {controller} = harness();
    assert.equal(controller.model().background.visible, true);
    assert.equal(controller.setBackgroundEnabled(true), true);
    assert.equal(controller.model().background.enabled, true);
    assert.equal(controller.setBackgroundEnabled(true), false, "already enabled");

    const plain = harness({definition: {...DEFINITION, supportsBackground: false}});
    assert.equal(plain.controller.setBackgroundEnabled(true), false);
    assert.equal(plain.controller.model().background.visible, false);
});

test("revoking consent stops work that is already running", () => {
    const gateway = {
        submit(_request, callback) {
            callback(null, {status: "accepted", jobId: "job-1", message: ""});
        },
        requestResult() {},
        cancelJob(_request, callback) {
            callback(null, {});
        },
        cancel() {},
    };
    const controller = new Controller.GenericWorkflowController({
        definition: {...DEFINITION, consentPurpose: "Reads local sensors"},
        gateway,
        scheduler: {schedule: () => 1, cancel() {}},
        clock: {now: () => 1},
        buildRequest: (requestId) => ({requestId}),
        consentRequired: true,
    });
    controller.setAvailability(true);
    controller.grantConsent();
    controller.runNow();
    assert.equal(controller.model().status.tone, "running");

    assert.equal(controller.revokeConsent(), true);
    assert.equal(controller.model().consent.state, "denied");
    assert.equal(Surface.consentAllowsRun(controller.model().consent.state), false);
    assert.equal(controller.model().status.tone, "healthy", "the run was cancelled");
});

test("the registry routes one action per workflow and refuses unknown names", () => {
    const registry = new Controller.GenericWorkflowRegistry();
    const {controller, drain} = harness();
    controller.setAvailability(true);
    registry.register(controller);

    let published = 0;
    const unsubscribe = registry.subscribe(() => {
        published += 1;
    });

    assert.equal(registry.models().length, 1);
    assert.equal(registry.controller("hardware-health"), controller);
    assert.equal(registry.controller("absent"), null);
    assert.equal(registry.dispatch("hardware-health", "run-now"), true);
    drain();
    assert.equal(registry.models()[0].result.kind, "risk-score");
    assert.equal(registry.dispatch("absent", "run-now"), false);
    assert.equal(registry.dispatch("hardware-health", "not-an-action"), false);
    assert.equal(published > 0, true);

    unsubscribe();
    assert.throws(() => registry.register(controller), /already registered/u);
    assert.throws(() => registry.register({}), /controller is required/u);
    assert.throws(() => registry.subscribe(null), /listener is required/u);
    assert.equal(registry.dispose(), true);
});

test("a background-capable workflow runs only while background stays enabled", () => {
    const registrations = [];
    const background = {
        register(definition) {
            registrations.push(definition);
            return () => registrations.pop();
        },
    };
    const registry = new Controller.GenericWorkflowRegistry({background});
    const {calls, controller} = harness();
    controller.setAvailability(true);
    registry.register(controller);

    assert.equal(registrations.length, 1);
    assert.equal(registrations[0].id, "hardware-health");
    assert.equal(registrations[0].trigger.kind, "periodic");

    registrations[0].run();
    assert.equal(calls.filter(([name]) => name === "submit").length, 0, "background is off");

    controller.setBackgroundEnabled(true);
    registrations[0].run();
    assert.equal(calls.filter(([name]) => name === "submit").length, 1);
    registry.dispose();
});

test("consent is inert where the definition never asks for it", () => {
    const {controller} = harness();
    assert.equal(controller.model().consent.visible, false);
    assert.equal(controller.grantConsent(), false, "nothing to grant");
    assert.equal(controller.revokeConsent(), false, "nothing to revoke");

    const gated = harness({definition: {...DEFINITION, consentPurpose: "Reads local sensors"}});
    const asked = new Controller.GenericWorkflowController({
        definition: {...DEFINITION, consentPurpose: "Reads local sensors"},
        gateway: gated.gateway,
        scheduler: gated.scheduler,
        clock: {now: () => 1},
        buildRequest: (requestId) => ({requestId}),
        consentRequired: true,
    });
    assert.equal(asked.grantConsent(), true);
    assert.equal(asked.grantConsent(), false, "already granted");
});

test("a request the workflow cannot build never reaches the transport", () => {
    const {calls, gateway, scheduler} = harness();
    const controller = new Controller.GenericWorkflowController({
        definition: DEFINITION,
        gateway,
        scheduler,
        clock: {now: () => 1},
        buildRequest: () => {
            throw new TypeError("submission is invalid");
        },
    });
    controller.setAvailability(true);
    assert.equal(controller.runNow(), false);
    assert.equal(controller.model().warning, "submission is invalid",
        "the user reads the sentence, not the constructor name");
    assert.equal(calls.length, 0);
});

test("a transport that throws is reported rather than escaping the caller", () => {
    const throwing = {
        submit() {
            throw new Error("bus is gone");
        },
        requestResult() {
            throw new Error("bus is gone");
        },
        cancelJob() {
            throw new Error("bus is gone");
        },
        cancel() {},
    };
    const controller = new Controller.GenericWorkflowController({
        definition: DEFINITION,
        gateway: throwing,
        scheduler: {schedule: () => 1, cancel() {}},
        clock: {now: () => 1},
        buildRequest: (requestId) => ({requestId}),
    });
    controller.setAvailability(true);
    assert.equal(controller.runNow(), true);
    assert.equal(controller.model().status.tone, "attention");
    assert.match(controller.model().warning, /bus is gone/u);
});

test("a failed, cancelled, or unknown job states its outcome", () => {
    for (const [state, expected] of [
        ["failed", /refused/u],
        ["cancelled", /cancelled/u],
        ["unknown", /unknown/u],
    ]) {
        const {controller, drain} = harness({
            states: [{state, message: state === "failed" ? "the runtime refused it" : ""}],
        });
        controller.setAvailability(true);
        controller.runNow();
        drain();
        assert.equal(controller.model().status.tone, "attention", state);
        assert.match(controller.model().warning, expected, state);
    }
});

test("polling gives up rather than waiting for a runtime that never answers", () => {
    const {controller, pending, scheduler} = harness({states: []});
    let answered = 0;
    const gateway = {
        submit(_request, callback) {
            callback(null, {status: "accepted", jobId: "job-1", message: ""});
        },
        requestResult(_request, callback) {
            answered += 1;
            callback(null, {state: "running", jobId: "job-1", message: "", progress: null});
        },
        cancelJob(_request, callback) {
            callback(null, {});
        },
        cancel() {},
    };
    const bounded = new Controller.GenericWorkflowController({
        definition: DEFINITION,
        gateway,
        scheduler,
        clock: {now: () => 1},
        buildRequest: (requestId) => ({requestId}),
    });
    bounded.setAvailability(true);
    bounded.runNow();
    while (pending.length > 0 && answered <= Controller.MAX_POLLS) {
        pending.shift()();
    }
    assert.equal(answered, Controller.MAX_POLLS);
    assert.equal(bounded.model().status.tone, "attention");
    assert.equal(controller.model().status.label, "Unavailable");
});

test("a poll that fails is retried instead of failing the run", () => {
    let attempts = 0;
    const pending = [];
    const gateway = {
        submit(_request, callback) {
            callback(null, {status: "accepted", jobId: "job-1", message: ""});
        },
        requestResult(_request, callback) {
            attempts += 1;
            if (attempts === 1) {
                callback(new Error("transient"), null);
                return;
            }
            callback(null, {
                state: "succeeded", jobId: "job-1", message: "", output: riskResult(),
            });
        },
        cancelJob(_request, callback) {
            callback(null, {});
        },
        cancel() {},
    };
    const controller = new Controller.GenericWorkflowController({
        definition: DEFINITION,
        gateway,
        scheduler: {
            schedule(_delay, run) {
                pending.push(run);
                return pending.length;
            },
            cancel() {},
        },
        clock: {now: () => 1},
        buildRequest: (requestId) => ({requestId}),
    });
    controller.setAvailability(true);
    controller.runNow();
    while (pending.length > 0) {
        pending.shift()();
    }
    assert.equal(attempts, 2);
    assert.equal(controller.model().result.kind, "risk-score");
});

test("cancelling before the runtime answers needs no cancel call", () => {
    const calls = [];
    const gateway = {
        submit() {
            calls.push(["submit"]);
        },
        requestResult() {},
        cancelJob() {
            calls.push(["cancel"]);
        },
        cancel() {},
    };
    const controller = new Controller.GenericWorkflowController({
        definition: DEFINITION,
        gateway,
        scheduler: {schedule: () => 1, cancel() {}},
        clock: {now: () => 1},
        buildRequest: (requestId) => ({requestId}),
    });
    controller.setAvailability(true);
    controller.runNow();
    assert.equal(controller.cancel(), true);
    assert.equal(controller.model().status.label, "Ready");
    assert.deepEqual(calls, [["submit"]], "no job id to cancel yet");
});

// A transport that throws is the same class of failure as one that reports an
// error: transient, retried, and bounded by the poll limit rather than left
// running forever.
test("a poll the transport cannot deliver is retried until the bound is reached", () => {
    let attempts = 0;
    const gateway = {
        submit(_request, callback) {
            callback(null, {status: "accepted", jobId: "job-1", message: ""});
        },
        requestResult() {
            attempts += 1;
            throw new Error("bus is gone");
        },
        cancelJob(_request, callback) {
            callback(null, {});
        },
        cancel() {},
    };
    const pending = [];
    const controller = new Controller.GenericWorkflowController({
        definition: DEFINITION,
        gateway,
        scheduler: {
            schedule(_delay, run) {
                pending.push(run);
                return pending.length;
            },
            cancel() {},
        },
        clock: {now: () => 1},
        buildRequest: (requestId) => ({requestId}),
    });
    controller.setAvailability(true);
    controller.runNow();

    pending.shift()();
    assert.equal(attempts, 1);
    assert.equal(controller.model().status.tone, "running", "one throw is transient");

    while (pending.length > 0) {
        pending.shift()();
    }
    assert.equal(attempts, Controller.MAX_POLLS);
    assert.equal(controller.model().status.tone, "attention");
    assert.match(controller.model().warning, /did not report/u);
});

test("a running workflow is cancellable through the registry", () => {
    const registry = new Controller.GenericWorkflowRegistry();
    const {calls, controller} = harness({states: []});
    controller.setAvailability(true);
    registry.register(controller);

    assert.equal(registry.dispatch("hardware-health", "run-now"), true);
    assert.equal(registry.models()[0].status.tone, "running");
    assert.equal(registry.dispatch("hardware-health", "cancel"), true);
    assert.equal(calls.some(([name]) => name === "cancel"), true);
    assert.equal(registry.models()[0].status.tone, "healthy");
    registry.dispose();
});

test("a cancel the transport cannot deliver still leaves the workflow idle", () => {
    const gateway = {
        submit(_request, callback) {
            callback(null, {status: "accepted", jobId: "job-1", message: ""});
        },
        requestResult() {},
        cancelJob() {
            throw new Error("bus is gone");
        },
        cancel() {},
    };
    const controller = new Controller.GenericWorkflowController({
        definition: DEFINITION,
        gateway,
        scheduler: {schedule: () => 1, cancel() {}},
        clock: {now: () => 1},
        buildRequest: (requestId) => ({requestId}),
    });
    controller.setAvailability(true);
    controller.runNow();
    assert.equal(controller.cancel(), true);
    assert.equal(controller.model().status.label, "Ready");
});

test("clearing is refused while the workflow is still working", () => {
    const {controller} = harness({states: []});
    controller.setAvailability(true);
    controller.runNow();
    assert.equal(controller.model().status.tone, "running");
    assert.equal(controller.clearResults(), false);
});

test("a listener that throws cannot unwind the controller", () => {
    const {controller} = harness();
    controller.subscribe(() => {
        throw new Error("view exploded");
    });
    assert.equal(controller.setAvailability(true), true);
    assert.equal(controller.model().status.label, "Ready");
    assert.throws(() => controller.subscribe(null), /listener is required/u);
});

test("a registry listener that throws cannot unwind a transport callback", () => {
    const registry = new Controller.GenericWorkflowRegistry();
    const {controller} = harness();
    registry.register(controller);
    registry.subscribe(() => {
        throw new Error("view exploded");
    });
    assert.equal(controller.setAvailability(true), true);
    assert.equal(registry.models()[0].status.label, "Ready");
    registry.dispose();
});

// A reply belonging to a superseded run must not move the current one, or a
// slow first job would overwrite the result of the second.
test("replies from a superseded run are discarded", () => {
    const late = {accepted: null, result: null, cancelled: null};
    const gateway = {
        submit(_request, callback) {
            late.accepted = callback;
        },
        requestResult(_request, callback) {
            late.result = callback;
        },
        cancelJob(_request, callback) {
            late.cancelled = callback;
        },
        cancel() {},
    };
    const pending = [];
    const controller = new Controller.GenericWorkflowController({
        definition: DEFINITION,
        gateway,
        scheduler: {
            schedule(_delay, run) {
                pending.push(run);
                return pending.length;
            },
            cancel() {},
        },
        clock: {now: () => 1},
        buildRequest: (requestId) => ({requestId}),
    });
    controller.setAvailability(true);

    // Cancelled before the runtime answered: the acceptance still arrives, and
    // accepting it would restart work the user just stopped.
    controller.runNow();
    const staleAccept = late.accepted;
    assert.equal(controller.cancel(), true);
    staleAccept(null, {status: "accepted", jobId: "stale", message: ""});
    assert.equal(controller.model().status.tone, "healthy", "the cancelled run stayed cancelled");

    // Cancelled while running: the poll in flight must not deliver a result.
    controller.runNow();
    late.accepted(null, {status: "accepted", jobId: "job-1", message: ""});
    pending.shift()();
    const staleResult = late.result;
    assert.equal(controller.cancel(), true);
    staleResult(null, {state: "succeeded", jobId: "job-1", message: "", output: riskResult()});
    assert.equal(controller.model().result, null, "the cancelled run kept no result");

    // And the cancel confirmation for a run that has already been superseded
    // must not move the one that replaced it.
    const staleCancel = late.cancelled;
    late.cancelled(null, {});
    controller.runNow();
    staleCancel(null, {});
    assert.equal(controller.model().status.tone, "running", "the stale cancel was ignored");
});

test("every action the surface offers is routed by the registry", () => {
    const registry = new Controller.GenericWorkflowRegistry();
    const {controller, drain} = harness({
        definition: {...DEFINITION, consentPurpose: "Reads local sensors"},
    });
    const gated = new Controller.GenericWorkflowController({
        definition: {...DEFINITION, consentPurpose: "Reads local sensors"},
        gateway: controller._gateway,
        scheduler: controller._scheduler,
        clock: {now: () => 1},
        buildRequest: (requestId) => ({requestId}),
        consentRequired: true,
    });
    gated.setAvailability(true);
    registry.register(gated);

    assert.deepEqual(
        Object.keys(Controller.ACTIONS).sort(),
        ["cancel", "clear", "grant-consent", "revoke-consent", "run-now", "toggle-background"],
    );
    assert.equal(registry.dispatch("hardware-health", "grant-consent"), true);
    assert.equal(registry.dispatch("hardware-health", "toggle-background", true), true);
    assert.equal(registry.dispatch("hardware-health", "run-now"), true);
    drain();
    assert.equal(registry.dispatch("hardware-health", "clear"), true);
    assert.equal(registry.dispatch("hardware-health", "revoke-consent"), true);
    assert.equal(registry.models()[0].consent.state, "denied");
    registry.dispose();
});

// Live regression: with nothing driving availability every generic workflow
// read "Unavailable" with no reason after it, and Run could never be pressed.
test("availability and its reason come from the snapshot the runtime published", () => {
    const registry = new Controller.GenericWorkflowRegistry();
    const serving = harness({definition: {...DEFINITION, id: "visual-library"}});
    const blocked = harness({definition: {...DEFINITION, id: "low-light-enhancement"}});
    registry.register(serving.controller);
    registry.register(blocked.controller);
    const servable = (profile) => ["healthy", "running", "watching", "idle"].includes(profile.status)
        && profile.enabled !== false;

    assert.equal(registry.applyProfiles([
        {id: "visual-library", status: "watching", enabled: true, detail: "Serving on gpu"},
        {
            id: "low-light-enhancement",
            status: "unavailable",
            enabled: true,
            detail: "gpu: the manifest declares this model without a sha256",
        },
    ], servable), true);

    const [ready, stopped] = registry.models();
    assert.equal(ready.status.label, "Ready");
    assert.equal(ready.actions.find((action) => action.id === "run-now").enabled, true);
    assert.equal(stopped.status.label, "Unavailable");
    assert.match(stopped.unavailable.detail, /without a sha256/u);
    assert.equal(stopped.actions.find((action) => action.id === "run-now").enabled, false);

    // A profile the snapshot stops declaring has no reason left to give.
    assert.equal(registry.applyProfiles([], servable), true);
    assert.equal(registry.models()[0].status.label, "Unavailable");
    assert.equal(registry.models()[0].unavailable.detail, "");
    assert.equal(registry.applyProfiles([], servable), false, "no change to publish");

    assert.equal(registry.applyProfiles(null, servable), false);
    assert.throws(() => registry.applyProfiles([], null), /predicate is required/u);
    registry.dispose();
});

// Live regression: a failed run has neither a result nor a retained count, so
// the clear rule refused it and the surface offered no control at all. The
// workflow read "Needs attention" until some later run happened to succeed.
test("a failed run can be dismissed even though it retained nothing", () => {
    const {controller} = harness({accept: false});
    controller.setAvailability(true);
    controller.runNow();

    const failed = controller.model();
    assert.equal(failed.status.tone, "attention");
    assert.equal(failed.retention.count, 0);
    assert.equal(failed.result, null);
    const dismiss = failed.actions.find((item) => item.id === "clear");
    assert.notEqual(dismiss, undefined, "the surface offers a way out");
    assert.equal(dismiss.label, "Dismiss", "nothing was retained, so nothing is cleared");

    assert.equal(controller.clearResults(), true);
    assert.equal(controller.model().status.label, "Ready");
    assert.equal(controller.model().warning, "");
    assert.equal(controller.clearResults(), false, "an idle workflow has nothing to dismiss");
});

test("a disposed controller refuses further work", () => {
    const {controller} = harness();
    controller.setAvailability(true);
    assert.equal(controller.dispose(), true);
    assert.throws(() => controller.runNow(), /disposed/u);
    assert.equal(controller.dispose(), false);
});
