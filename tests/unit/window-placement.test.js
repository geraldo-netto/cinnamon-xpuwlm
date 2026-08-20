"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const Placement = require("../../files/cinnamon-xpuwlm@geraldo-netto/lib/window-placement.js");

const WORK_AREA = Object.freeze({x: 0, y: 0, width: 3840, height: 2120});

function settingsWindow(overrides = {}) {
    return {
        get_wm_class: () => "Xlet-settings.py",
        get_frame_rect: () => ({x: 90, y: 90, width: 800, height: 632}),
        get_work_area_current_monitor: () => WORK_AREA,
        allows_move: () => true,
        move_frame(userOperation, x, y) {
            this.moved = {userOperation, x, y};
        },
        ...overrides,
    };
}

test("the settings window is recognised whatever case the class is reported in", () => {
    // Muffin reports the class part of WM_CLASS, which is capitalised, while
    // the instance part is not: `xlet-settings.py.Xlet-settings.py`.
    assert.equal(Placement.isSettingsWindow(settingsWindow()), true);
    assert.equal(
        Placement.isSettingsWindow(settingsWindow({get_wm_class: () => "xlet-settings.py"})),
        true,
    );
});

test("another application's window is left alone", () => {
    assert.equal(
        Placement.isSettingsWindow(settingsWindow({get_wm_class: () => "Google-chrome"})),
        false,
    );
});

test("a window that reports no class at all is not ours to move", () => {
    assert.equal(Placement.isSettingsWindow(null), false);
    assert.equal(Placement.isSettingsWindow({}), false);
    assert.equal(Placement.isSettingsWindow(settingsWindow({get_wm_class: () => ""})), false);
    assert.equal(Placement.isSettingsWindow(settingsWindow({get_wm_class: () => null})), false);
});

test("a window is centred by its frame, in whole pixels", () => {
    const target = Placement.centredFrame(WORK_AREA, {x: 90, y: 90, width: 800, height: 632});

    assert.deepEqual(target, {x: 1520, y: 744});
    assert.equal(Number.isInteger(target.x), true);
    assert.equal(Number.isInteger(target.y), true);
});

test("the work area's own origin is honoured, so a panel is not covered", () => {
    const target = Placement.centredFrame(
        {x: 0, y: 40, width: 1920, height: 1040},
        {x: 0, y: 0, width: 800, height: 600},
    );

    assert.deepEqual(target, {x: 560, y: 260});
});

test("a window larger than the work area keeps its title bar on screen", () => {
    // Hung off the top, the only way to move it would be off screen too.
    const target = Placement.centredFrame(WORK_AREA, {x: 0, y: 0, width: 4000, height: 2400});

    assert.deepEqual(target, {x: 0, y: 0});
});

test("nothing is computed without a work area or a frame", () => {
    assert.equal(Placement.centredFrame(null, {width: 1, height: 1}), null);
    assert.equal(Placement.centredFrame(WORK_AREA, null), null);
});

test("placing a window moves its frame, as a user operation", () => {
    const window = settingsWindow();

    assert.equal(Placement.placeWindow(window), true);
    assert.deepEqual(window.moved, {userOperation: true, x: 1520, y: 744});
});

test("a window that cannot be moved is left where the person put it", () => {
    // A maximised or fullscreen settings window is a choice, not a default.
    const window = settingsWindow({allows_move: () => false});

    assert.equal(Placement.placeWindow(window), false);
    assert.equal(window.moved, undefined);
});

test("a window that cannot say where it is, or be moved, is not placed", () => {
    assert.equal(Placement.placeWindow(null), false);
    assert.equal(Placement.placeWindow({}), false);
    assert.equal(
        Placement.placeWindow(settingsWindow({get_work_area_current_monitor: undefined})),
        false,
    );
    assert.equal(Placement.placeWindow(settingsWindow({move_frame: undefined})), false);
});

test("a window manager that reports no work area is not guessed at", () => {
    const window = settingsWindow({get_work_area_current_monitor: () => null});

    assert.equal(Placement.placeWindow(window), false);
    assert.equal(window.moved, undefined);
});

test("shouldPlace answers for the window, not for the placement", () => {
    assert.equal(Placement.shouldPlace(settingsWindow()), true);
    assert.equal(Placement.shouldPlace(settingsWindow({allows_move: undefined})), true);
    assert.equal(Placement.shouldPlace(settingsWindow({get_frame_rect: undefined})), false);
});

test("a window already where it belongs is not moved again", () => {
    // Re-applying the placement while the window settles must not become a
    // loop: a move emits a position change, which would ask for another move.
    const window = settingsWindow({
        get_frame_rect: () => ({x: 1520, y: 744, width: 800, height: 632}),
    });

    assert.equal(Placement.isAt(window.get_frame_rect(), Placement.targetFor(window)), true);
    assert.equal(Placement.placeWindow(window), false);
    assert.equal(window.moved, undefined);
});

test("a window in the corner is not where it belongs", () => {
    const corner = settingsWindow();

    assert.equal(Placement.isAt(corner.get_frame_rect(), Placement.targetFor(corner)), false);
    assert.equal(Placement.targetFor(settingsWindow({allows_move: () => false})), null);
    assert.equal(Placement.targetFor(null), null);
});

test("the target is where the window would sit if it were centred now", () => {
    assert.deepEqual(Placement.targetFor(settingsWindow()), {x: 1520, y: 744});
    assert.equal(Placement.targetFor(settingsWindow({get_frame_rect: undefined})), null);
    assert.equal(
        Placement.targetFor(settingsWindow({get_work_area_current_monitor: () => null})),
        null,
    );
});

test("the settle window is bounded, so the person can move it afterwards", () => {
    assert.equal(Number.isInteger(Placement.SETTLE_MS), true);
    assert.ok(Placement.SETTLE_MS > 0);
    assert.ok(Placement.SETTLE_MS <= 5000);
});

test("the wait is bounded, so a window that never appears stops being waited for", () => {
    assert.equal(Number.isInteger(Placement.SETTINGS_WAIT_SECONDS), true);
    assert.ok(Placement.SETTINGS_WAIT_SECONDS > 0);
    assert.ok(Placement.SETTINGS_WAIT_SECONDS <= 60);
});
