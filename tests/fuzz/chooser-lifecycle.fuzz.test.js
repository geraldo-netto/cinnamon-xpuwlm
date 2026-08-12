"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const Port = require("../../files/cinnamon-xpuwlm@geraldo-netto/lib/event-source-port.js");

function random(seed) {
    let state = seed >>> 0;
    return () => {
        state = ((state * 1664525) + 1013904223) >>> 0;
        return state / 0x100000000;
    };
}

function session() {
    const callbacks = new Map();
    let nextHandle = 1;
    const scheduler = {
        schedule(_delayMs, callback) {
            const handle = nextHandle;
            nextHandle += 1;
            callbacks.set(handle, callback);
            return handle;
        },
        cancel(handle) { return callbacks.delete(handle); },
    };
    const environment = {
        ByteArray: {},
        Gio: {},
        Gtk: {ResponseType: {ACCEPT: 1, OK: 2}},
    };
    const lifecycle = new Port.GtkChooserLifecycle(environment, scheduler);
    const dialogs = [];
    return {
        callbacks,
        dialogs,
        lifecycle,
        open(callback) {
            const chooser = {
                handler: null,
                destroyed: 0,
                connect(_signal, handler) { this.handler = handler; return 1; },
                disconnect() {},
                set_skip_taskbar_hint() {},
                set_skip_pager_hint() {},
                set_modal() {},
                show_all() {},
                present() {},
                hide() {},
                destroy() { this.destroyed += 1; },
            };
            dialogs.push(chooser);
            lifecycle.present(chooser, () => ["selected"], callback);
            return chooser;
        },
    };
}

test("fuzz: chooser response, idle delivery, and teardown remain at-most-once", () => {
    const next = random(0xc105e12);
    for (let iteration = 0; iteration < 500; iteration += 1) {
        const current = session();
        let replies = 0;
        const chooser = current.open(() => { replies += 1; });
        const retainedHandler = chooser.handler;
        const steps = 1 + Math.floor(next() * 20);
        for (let step = 0; step < steps; step += 1) {
            const operation = Math.floor(next() * 4);
            if (operation === 0) {
                retainedHandler(chooser, Math.floor(next() * 8) - 2);
            } else if (operation === 1) {
                const entry = current.callbacks.entries().next().value;
                if (entry) {
                    current.callbacks.delete(entry[0]);
                    entry[1]();
                }
            } else if (operation === 2) {
                current.lifecycle.dispose();
            } else {
                assert.doesNotThrow(() => retainedHandler(chooser, null));
            }
            assert.ok(replies <= 1, `iteration ${iteration}, step ${step}`);
            assert.ok(chooser.destroyed <= 1, `iteration ${iteration}, step ${step}`);
        }
        current.lifecycle.dispose();
        assert.ok(replies <= 1, `iteration ${iteration}`);
        assert.equal(chooser.destroyed, 1, `iteration ${iteration}`);
    }
});
