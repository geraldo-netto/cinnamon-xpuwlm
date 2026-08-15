"use strict";

// The application layer for `generic-workflow-surface.js`.
//
// The surface renders one workflow from a definition and a state; the bespoke
// workflows each own a controller that produces theirs. This is the shared one:
// a workflow whose whole interaction is "run it, watch it, read the evidence"
// needs no bespoke controller, and every runtime-backed workload profile is
// that shape. Definitions come from the caller, so a profile is exposed by
// registering it rather than by adding a module.

const Background = require("./background-execution.js");
const I18n = require("./i18n.js");
const Result = require("./workload-result.js");
const Surface = require("./generic-workflow-surface.js");
const Workflow = require("./workflow-controller.js");

const {_, format} = I18n;

const POLL_INTERVAL_MS = 900;
const MAX_POLLS = 400;
const MAX_RETAINED = 32;
// The base controller's vocabulary is wider than the surface's, because a
// bespoke workflow also has selection phases. A generic workflow has none, so
// only the submission phase needs renaming.
const SURFACE_PHASES = Object.freeze({
    idle: "idle",
    submitting: "queued",
    running: "running",
    cancelling: "cancelling",
    complete: "complete",
    error: "error",
});

function initialState() {
    return {
        available: false,
        availabilityDetail: "",
        phase: "idle",
        jobId: "",
        message: "",
        progress: null,
        result: null,
        consent: "not-required",
        backgroundEnabled: false,
        retainedCount: 0,
    };
}

function cloneState(state) {
    return {
        ...state,
        progress: state.progress === null ? null : {...state.progress},
    };
}

class GenericWorkflowController extends Workflow.RuntimeWorkflowController {
    constructor({definition, gateway, scheduler, clock = Date, buildRequest, consentRequired = false}) {
        if (!Surface.isDefinition(definition)) {
            throw new Surface.SurfaceError("definition-invalid", "generic workflow definition is invalid");
        }
        if (typeof buildRequest !== "function") {
            throw new TypeError("Generic workflow request builder is required");
        }
        super({
            clock,
            cloneState,
            gateway,
            initialState,
            labels: {
                clock: "Generic workflow clock",
                disposed: `Generic workflow controller ${definition.id}`,
                failure: _("Workflow failed"),
                gateway: "Generic workflow gateway",
                listener: "Generic workflow listener",
                scheduler: "Generic workflow scheduler",
            },
            pollIntervalMs: POLL_INTERVAL_MS,
            scheduler,
        });
        this._definition = definition;
        this._buildRequest = buildRequest;
        if (consentRequired) {
            this._state.consent = "required";
        }
    }

    get definition() {
        return this._definition;
    }

    get id() {
        return this._definition.id;
    }

    // The surface validates what it is handed, so the projection is the only
    // place that has to know both vocabularies.
    surfaceState() {
        const state = this._state;
        return {
            available: state.available,
            unavailableReason: state.available ? "" : state.availabilityDetail,
            consent: state.consent,
            backgroundEnabled: state.backgroundEnabled,
            phase: SURFACE_PHASES[state.phase],
            progress: state.progress === null ? null : {...state.progress},
            warning: state.phase === "error" ? state.message : "",
            retainedCount: state.retainedCount,
            result: state.result,
        };
    }

    model() {
        return Surface.createSurfaceModel(this._definition, this.surfaceState());
    }

    grantConsent() {
        return this._setConsent("granted");
    }

    revokeConsent() {
        // Revoking mid-run would leave the runtime holding work the user has
        // just withdrawn permission for, so it cancels first.
        if (Surface.ACTIVE_PHASES.has(SURFACE_PHASES[this._state.phase])) {
            this.cancel();
        }
        return this._setConsent("denied");
    }

    _setConsent(next) {
        this._ensureActive();
        if (this._state.consent === "not-required" || this._state.consent === next) {
            return false;
        }
        this._replace({consent: next});
        return true;
    }

    setBackgroundEnabled(enabled) {
        this._ensureActive();
        const next = enabled === true;
        if (!this._definition.supportsBackground || next === this._state.backgroundEnabled) {
            return false;
        }
        this._replace({backgroundEnabled: next});
        return true;
    }

