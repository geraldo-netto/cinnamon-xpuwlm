"use strict";

// The waiting half of "Configure…": signals and mainloop sources, owned.
//
// `lib/window-placement.js` holds the rules — which window is the settings
// window, and where it should sit — deliberately free of Muffin and of the
// mainloop. This is the choreography those rules need: connect to the
// display's `window-created`, give up after a bounded wait, and keep the
// window centred while the window manager is still settling it.
//
// It lives beside the applet rather than inside it because every one of those
// steps outlives the turn that started it. `global.display` is the session's,
// not the applet's, so a handler left on it runs for the rest of the session;
// a mainloop source armed here fires against an applet that may already have
// been removed from the panel. One owner that can be cancelled is the whole
// reason this file exists: the applet cancels it from teardown, and nothing
// survives the applet that created it.
//
// The rules arrive as a port rather than an import: Cinnamon resolves a
// nested CommonJS import from the applet root, so a module under lib/ that
// imports another needs a root shim shipped beside it. The applet already
// holds both, and handing the rules in keeps the payload one file smaller.

// Every mainloop method this placer calls, and the display's. Named as a set
// rather than checked one at a time: the refusal below exists so a caller
// without a working mainloop cannot leave a handler on the session's display,
// and a guard that names one of the four methods only prevents the failures
// that happen to arrive through that one. The other three are reached from
// inside a signal emission or from teardown, which is where an unchecked
// throw is hardest to attribute and does the most damage.
const MAINLOOP_PORT = Object.freeze([
    "idle_add",
    "source_remove",
    "timeout_add",
    "timeout_add_seconds",
]);
const DISPLAY_PORT = Object.freeze(["connect", "disconnect"]);
// And the rules, for the same reason. `placeWindow` was the only member
// checked, while `isSettingsWindow` is called from inside a `window-created`
// emission and the two durations are read while sources are being armed — so
// a port missing any of the other three refused nothing and threw where an
// unchecked throw is hardest to attribute.
const PLACEMENT_PORT = Object.freeze(["isSettingsWindow", "placeWindow"]);
const PLACEMENT_DURATIONS = Object.freeze(["SETTINGS_WAIT_SECONDS", "SETTLE_MS"]);

function provides(port, methods) {
    return Boolean(port) && methods.every((method) => typeof port[method] === "function");
}

function publishes(port, numbers) {
    return numbers.every((name) => Number.isFinite(port[name]));
}

