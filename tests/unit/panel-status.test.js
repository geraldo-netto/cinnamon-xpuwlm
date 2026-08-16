"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const PanelStatus = require("../../files/cinnamon-xpuwlm@geraldo-netto/lib/panel-status.js");
const Reader = require("../../files/cinnamon-xpuwlm@geraldo-netto/lib/snapshot-reader.js");

function state(overrides = {}) {
    return {
        ...Reader.EMPTY_STATE,
        runtime: "connected",
        available: true,
        backend: "gpu",
        queued: 2,
        running: 1,
        ...overrides,
    };
}

test("a working runtime reads as online, naming the backend and its work", () => {
    const model = PanelStatus.panelModel(state());

    assert.equal(model.status, "online");
    assert.equal(model.label, "GPU 1 running");
    assert.equal(model.accessibleName, "XPU Workload Manager, online: 1 running");
});

test("the panel does not report the accelerator's busy percentage", () => {
    // A one-shot busy figure says whether the device was busy at the instant
    // the snapshot was written, which is not what anyone is asking. The
    // client's Health page carries the percentile over a minute instead.
    const model = PanelStatus.panelModel(state());

    assert.doesNotMatch(model.label, /%/u);
    assert.doesNotMatch(model.tooltip, /%/u);
    assert.doesNotMatch(model.accessibleName, /%/u);
    assert.equal(Object.hasOwn(PanelStatus, "formatLoad"), false);
});

test("an idle runtime says so rather than showing a zero", () => {
    assert.equal(PanelStatus.workText(state({queued: 0, running: 0})), "Ready");
    assert.equal(PanelStatus.workText(state({queued: 3, running: 0})), "3 queued");
    assert.equal(PanelStatus.workText(state({queued: 3, running: 2})), "2 running");
});

test("anything needing review outranks the load in the label", () => {
    const model = PanelStatus.panelModel(state({attention: 3}));

    assert.equal(model.status, "attention");
    assert.equal(model.label, "GPU 3 items need review");
    assert.match(model.tooltip, /3 items need review/u);
});

test("one item needing review is singular", () => {
    assert.equal(PanelStatus.attentionText(1), "1 item needs review");
    assert.equal(PanelStatus.attentionText(2), "2 items need review");
});

test("a runtime that is not publishing is unavailable, and says why", () => {
    const model = PanelStatus.panelModel(state({
        runtime: "absent",
        detail: "The runtime is not running",
        available: false,
    }));

    assert.equal(model.status, "unavailable");
    assert.equal(model.label, "Accel Offline");
    assert.match(model.accessibleName, /The runtime is not running/u);
});

test("a running runtime with no usable device is detected, not offline", () => {
    // Different facts: nothing to run on, versus nothing to ask.
    const model = PanelStatus.panelModel(state({available: false, reason: "no driver"}));

    assert.equal(model.status, "detected");
    assert.equal(model.label, "Accel Detected");
});

test("an unknown backend still gets a label rather than an empty one", () => {
    assert.equal(PanelStatus.backendLabel(state({backend: null})), "Accel");
    assert.equal(PanelStatus.backendLabel(state({backend: "tpu"})), "TPU");
});

test("the popup lists what is running when the runtime answers", () => {
    const lines = PanelStatus.popupLines(state({attention: 1}));

    assert.deepEqual(lines.map((line) => line.label), [
        "Runtime", "Accelerator", "Queued", "Running", "Needs review",
    ]);
    assert.equal(lines[1].value, "GPU");
    assert.equal(lines[2].value, "2");
});

test("the popup says what is wrong when the runtime does not answer", () => {
    const lines = PanelStatus.popupLines(state({
        runtime: "stale",
        detail: "The runtime stopped publishing",
    }));

    assert.deepEqual(lines.map((line) => line.label), ["Runtime", "Detail"]);
    assert.equal(lines[0].value, "Runtime stale");
    assert.equal(lines[1].value, "The runtime stopped publishing");
});

test("an icon name is only ever one the payload ships", () => {
    for (const status of PanelStatus.PANEL_STATUSES) {
        assert.equal(PanelStatus.panelIconName(status), `xpuwlm-status-${status}-symbolic`);
    }
    assert.equal(PanelStatus.panelIconName("invented"), "xpuwlm-status-unavailable-symbolic");
});

test("a runtime word the helper does not know still reads as unreadable", () => {
    assert.equal(PanelStatus.runtimeLabel(state({runtime: "invented"})), "Runtime unreadable");
    assert.equal(PanelStatus.runtimeLabel(state({runtime: "malformed"})), "Runtime malformed");
});

test("an offline panel falls back through detail, reason, then the runtime word", () => {
    assert.match(
        PanelStatus.offlineModel(state({runtime: "absent", detail: "", reason: "no driver"})).tooltip,
        /no driver/u,
    );
    assert.match(
        PanelStatus.offlineModel(state({runtime: "unreadable", detail: "", reason: ""})).tooltip,
        /Runtime unreadable/u,
    );
});

test("the popup names the missing device rather than nothing at all", () => {
    const lines = PanelStatus.popupLines(state({available: false}));

    assert.equal(lines[1].value, "No device available");
});

test("a popup line for a runtime with no detail still says something", () => {
    const lines = PanelStatus.popupLines(state({runtime: "absent", detail: ""}));

    assert.equal(lines[1].value, "No further detail");
});