    runNow() {
        this._ensureActive();
        if (!this._runnable()) {
            return false;
        }
        const sequence = this._nextSequence();
        let request;
        try {
            request = this._buildRequest(`xpuwlm-${this._definition.id}-${this._clock.now()}-${sequence}`);
        } catch (error) {
            // `String(error)` prefixes the constructor name, which turns a
            // sentence written for the user into "TypeError: ...".
            return this._fail(error.detail || error.message || String(error));
        }
        this._replace({phase: "submitting", message: _("Submitting…"), progress: null, result: null});
        try {
            this._gateway.submit(request, (error, reply) => this._accepted(sequence, error, reply));
        } catch (error) {
            this._accepted(sequence, error, null);
        }
        return true;
    }

    _runnable() {
        return this._state.available
            && Surface.consentAllowsRun(this._state.consent)
            && !Surface.ACTIVE_PHASES.has(SURFACE_PHASES[this._state.phase]);
    }

    _accepted(sequence, error, acknowledgement) {
        if (!this._current(sequence)) {
            return false;
        }
        if (error) {
            return this._fail(String(error));
        }
        if (acknowledgement?.status !== "accepted" || !acknowledgement.jobId) {
            return this._fail(acknowledgement?.message || _("Runtime rejected the workflow"));
        }
        this._polls = 0;
        this._replace({
            phase: "running",
            jobId: acknowledgement.jobId,
            message: acknowledgement.message,
            progress: {fraction: 0, detail: _("Queued")},
        });
        this._schedulePoll(sequence);
        return true;
    }

    _poll(sequence) {
        if (!this._current(sequence) || this._state.phase !== "running") {
            return false;
        }
        this._polls += 1;
        if (this._polls > MAX_POLLS) {
            return this._fail(_("Runtime did not report a result"));
        }
        try {
            this._gateway.requestResult({
                requestId: `xpuwlm-${this._definition.id}-poll-${this._clock.now()}-${this._polls}`,
                jobId: this._state.jobId,
            }, (error, result) => this._result(sequence, error, result));
        } catch (error) {
            this._result(sequence, error, null);
        }
        return true;
    }

    _result(sequence, error, result) {
        if (!this._current(sequence) || this._state.phase !== "running") {
            return false;
        }
        if (error) {
            this._schedulePoll(sequence);
            return false;
        }
        if (result.state === "running") {
            this._replace({progress: result.progress || this._state.progress, message: result.message});
            this._schedulePoll(sequence);
            return true;
        }
        return this._terminalResult(result);
    }

    _terminalResult(result) {
        this._clearPoll();
        if (result.state !== "succeeded") {
            return this._fail(result.message || format(_("Workflow %s"), result.state));
        }
        let output;
        try {
            output = Result.createWorkloadResult(result.output);
        } catch (parseError) {
            return this._fail(parseError.detail || String(parseError));
        }
        this._replace({
            phase: "complete",
            progress: {fraction: 1, detail: _("Complete")},
            message: "",
            result: output,
            retainedCount: Math.min(this._state.retainedCount + 1, MAX_RETAINED),
        });
        return true;
    }

    cancel() {
        this._ensureActive();
        if (!["submitting", "running"].includes(this._state.phase)) {
            return false;
        }
        const jobId = this._state.jobId;
        this._clearPoll();
        this._replace({phase: "cancelling", message: _("Cancelling…")});
        // The sequence moves before either exit: cancelling while the
        // submission is still in flight has no job to cancel, but the reply is
        // still coming, and accepting it would resurrect the cancelled run.
        const sequence = this._nextSequence();
        if (jobId === "") {
            this._replace({phase: "idle", message: _("Cancelled"), progress: null});
            return true;
        }
        try {
            this._gateway.cancelJob({
                requestId: `xpuwlm-${this._definition.id}-cancel-${this._clock.now()}-${sequence}`,
                jobId,
            }, () => this._cancelled(sequence));
        } catch {
            this._cancelled(sequence);
        }
        return true;
    }

    _cancelled(sequence) {
        if (!this._current(sequence)) {
            return false;
        }
        this._replace({phase: "idle", jobId: "", message: _("Cancelled"), progress: null});
        return true;
    }

    // Retention is the user's, so clearing is explicit and never implicit in a
    // new run: a run replaces the visible result, this forgets the count too.
    clearResults() {
        this._ensureActive();
        if (Surface.ACTIVE_PHASES.has(SURFACE_PHASES[this._state.phase])) {
            return false;
        }
        // A failed run has neither a result nor a retained count, and refusing
        // here left it stuck reporting an old failure with nothing to press.
        if (this._state.result === null
            && this._state.retainedCount === 0
            && this._state.phase !== "error") {
            return false;
        }
        this._replace({result: null, retainedCount: 0, phase: "idle", message: "", progress: null});
        return true;
    }

