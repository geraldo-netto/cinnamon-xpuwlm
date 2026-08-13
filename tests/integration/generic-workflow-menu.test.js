"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const Menu = require("../../files/cinnamon-xpuwlm@geraldo-netto/lib/menu-view.js");
const Layout = require("../../files/cinnamon-xpuwlm@geraldo-netto/lib/layout.js");
const Surface = require(
    "../../files/cinnamon-xpuwlm@geraldo-netto/lib/generic-workflow-surface.js"
);
const {
    FakeButton, FakeMenu, createAtk, createSt, findActors,
} = require("../helpers/fakes.js");
const {definition, state, validResult} = require("../helpers/generic-workflow-fixture.js");

function harness(wrapText = false) {
    const calls = [];
    const actions = {};
    for (const name of [
        "selectTab", "toggleProfile", "changeWeight", "pauseAll", "resumeAll",
        "refresh", "openSettings", "acknowledgeCatalogChanges", "submitJob",
    ]) {
        actions[name] = () => {};
    }
    actions.dispatchGenericWorkflow = (...args) => calls.push(args);
    const menu = new FakeMenu();
    const view = new Menu.MenuView({
        St: createSt(), Clutter: {ActorAlign: {CENTER: "center"}}, Atk: createAtk(), menu, actions,
        layout: {...Layout.defaultLayout(), wrapText},
    });
    return {calls, view};
}

function clear(view) {
    for (const child of view._body.get_children()) {
        child.destroy();
    }
}

function labels(view) {
    return findActors(view._body, (actor) => typeof actor.get_text === "function")
        .map((actor) => actor.get_text());
}

test("generic Cinnamon surface renders consent, progress, evidence, retention, and controls", () => {
    const {calls, view} = harness();
    const model = Surface.createSurfaceModel(definition(), state({
        backgroundEnabled: true,
        phase: "complete",
        progress: {fraction: 1, detail: "done"},
        warning: "Verify confidence before acting",
        retainedCount: 2,
        result: validResult("forecast"),
    }));
    assert.equal(view._renderGenericWorkflowSurface(model), true);
    const text = labels(view).join("\n");
    for (const expected of [
        "Queue health", "Consent", "Consent granted", "Review result",
        "Review only", "Offset 1 requests", "Retention", "2 retained results",
        "Verify confidence before acting",
    ]) {
        assert.match(text, new RegExp(expected, "u"));
    }
    const buttons = findActors(view._body, (actor) => actor instanceof FakeButton);
    const background = buttons.find(
        (button) => button.xpuwlmIdentity === "generic-queue-health-toggle-background",
    );
    assert.equal(background.accessibleRole, "toggle-button");
    assert.equal(background.accessibleStates.has("checked"), true);
    background.click();
    assert.deepEqual(calls, [["queue-health", "toggle-background", false]]);
});

test("generic surface keeps unavailable cause above consent and disables execution", () => {
    const {view} = harness();
    const model = Surface.createSurfaceModel(definition(), state({
        available: false, unavailableReason: "GPU provider missing", consent: "required",
    }));
    view._renderGenericWorkflowSurface(model);
    const text = labels(view);
    assert.equal(text.indexOf("Unavailable") < text.indexOf("Consent"), true);
    assert.equal(text.includes("GPU provider missing"), true);
    const run = findActors(
        view._body, (actor) => actor.xpuwlmIdentity === "generic-queue-health-run-now",
    )[0];
    assert.equal(run.reactive, false);
    assert.equal(run.can_focus, false);
});

test("generic active surface exposes one cancellable action and handles empty input", () => {
    const {calls, view} = harness();
    assert.equal(view._renderGenericWorkflowSurface(null), false);
    const model = Surface.createSurfaceModel(definition(), state({
        phase: "running", progress: {fraction: 0.5, detail: "inference"},
    }));
    view._renderGenericWorkflowSurface(model);
    const cancel = findActors(
        view._body, (actor) => actor.xpuwlmIdentity === "generic-queue-health-cancel",
    )[0];
    cancel.click();
    assert.deepEqual(calls, [["queue-health", "cancel", true]]);
});

