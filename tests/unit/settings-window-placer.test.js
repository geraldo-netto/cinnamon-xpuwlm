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
