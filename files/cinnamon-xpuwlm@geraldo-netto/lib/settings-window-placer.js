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

function createSettingsWindowPlacer(options = {}) {
    const logger = options.logger;
    const placement = options.placement;
    if (!placement || typeof placement.placeWindow !== "function") {
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

    function stopListening() {
        if (displayHandler && display && typeof display.disconnect === "function") {
            display.disconnect(displayHandler);
        }
        displayHandler = 0;
    }

    // A window the person moves after it has settled is theirs, so the
    // correction handler comes off as soon as the settling window closes.
    function releaseWindow() {
        if (settling && settling.handler && typeof settling.window.disconnect === "function") {
            settling.window.disconnect(settling.handler);
        }
        settling = null;
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
    function cancel() {
        stopListening();
        releaseWindow();
        if (mainloop && typeof mainloop.source_remove === "function") {
            for (const id of sources) {
                mainloop.source_remove(id);
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
            // Both ports, before either is used. Only the display used to be
            // checked, and the mainloop is reached one statement after the
            // `window-created` handler is connected — so a caller without one
            // threw with the handler already on the session's display and its
            // id not yet recorded anywhere, leaving a handler nothing could
            // ever take off. That is the exact leak this module exists to
            // prevent, so it refuses before it connects.
            if (!targetDisplay || typeof targetDisplay.connect !== "function") {
                return false;
            }
            if (!targetMainloop || typeof targetMainloop.timeout_add_seconds !== "function") {
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