test("generic renderer branch contract preserves every visible and hidden surface", () => {
    const {view} = harness(true);
    const childCount = () => view._body.get_children().length;
    const text = () => labels(view).join("\n");

    for (const [method, hidden] of [
        ["_renderGenericUnavailable", {visible: false, detail: ""}],
        ["_renderGenericConsent", {visible: false, purpose: "", state: "not-required"}],
        ["_renderGenericProgress", {visible: false, text: ""}],
    ]) {
        assert.equal(view[method](hidden), false);
        assert.equal(childCount(), 0);
    }
    assert.equal(view._renderGenericWarning(""), false);
    assert.equal(view._renderGenericResult(null, true), false);
    assert.equal(childCount(), 0);

    assert.equal(view._renderGenericUnavailable({visible: true, detail: ""}), true);
    assert.match(text(), /Required service, source, or hardware is unavailable/u);
    assert.equal(view._body.get_children()[1].clutter_text.line_wrap, true);
    clear(view);

    for (const [stateName, expected] of [
        ["required", "Consent required"],
        ["granted", "Consent granted"],
        ["denied", "Consent denied"],
        ["not-required", "Consent not required"],
    ]) {
        assert.equal(view._renderGenericConsent({
            visible: true, purpose: "Purpose", state: stateName,
        }), true);
        assert.match(text(), new RegExp(expected, "u"));
        assert.match(text(), /Purpose/u);
        assert.equal(view._body.get_children()[1].clutter_text.line_wrap, true);
        clear(view);
    }

    assert.equal(view._renderGenericProgress({visible: true, text: "51% · work"}), true);
    assert.deepEqual(labels(view), ["Progress", "51% · work"]);
    clear(view);

    assert.equal(view._renderGenericWarning("Warning text"), true);
    const warning = view._body.get_children()[0];
    assert.equal(warning.get_text(), "Warning text");
    assert.equal(warning.styleClasses.has("xpuwlm-control-error"), true);
    assert.equal(warning.clutter_text.line_wrap, true);
    clear(view);

    const result = {kind: "labels", operationId: "run-7", rows: [
        {title: "first", detail: "0.900"},
    ], omitted: 0};
    assert.equal(view._renderGenericResult(result, false), true);
    assert.deepEqual(labels(view), ["Result", "labels · run-7", "first", "0.900"]);
    clear(view);
    assert.equal(view._renderGenericResult({...result, omitted: 1}, true), true);
    assert.deepEqual(labels(view), [
        "Review result", "labels · run-7",
        "Review only: no system action is performed from this result",
        "first", "0.900", "1 additional evidence row omitted",
    ]);
    assert.equal(view._body.get_children()[1].clutter_text.line_wrap, true);
    assert.equal(view._body.get_children()[3].clutter_text.line_wrap, true);
    clear(view);

    assert.equal(view._renderGenericRetention({text: "Delete after review", count: 1}), true);
    assert.deepEqual(labels(view), ["Retention", "1 retained result", "Delete after review"]);
    assert.equal(view._body.get_children()[1].clutter_text.line_wrap, true);
});

test("generic action renderer preserves identity, emphasis, toggle state, and dispatch values", () => {
    const {calls, view} = harness();
    const model = {
        id: "worker",
        actions: [
            {id: "run-now", label: "Run now", enabled: true, pressed: false},
            {id: "cancel", label: "Cancel", enabled: true, pressed: false},
            {id: "toggle-background", label: "Background", enabled: true, pressed: false},
            {id: "clear", label: "Clear", enabled: false, pressed: false},
        ],
    };
    assert.equal(view._renderGenericActions(model), true);
    const buttons = findActors(view._body, (actor) => actor instanceof FakeButton);
    assert.deepEqual(buttons.map((button) => button.xpuwlmIdentity), [
        "generic-worker-run-now", "generic-worker-cancel",
        "generic-worker-toggle-background", "generic-worker-clear",
    ]);
    assert.equal(buttons[0].styleClasses.has("xpuwlm-primary-button"), true);
    assert.equal(buttons[1].styleClasses.has("xpuwlm-primary-button"), true);
    assert.equal(buttons[2].styleClasses.has("xpuwlm-secondary-button"), true);
    assert.equal(buttons[2].accessibleRole, "toggle-button");
    assert.equal(buttons[2].accessibleStates.has("checked"), false);
    assert.equal(buttons[3].reactive, false);
    for (const button of buttons.slice(0, 3)) {
        button.click();
    }
    assert.deepEqual(calls, [
        ["worker", "run-now", true],
        ["worker", "cancel", true],
        ["worker", "toggle-background", true],
    ]);
    clear(view);
    assert.equal(view._renderGenericActions({id: "empty", actions: []}), true);
    assert.equal(view._body.get_children().length, 1);
    assert.equal(view._body.get_children()[0].get_children().length, 0);
});
