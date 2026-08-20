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

test("a working runtime reads as online, and says what it is doing", () => {
    const model = PanelStatus.panelModel(state());

    assert.equal(model.status, "online");
    assert.equal(model.accessibleName, "XPU Workload Manager, online: 1 running");
    assert.equal(model.tooltip, "XPU Workload Manager — online, 1 running");
});

test("the model carries no panel text, because the panel draws none", () => {
    // The icon is the status. A word beside it in the tray repeats the shape
    // and the colour, in a strip where every pixel is contested.
    for (const model of [
        PanelStatus.panelModel(state()),
        PanelStatus.panelModel(state({attention: 2})),
        PanelStatus.panelModel(state({runtime: "absent"})),
        PanelStatus.panelModel(state({available: false})),
    ]) {
        assert.equal(Object.hasOwn(model, "label"), false);
    }
});

test("the panel does not report the accelerator's busy percentage", () => {
    // A one-shot busy figure says whether the device was busy at the instant
    // the snapshot was written, which is not what anyone is asking. The
    // client's Health page carries the percentile over a minute instead.
    const model = PanelStatus.panelModel(state());

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
    assert.match(model.accessibleName, /The runtime is not running/u);
});

test("a running runtime with no usable device is detected, not offline", () => {
    // Different facts: nothing to run on, versus nothing to ask.
    const model = PanelStatus.panelModel(state({available: false, reason: "no driver"}));

    assert.equal(model.status, "detected");
    assert.equal(model.tooltip, "XPU Workload Manager — no device available: no driver");
    assert.equal(model.accessibleName, "XPU Workload Manager, no device available: no driver");
});

test("a detected runtime that publishes no reason is not called unavailable", () => {
    // The offline wording fell back through the runtime label, so a connected
    // runtime with nothing to run on announced itself as "unavailable: Online".
    const model = PanelStatus.panelModel(state({available: false}));

    assert.equal(model.tooltip, "XPU Workload Manager — no device available");
    assert.equal(model.accessibleName, "XPU Workload Manager, no device available");
    assert.doesNotMatch(model.accessibleName, /unavailable|Online/u);
});

test("the detected wording prefers the detail over the coarser reason", () => {
    const model = PanelStatus.detectedModel(state({
        available: false,
        detail: "vulkan loader missing",
        reason: "no driver",
    }));

    assert.equal(model.accessibleName, "XPU Workload Manager, no device available: vulkan loader missing");
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
    assert.equal(lines[4].value, "1 item needs review");
});

test("nothing to review is one word, not a sentence repeating the label", () => {
    const lines = PanelStatus.popupLines(state({attention: 0}));

    assert.equal(lines[4].label, "Needs review");
    assert.equal(lines[4].value, "Nothing");
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

// A runtime-state-path that disagrees with the service's own reports the
// runtime as not running, so the path is the one thing that tells a
// misconfigured panel from a stopped service.
test("the popup names the file the panel could not read", () => {
    const lines = PanelStatus.popupLines(state({
        runtime: "absent",
        detail: "The runtime is not running",
        source: "/home/tester/.local/state/xpu-workload-manager/state.json",
    }));

    assert.deepEqual(lines.at(-1), {
        label: "Snapshot",
        value: "/home/tester/.local/state/xpu-workload-manager/state.json",
    });
    // A read that never got as far as a path says nothing rather than naming
    // an empty one, and a connected runtime does not need telling which file
    // it came from.
    assert.equal(PanelStatus.popupLines(state({runtime: "absent"})).length, 2);
    assert.equal(
        PanelStatus.popupLines(state({source: "/tmp/state.json"}))
            .some((line) => line.label === "Snapshot"),
        false,
    );
});

// The applet builds its popup items once, from this bound. A state that
// produced more lines than the pool would have the extra ones computed,
// formatted, and then dropped without a word.
test("no state produces more popup lines than the popup has room for", () => {
    const states = [
        state(),
        state({runtime: "absent", detail: ""}),
        state({runtime: "stale", detail: "The runtime stopped publishing"}),
        state({runtime: "malformed"}),
        state({runtime: "unreadable", source: "/home/tester/state.json"}),
        state({available: false, backend: null}),
        state({attention: 3, queued: 9, running: 2}),
    ];

    for (const candidate of states) {
        assert.ok(
            PanelStatus.popupLines(candidate).length <= PanelStatus.MAX_POPUP_LINES,
            `${candidate.runtime} produced more lines than the popup can show`,
        );
    }
});

// The runtime holds every workload from its own policy store, so the panel
// reads the hold rather than guessing it from an empty queue. This is the
// fifth status shape, and the icon for it has always shipped.
test("a held runtime draws as paused and says so in words", () => {
    const model = PanelStatus.panelModel(state({paused: true, queued: 0, running: 0}));

    assert.equal(model.status, "paused");
    assert.equal(model.tooltip, "XPU Workload Manager — paused");
    assert.equal(model.accessibleName, "XPU Workload Manager, paused");
});

test("a hold carries the work waiting behind it", () => {
    const model = PanelStatus.panelModel(state({paused: true, queued: 4}));

    assert.equal(model.tooltip, "XPU Workload Manager — paused, 4 queued");
    assert.equal(PanelStatus.pausedText({queued: 1}), "paused, 1 queued");
});

test("something waiting for a person outranks a hold that person chose", () => {
    const model = PanelStatus.panelModel(state({paused: true, attention: 2}));

    assert.equal(model.status, "attention");
});

test("a held runtime with no device still reads as detected, not paused", () => {
    const model = PanelStatus.panelModel(state({paused: true, available: false}));

    assert.equal(model.status, "detected");
});

test("the popup reports the hold on the runtime line, which is still connected", () => {
    const [runtime] = PanelStatus.popupLines(state({paused: true}));

    assert.deepEqual(runtime, {label: "Runtime", value: "Paused"});
    assert.equal(PanelStatus.popupLines(state()).at(0).value, "Online");
});

test("a runtime that is not connected is never reported as paused", () => {
    const [runtime] = PanelStatus.popupLines({
        ...state(), runtime: "stale", paused: true,
    });

    assert.equal(runtime.value, "Runtime stale");
});

// What the deleted translation port did that a plain string cannot: a template
// keeps its placeholders when a value is missing rather than printing
// "undefined", and English plurals are chosen rather than guessed.
test("a template with no value for a placeholder keeps the placeholder", () => {
    assert.equal(PanelStatus.format("%d queued"), "%d queued");
    assert.equal(PanelStatus.format("%s: %s", "Runtime"), "Runtime: %s");
    assert.equal(PanelStatus.format("%s", "Online", "ignored"), "Online");
    assert.equal(PanelStatus.format("nothing to fill"), "nothing to fill");
});

test("plural selection is by count, not by whether the count is truthy", () => {
    assert.equal(PanelStatus.plural(1, "item", "items"), "item");
    assert.equal(PanelStatus.plural(0, "item", "items"), "items");
    assert.equal(PanelStatus.plural(2, "item", "items"), "items");
});