function createSettingsWindowPlacer(options = {}) {
    const logger = options.logger;
    const placement = options.placement;
    if (!provides(placement, PLACEMENT_PORT) || !publishes(placement, PLACEMENT_DURATIONS)) {
        throw new TypeError("A settings-window placer needs the placement rules");
    }
    // Every id the placer armed and has not yet seen fire. A source that fires
    // forgets itself first, so cancelling never removes a source GLib has
    // already retired — which it reports as a warning naming an unknown id.
    const sources = new Set();
    let display = null;
    let mainloop = null;
    let displayHandler = 0;
    let settling = null;

    // The id is not known until `schedule` returns, and a scheduler that runs
    // its callback before returning — a mainloop double, a reentrant source —
    // reaches the deletion while the id is still 0 and then has the real id
    // added behind it, which nothing would ever remove. So what the callback
    // records is that it has fired; the id is only remembered while the source
    // is still live.
    function arm(schedule, run) {
        const source = {fired: false, id: 0};
        source.id = schedule(() => {
            source.fired = true;
            sources.delete(source.id);
            run();
            return false;
        });
        if (!source.fired) {
            sources.add(source.id);
        }
        return source.id;
    }

    // No capability check here or in `cancel`: the ports were taken whole or
    // refused whole in `awaitWindow`, and `display` and `mainloop` are set
    // nowhere else. Re-asking would be a second, weaker copy of that rule.
    // Forgotten before it is dropped, for the same reason `cancel` isolates
    // its releases: a `disconnect` that throws used to leave the handler id
    // still recorded, so the placer went on believing it was listening on a
    // display it had already stopped listening to.
    function stopListening() {
        const handler = displayHandler;
        displayHandler = 0;
        if (handler && display) {
            display.disconnect(handler);
        }
    }

    // A window the person moves after it has settled is theirs, so the
    // correction handler comes off as soon as the settling window closes.
    function releaseWindow() {
        const target = settling;
        settling = null;
        if (target && target.handler && typeof target.window.disconnect === "function") {
            target.window.disconnect(target.handler);
        }
    }

    function place(window) {
        try {
            placement.placeWindow(window);
        } catch (error) {
            logger?.warn(`could not place the settings window: ${error}`);
        }
    }

    // Always from an idle turn, never from inside the signal: a move made
    // while the window manager is still handling its own placement is accepted
    // and then discarded — measured, with the window reporting the corner it
    // started in and no second position change at all.
    // A correction can be asked for by a window signal that arrives after the
    // placer was cancelled, and there is no mainloop to arm then.
    function placeWhenIdle(window) {
        if (!mainloop) {
            return;
        }
        arm((callback) => mainloop.idle_add(callback), () => place(window));
    }

    // A window is created before the window manager has placed it, and the
    // placement lands either side of the first idle turn depending on how long
    // the settings process took to start — measured both ways.
    function settle(window) {
        settling = {window, handler: 0};
        if (typeof window.connect === "function") {
            settling.handler = window.connect("position-changed", () => placeWhenIdle(window));
        }
        placeWhenIdle(window);
        arm(
            (callback) => mainloop.timeout_add(placement.SETTLE_MS, callback),
            releaseWindow,
        );
    }

    // A cancelled placer holds no mainloop, and a `window-created` emission
    // already in flight when it was cancelled still reaches this.
    function onWindowCreated(_display, window) {
        if (!mainloop || !placement.isSettingsWindow(window)) {
            return;
        }
        stopListening();
        settle(window);
    }

    // The collaborators go with the sources. The display it holds is
    // `global.display`, which outlives every applet, so a placer that kept it
    // after teardown kept the session's display and Cinnamon's mainloop
    // reachable for as long as the applet object survived — and read as though
    // it were still armed.
    // Every release is asked for on its own. `cancel` is the whole reason this
    // module exists — it is what stops a handler on the session's display and a
    // mainloop source from outliving the applet — and as a run of bare
    // statements it gave back everything up to the first throw and stranded the
    // rest. A `disconnect` naming a handler the display has already dropped, or
    // one `source_remove` naming an id GLib has retired, therefore kept every
    // later source armed and left `global.display` and Cinnamon's mainloop
    // reachable through this closure: the exact leak the module was written to
    // prevent, reached through the function written to prevent it.
    function release(subject, run) {
        try {
            run();
        } catch (error) {
            logger?.warn(`could not release ${subject}: ${error}`);
        }
    }

    function cancel() {
        release("the display handler", stopListening);
        release("the settling window", releaseWindow);
        if (mainloop) {
            const armed = mainloop;
            for (const id of sources) {
                release(`the mainloop source ${id}`, () => armed.source_remove(id));
            }
        }
        sources.clear();
        display = null;
        mainloop = null;
        return true;
    }

    return {
        // Waits for the window Cinnamon is about to spawn, centres it once it
        // has settled, and stops waiting either way — a settings window that
        // never appears must not leave a handler listening for the life of the
        // session.
        awaitWindow(targetDisplay, targetMainloop) {
            // Both ports whole, before either is used. Only the display used
            // to be checked, and the mainloop is reached one statement after
            // the `window-created` handler is connected — so a caller without
            // one threw with the handler already on the session's display and
            // its id not yet recorded anywhere, leaving a handler nothing could
            // ever take off. That is the exact leak this module exists to
            // prevent, so it refuses before it connects — and it asks for every
            // method it will call, not just the first one it reaches.
            if (!provides(targetDisplay, DISPLAY_PORT)
                    || !provides(targetMainloop, MAINLOOP_PORT)) {
                return false;
            }
            cancel();
            display = targetDisplay;
            mainloop = targetMainloop;
            displayHandler = display.connect("window-created", onWindowCreated);
            arm(
                (callback) => mainloop.timeout_add_seconds(
                    placement.SETTINGS_WAIT_SECONDS,
                    callback,
                ),
                stopListening,
            );
            return true;
        },
        cancel,
    };
}

module.exports = {
    createSettingsWindowPlacer,
};
