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
        load: 42,
        queued: 2,
        running: 1,
        ...overrides,
    };
}

test("a working accelerator reads as online, with its backend and load", () => {
    const model = PanelStatus.panelModel(state());

    assert.equal(model.status, "online");
    assert.equal(model.label, "GPU 42%");
    assert.equal(model.accessibleName, "XPU Workload Manager, online: 42% load");
});

test("anything needing review outranks the load in the label", () => {
    const model = PanelStatus.panelModel(state({attention: 3}));

    assert.equal(model.status, "attention");
    assert.equal(model.label, "GPU 42% · 3 items need review");
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

test("an unmeasured load is a dash, never a zero", () => {
    assert.equal(PanelStatus.formatLoad(null), "—");
    assert.equal(PanelStatus.formatLoad(0), "0%");
    assert.equal(PanelStatus.formatLoad(42.4), "42%");
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
    assert.equal(lines[1].value, "GPU at 42%");
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

test("the popup names the missing device rather than an empty load", () => {
    const lines = PanelStatus.popupLines(state({available: false, load: null}));

    assert.equal(lines[1].value, "No device available");
});

test("a popup line for a runtime with no detail still says something", () => {
    const lines = PanelStatus.popupLines(state({runtime: "absent", detail: ""}));

    assert.equal(lines[1].value, "No further detail");
});
