"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const Popup = require("../../files/cinnamon-xpuwlm@geraldo-netto/lib/cinnamon-popup-adapter.js");

class BaseMenu {
    constructor(launcher, orientation) {
        this.sourceActor = launcher.actor;
        this.orientation = orientation;
        this.actor = {get_preferred_size: () => [100, 200, 560, 760]};
        this.fallbackCalls = 0;
    }

    _calculatePosition() {
        this.fallbackCalls += 1;
        return [12, 34];
    }
}

function environment(overrides = {}) {
    const requests = [];
    const Main = {
        layoutManager: {
            findMonitorForActor(actor) {
                requests.push(actor);
                return overrides.monitor || {index: 1, x: 1920, y: 0, width: 1920, height: 1080};
            },
        },
    };
    const cinnamonGlobal = {
        workspace_manager: {
            get_active_workspace() {
                return {
                    get_work_area_for_monitor(index) {
                        if (overrides.workAreaError) {
                            throw new Error("monitor changed");
                        }
                        assert.equal(index, 1);
                        return overrides.workArea || {x: 1920, y: 24, width: 1920, height: 1056};
                    },
                };
            },
        },
    };
    return {Main, cinnamonGlobal, requests};
}

test("centered menu uses the active monitor work area after native layout", () => {
    const {Main, cinnamonGlobal, requests} = environment();
    const factory = Popup.createCenteredPopupMenuFactory({
        Applet: {AppletPopupMenu: BaseMenu},
        Main,
        cinnamonGlobal,
    });
    const launcher = {actor: {id: "panel-applet"}};
    const menu = factory(launcher, "top");

    assert.deepEqual(menu._calculatePosition(), [2600, 172]);
    assert.equal(menu.fallbackCalls, 1, "native popup calculation preserves side and lifecycle state");
    assert.deepEqual(requests, [launcher.actor]);
    assert.equal(menu.orientation, "top");
});

test("native placement is preserved when work-area lookup is unavailable", () => {
    const monitor = {x: -1280, y: 0, width: 1280, height: 720};
    const Main = {layoutManager: {findMonitorForActor: () => monitor}};
    const Menu = Popup.createCenteredPopupMenuClass({BaseMenu, Main, cinnamonGlobal: {}});
    assert.deepEqual(new Menu({actor: {}}, "bottom")._calculatePosition(), [12, 34]);
});

test("workspace lookup fails closed at every Cinnamon capability boundary", () => {
    const monitor = {index: 1};
    const missingWorkspace = {
        workspace_manager: {get_active_workspace: () => null},
    };
    const missingWorkAreaMethod = {
        workspace_manager: {get_active_workspace: () => ({})},
    };
    const validWorkspace = {
        workspace_manager: {
            get_active_workspace: () => ({
                get_work_area_for_monitor: () => ({x: 0, y: 0, width: 100, height: 100}),
            }),
        },
    };
    for (const [cinnamonGlobal, candidateMonitor] of [
        [null, monitor],
        [{}, monitor],
        [{workspace_manager: {}}, monitor],
        [missingWorkspace, monitor],
        [missingWorkAreaMethod, monitor],
        [validWorkspace, {index: 1.5}],
    ]) {
        assert.equal(Popup.workspaceWorkArea(cinnamonGlobal, candidateMonitor), null);
    }

    const {cinnamonGlobal} = environment({workAreaError: true});
    assert.equal(Popup.workspaceWorkArea(cinnamonGlobal, monitor), null);
});

test("monitor lookup returns an exact work area or null", () => {
    const sourceActor = {id: "panel-applet"};
    const successful = environment();
    assert.deepEqual(
        Popup.monitorWorkArea(successful.Main, successful.cinnamonGlobal, sourceActor),
        {x: 1920, y: 24, width: 1920, height: 1056},
    );
    assert.deepEqual(successful.requests, [sourceActor]);

    for (const Main of [null, {}, {layoutManager: {}}, {
        layoutManager: {findMonitorForActor: () => null},
    }]) {
        assert.equal(Popup.monitorWorkArea(Main, {}, sourceActor), null);
    }
});

test("position failures preserve Cinnamon's native panel placement", () => {
    const cases = [
        {Main: {}, cinnamonGlobal: {}},
        {Main: {layoutManager: {findMonitorForActor: () => null}}, cinnamonGlobal: {}},
        environment({workAreaError: true}),
    ];
    for (const value of cases) {
        const Menu = Popup.createCenteredPopupMenuClass({
            BaseMenu,
            Main: value.Main,
            cinnamonGlobal: value.cinnamonGlobal,
        });
        const menu = new Menu({actor: {}}, "top");
        assert.deepEqual(menu._calculatePosition(), [12, 34]);
    }
});

test("measurement failures preserve Cinnamon's native panel placement", () => {
    const {Main, cinnamonGlobal} = environment();
    const Menu = Popup.createCenteredPopupMenuClass({BaseMenu, Main, cinnamonGlobal});
    const menu = new Menu({actor: {}}, "top");
    menu.actor.get_preferred_size = () => {
        throw new Error("actor was destroyed");
    };

    assert.deepEqual(menu._calculatePosition(), [12, 34]);
    assert.equal(menu.fallbackCalls, 1);
});

test("adapter factories reject missing Cinnamon capabilities", () => {
    assert.throws(() => Popup.createCenteredPopupMenuClass({}), /popup menu class/u);
    assert.throws(() => Popup.createCenteredPopupMenuFactory({}), /popup API/u);
    assert.throws(() => Popup.createCenteredPopupMenuFactory({Applet: {}}), /popup API/u);
});