    dispose() {
        return this._dispose();
    }
}

const ACTIONS = Object.freeze({
    "grant-consent": (controller) => controller.grantConsent(),
    "revoke-consent": (controller) => controller.revokeConsent(),
    "run-now": (controller) => controller.runNow(),
    "toggle-background": (controller, value) => controller.setBackgroundEnabled(value),
    cancel: (controller) => controller.cancel(),
    clear: (controller) => controller.clearResults(),
});

// One registry so the menu has a single action to call and a single list to
// render, and so background registration is owned in one place rather than by
// each controller.
class GenericWorkflowRegistry {
    constructor({background = null} = {}) {
        this._controllers = new Map();
        this._background = background;
        this._unregisterBackground = new Map();
        this._listeners = new Set();
        this._unsubscribes = new Map();
    }

    register(controller) {
        if (!(controller instanceof GenericWorkflowController)) {
            throw new TypeError("A generic workflow controller is required");
        }
        if (this._controllers.has(controller.id)) {
            throw new TypeError(`Generic workflow ${controller.id} is already registered`);
        }
        this._controllers.set(controller.id, controller);
        this._unsubscribes.set(controller.id, controller.subscribe(() => this._publish()));
        this._armBackground(controller);
        return controller;
    }

    _armBackground(controller) {
        const trigger = controller.definition.supportsBackground;
        if (!trigger || this._background === null) {
            return false;
        }
        this._unregisterBackground.set(controller.id, this._background.register({
            id: controller.definition.id,
            trigger: {kind: "periodic", intervalMs: Background.MIN_INTERVAL_MS * 900},
            run: () => {
                if (controller.surfaceState().backgroundEnabled) {
                    controller.runNow();
                }
            },
        }));
        return true;
    }

    controller(id) {
        return this._controllers.get(id) ?? null;
    }

    // Availability is the runtime's answer, not the applet's: a profile the
    // runtime is not serving cannot be run, and the reason it gives is the only
    // thing that tells the user what to do about it. Without this every
    // workflow reads "Unavailable" with nothing after it.
    applyProfiles(profiles, servable) {
        if (typeof servable !== "function") {
            throw new TypeError("A profile serving predicate is required");
        }
        const declared = new Map((Array.isArray(profiles) ? profiles : [])
            .filter((profile) => this._controllers.has(profile?.id))
            .map((profile) => [profile.id, profile]));
        let changed = false;
        for (const [id, controller] of this._controllers) {
            // A profile the snapshot stopped declaring is not merely idle: the
            // catalog no longer contains it, and there is nothing to say why.
            const profile = declared.get(id);
            changed = controller.setAvailability(
                profile !== undefined && servable(profile),
                profile?.detail || "",
            ) || changed;
        }
        return changed;
    }

    models() {
        return [...this._controllers.values()].map((controller) => controller.model());
    }

    dispatch(id, actionId, value) {
        const controller = this._controllers.get(id);
        const action = ACTIONS[actionId];
        if (controller === undefined || action === undefined) {
            return false;
        }
        return action(controller, value) !== false;
    }

    subscribe(listener) {
        if (typeof listener !== "function") {
            throw new TypeError("Generic workflow registry listener is required");
        }
        this._listeners.add(listener);
        return () => this._listeners.delete(listener);
    }

    _publish() {
        for (const listener of this._listeners) {
            try {
                listener();
            } catch {
                // A view subscriber cannot unwind a transport callback.
            }
        }
    }

    dispose() {
        for (const unregister of this._unregisterBackground.values()) {
            unregister();
        }
        for (const unsubscribe of this._unsubscribes.values()) {
            unsubscribe();
        }
        for (const controller of this._controllers.values()) {
            controller.dispose();
        }
        this._unregisterBackground.clear();
        this._unsubscribes.clear();
        this._controllers.clear();
        this._listeners.clear();
        return true;
    }
}

module.exports = {
    ACTIONS,
    GenericWorkflowController,
    GenericWorkflowRegistry,
    MAX_POLLS,
    MAX_RETAINED,
    POLL_INTERVAL_MS,
    SURFACE_PHASES,
    cloneState,
    initialState,
};
