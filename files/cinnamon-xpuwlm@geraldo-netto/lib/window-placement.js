"use strict";

// Where the applet's own settings window goes.
//
// "Configure…" in the applet's context menu is Cinnamon's, not this applet's:
// it spawns `xlet-settings`, which sets a size (800×600) and no position, so
// the window manager drops it in a corner — measured at 90,90 on a 3840-wide
// desk, with the panel it belongs to at the opposite end of the screen. The
// client's own windows centre themselves on the monitor in use, and a settings
// window for the same applet that lands in the corner reads as a different
// application's.
//
// Cinnamon's `configureApplet` is a method, so the applet overrides it, spawns
// the same command, and places the window that appears. The rules are here,
// free of Muffin and of the panel, because "which window is it" and "where
// does it go" are the parts worth testing; the applet keeps the two lines that
// touch the window manager.

// Muffin reports the WM_CLASS class part, which is capitalised, while the
// instance part is not: `xlet-settings.py.Xlet-settings.py`. Matched without
// case so a Cinnamon that reports either is still recognised.
const SETTINGS_WM_CLASS = "xlet-settings.py";
// A settings window that never appears — a spawn that failed, a Cinnamon that
// stopped using xlet-settings — must not leave a signal handler waiting for
// the life of the session.
const SETTINGS_WAIT_SECONDS = 20;
// How long the window is kept centred after it appears. The window manager
// places a new window itself, and whether that happens before or after the
// first idle turn is a race: measured both ways on the same desk, once
// centred and once left in the corner. So the placement is re-applied while
// the window settles, and released afterwards — a window the person moves a
// second later is theirs.
const SETTLE_MS = 2000;

function isSettingsWindow(window, wmClass = SETTINGS_WM_CLASS) {
    if (!window || typeof window.get_wm_class !== "function") {
        return false;
    }
    const reported = window.get_wm_class();
    if (typeof reported !== "string" || !reported) {
        return false;
    }
    return reported.toLowerCase() === String(wmClass).toLowerCase();
}

// Whole pixels: a half-pixel offset is a blurred window on a fractional scale,
// and nothing here needs the precision.
function centre(available, size) {
    return Math.round(available / 2 - size / 2);
}

// The frame, not the client area: a window centred by its client area sits low
// by the height of its own title bar, which is exactly the "nearly centred"
// that looks like a mistake rather than a choice.
function centredFrame(workArea, frame) {
    if (!workArea || !frame) {
        return null;
    }
    const x = workArea.x + centre(workArea.width, frame.width);
    const y = workArea.y + centre(workArea.height, frame.height);
    return {
        // A window larger than the work area is pinned to its top-left corner
        // rather than hung off the top of the screen, where its title bar —
        // the only way to move it — would be unreachable.
        x: Math.max(workArea.x, x),
        y: Math.max(workArea.y, y),
    };
}

// Placement is skipped, never forced, when a window says it cannot be moved:
// a maximised or fullscreen settings window is where the person put it.
function shouldPlace(window) {
    if (!window || typeof window.get_frame_rect !== "function") {
        return false;
    }
    if (typeof window.allows_move === "function" && !window.allows_move()) {
        return false;
    }
    return true;
}

// Where this window would sit if it were centred now, or null when that
// cannot be worked out.
function targetFor(window) {
    if (!shouldPlace(window)) {
        return null;
    }
    const workArea = typeof window.get_work_area_current_monitor === "function"
        ? window.get_work_area_current_monitor()
        : null;
    return centredFrame(workArea, window.get_frame_rect());
}

function isAt(frame, target) {
    return frame.x === target.x && frame.y === target.y;
}

// Already there. Asked before every move so that re-applying the placement
// while the window settles cannot become a loop: a move to where the window
// already is would emit another position change, which would move it again.
function isPlaced(window) {
    const target = targetFor(window);
    return target !== null && isAt(window.get_frame_rect(), target);
}

// One target, asked for once. This used to compute it three times over —
// `shouldPlace`, then `targetFor`, then `isPlaced` computing its own — which
// is three round trips to the window manager for the frame and the work area
// on every position change while the window settles.
function placeWindow(window) {
    const target = targetFor(window);
    if (!target || typeof window.move_frame !== "function"
            || isAt(window.get_frame_rect(), target)) {
        return false;
    }
    // `true` for a user operation: this is the person having asked for the
    // window, so the placement is theirs and the window manager should not
    // second-guess it.
    window.move_frame(true, target.x, target.y);
    return true;
}

module.exports = {
    SETTINGS_WAIT_SECONDS,
    SETTINGS_WM_CLASS,
    SETTLE_MS,
    centredFrame,
    isAt,
    isPlaced,
    isSettingsWindow,
    placeWindow,
    shouldPlace,
    targetFor,
};
