"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const Placer = require(
    "../../files/cinnamon-xpuwlm@geraldo-netto/lib/settings-window-placer.js",
);
const WindowPlacement = require(
    "../../files/cinnamon-xpuwlm@geraldo-netto/lib/window-placement.js",
);

// Every source the placer arms, and every source it later asks to remove. A
// real GLib warns — naming an id it does not know — when asked to remove a
// source that has already fired and retired itself.
function recordingMainloop({immediate = false} = {}) {
    let nextId = 1;
    const live = new Set();
    const removed = [];
    const pending = [];
    const schedule = (callback) => {
        const id = nextId;
        nextId += 1;
        live.add(id);
        if (immediate) {
            live.delete(id);
            callback();
        } else {
            pending.push(() => {
                live.delete(id);
                callback();
            });
        }
        return id;
    };
    return {
        removed,
        pending,
        idle_add: schedule,
        timeout_add: (_milliseconds, callback) => schedule(callback),
        timeout_add_seconds: (_seconds, callback) => schedule(callback),
        source_remove(id) {
            removed.push(id);
            if (!live.has(id)) {
                throw new Error(`Source ID ${id} was not found when attempting to remove it`);
            }
            live.delete(id);
            return true;
        },
    };
}

function display() {
    return {
        handlers: new Map(),
        nextHandler: 1,
        connect(signal, callback) {
            const id = this.nextHandler;
            this.nextHandler += 1;
            this.handlers.set(id, {signal, callback});
            return id;
        },
        disconnect(id) {
            this.handlers.delete(id);
        },
    };
}

function placer() {
    return Placer.createSettingsWindowPlacer({
        logger: {warn: () => {}},
        placement: WindowPlacement,
    });
}

test("a placer needs the placement rules it is asked to apply", () => {
    assert.throws(() => Placer.createSettingsWindowPlacer(), TypeError);
    assert.throws(() => Placer.createSettingsWindowPlacer({placement: {}}), TypeError);
});

test("a display that cannot be listened to is refused rather than half-armed", () => {
    assert.equal(placer().awaitWindow(null, recordingMainloop()), false);
});

// A mainloop double that runs its callback before returning the id used to
// leave that id in the placer's set for ever, so cancelling asked GLib to
// remove a source it had already retired.
test("a source that has already fired is never removed again", () => {
    const mainloop = recordingMainloop({immediate: true});
    const target = placer();

    assert.equal(target.awaitWindow(display(), mainloop), true);
    assert.equal(target.cancel(), true);

    assert.deepEqual(mainloop.removed, []);
});

test("a source still waiting is removed when the placer is cancelled", () => {
    const mainloop = recordingMainloop();
    const target = placer();

    target.awaitWindow(display(), mainloop);
    target.cancel();

    assert.equal(mainloop.removed.length, 1);
});

test("a cancelled placer arms nothing for a window that arrives anyway", () => {
    // `cancel` drops the display and the mainloop, which are the session's and
    // not the applet's; an emission already in flight must find nothing armed.
    const mainloop = recordingMainloop();
    const desktop = display();
    const target = placer();
    target.awaitWindow(desktop, mainloop);
    const [{callback}] = [...desktop.handlers.values()];
    target.cancel();
    const armed = mainloop.pending.length;

    callback(desktop, {get_wm_class: () => "Xlet-settings.py"});

    assert.equal(mainloop.pending.length, armed);
});

test("the display handler comes off when the placer is cancelled", () => {
    const mainloop = recordingMainloop();
    const desktop = display();
    const target = placer();

    target.awaitWindow(desktop, mainloop);
    assert.equal(desktop.handlers.size, 1);
    target.cancel();

    assert.equal(desktop.handlers.size, 0);
});

// The settling window this placer is centring, as far as it uses one.
function settlingWindow() {
    return {
        handlers: new Map(),
        nextHandler: 1,
        moved: [],
        connect(signal, callback) {
            const id = this.nextHandler;
            this.nextHandler += 1;
            this.handlers.set(id, {signal, callback});
            return id;
        },
        disconnect(id) {
            this.handlers.delete(id);
        },
        get_wm_class: () => "Xlet-settings.py",
        get_frame_rect: () => ({x: 90, y: 90, width: 800, height: 600}),
        get_work_area_current_monitor: () => ({x: 0, y: 0, width: 1920, height: 1080}),
        allows_move: () => true,
        move_frame(userOperation, x, y) {
            this.moved.push({userOperation, x, y});
        },
    };
}

function armedPlacer(mainloop) {
    const desktop = display();
    const target = placer();
    target.awaitWindow(desktop, mainloop);
    const [{callback}] = [...desktop.handlers.values()];
    return {desktop, target, open: (window) => callback(desktop, window)};
}

test("a window that settles is centred from an idle turn, not from the signal", () => {
    const mainloop = recordingMainloop();
    const window = settlingWindow();
    const {target, open} = armedPlacer(mainloop);

    open(window);
    assert.deepEqual(window.moved, [], "a move made inside the signal is discarded");

    for (const run of mainloop.pending.splice(0)) {
        run();
    }

    assert.deepEqual(window.moved, [{userOperation: true, x: 560, y: 240}]);
    target.cancel();
});

// The window's own position-changed can arrive after the placer was cancelled
// — the applet was removed while the settings window was still settling — and
// there is no mainloop to arm a correction on by then.
test("a correction asked for after cancellation arms nothing", () => {
    const mainloop = recordingMainloop();
    const window = settlingWindow();
    const {target, open} = armedPlacer(mainloop);
    open(window);
    const [{callback: onPositionChanged}] = [...window.handlers.values()];
    mainloop.pending.splice(0);
    target.cancel();

    onPositionChanged(window);

    assert.deepEqual(mainloop.pending, []);
});
