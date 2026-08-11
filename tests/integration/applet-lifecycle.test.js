"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const Domain = require("../../files/cinnamon-xpuwlm@geraldo-netto/lib/domain.js");
const BuiltIns = require("../helpers/built-in-workloads.js");
const {
    FakeActor,
    FakeMenu,
    FakeMenuManager,
    FakeSettings,
    createAtk,
    createSt,
} = require("../helpers/fakes.js");

const DEFAULTS = {
    "refresh-interval": 5,
    "runtime-state-path": "~/.local/state/xpu-workload-manager/runtime.json",
    "show-panel-label": false,
    "profile-state": Domain.defaultProfileState(BuiltIns.coreCatalog()),
    "selected-tab": "overview",
    "identity-migration-version": 0,
};

class FakeTextIconApplet {
    constructor(orientation, panelHeight, instanceId) {
        this.baseArguments = {orientation, panelHeight, instanceId};
        this.actor = new FakeActor();
        this.iconPath = null;
        this.label = null;
        this.tooltip = null;
    }

    set_applet_icon_symbolic_path(path) { this.iconPath = path; }

    set_applet_label(label) { this.label = label; }

    set_applet_tooltip(tooltip) { this.tooltip = tooltip; }
}

class BoundSettings extends FakeSettings {
    constructor(owner) {
        super(owner, DEFAULTS);
    }
}

const iconPaths = [];

global.logWarning = () => {};
global.logError = () => {};
global.imports = {
    byteArray: {toString: (value) => String(value)},
    gi: {
        Atk: createAtk(),
        Clutter: {ActorAlign: {CENTER: "center"}},
        Gio: {
            File: {new_for_path: () => ({query_exists: () => false})},
            FileQueryInfoFlags: {NOFOLLOW_SYMLINKS: 1},
        },
        GLib: {get_home_dir: () => "/home/tester", file_get_contents: () => [false, ""]},
        Gtk: {
            IconTheme: {
                get_default: () => ({
                    get_search_path: () => iconPaths.slice(),
                    append_search_path: (path) => iconPaths.push(path),
                }),
            },
        },
        St: {...createSt(), ThemeContext: {get_for_stage: () => ({scale_factor: 1})}},
    },
    mainloop: {
        timeout_add_seconds: () => 1,
        timeout_add: () => 2,
        source_remove: () => true,
    },
    misc: {util: {spawnCommandLineAsync: () => {}}},
    ui: {
        applet: {TextIconApplet: FakeTextIconApplet, AppletPopupMenu: FakeMenu},
        main: {
            criticalNotify: () => {},
            layoutManager: {primaryMonitor: {width: 1920, height: 1080}},
        },
        popupMenu: {PopupMenuManager: FakeMenuManager},
        settings: {AppletSettings: BoundSettings},
    },
};

const AppletModule = require("../../files/cinnamon-xpuwlm@geraldo-netto/applet.js");

function tracker() {
    const record = [];
    return {
        record,
        overrides(extra = {}) {
            return {
                logger: {warn() {}, error: (message) => record.push(["error", message])},
                environment: {},
                workloadRegistry: BuiltIns.coreRegistry(),
                clock: {now: () => 1_700_000_000_000},
                settingsFactory(owner) {
                    const settings = new BoundSettings(owner);
                    settings.finalize = () => record.push(["finalize"]);
                    return settings;
                },
                repository: {load: () => ({}), save() {}},
                runtimeGateway: {read: (options, callback) => callback(Domain.unavailableSnapshot("none", 1, "error"))},
                notifications: {notify() {}},
                layoutProvider: {measure: () => ({workAreaWidth: 1920, workAreaHeight: 1080})},
                poller: {
                    start: () => record.push(["poller.start"]),
                    stop: () => record.push(["poller.stop"]),
                },
                menuFactory: () => {
                    const menu = new FakeMenu();
                    menu.destroy = () => record.push(["menu.destroy"]);
                    return menu;
                },
                menuManagerFactory: () => ({
                    addMenu: () => record.push(["menuManager.add"]),
                    removeMenu: () => record.push(["menuManager.remove"]),
                }),
                viewFactory: () => ({
                    render() {},
                    applyLayout() {},
                    destroy: () => record.push(["view.destroy"]),
                }),
                ...extra,
            };
        },
    };
}

function construct(overrides) {
    return new AppletModule.XpuWorkloadApplet(
        {uuid: AppletModule.UUID, path: "/tmp/xpuwlm"},
        "top",
        40,
        21,
        overrides,
    );
}

test("a failure while creating the menu rolls the applet back", () => {
    const {record, overrides} = tracker();
    assert.throws(
        () => construct(overrides({
            menuFactory() { throw new Error("no popup"); },
        })),
        /no popup/u,
    );
    const steps = record.map(([name]) => name);
    assert.equal(steps.includes("finalize"), true, "settings must be finalized");
    assert.equal(steps.includes("poller.start"), false, "polling must never start");
    assert.equal(steps.includes("view.destroy"), false, "no view was created");
});

test("a failure while starting the poller releases every earlier resource", () => {
    const {record, overrides} = tracker();
    assert.throws(
        () => construct(overrides({
            poller: {
                start() { throw new Error("no timer"); },
                stop: () => record.push(["poller.stop"]),
            },
        })),
        /no timer/u,
    );
    const steps = record.map(([name]) => name);
    assert.equal(steps.includes("poller.stop"), true);
    assert.equal(steps.includes("view.destroy"), true);
    assert.equal(steps.includes("menuManager.remove"), true);
    assert.equal(steps.includes("menu.destroy"), true);
    assert.equal(steps.includes("finalize"), true);
});

test("a failure before the settings exist still rolls back cleanly", () => {
    const {record, overrides} = tracker();
    assert.throws(
        () => construct(overrides({
            settingsFactory() { throw new Error("no settings"); },
        })),
        /no settings/u,
    );
    assert.deepEqual(record.map(([name]) => name), []);
});

test("teardown attempts every step even when earlier steps throw", () => {
    const {record, overrides} = tracker();
    const applet = construct(overrides({
        poller: {
            start() {},
            stop() { throw new Error("timer already gone"); },
        },
        viewFactory: () => ({
            render() {},
            applyLayout() {},
            destroy() { throw new Error("view already gone"); },
        }),
    }));

    assert.equal(applet._teardown(), true);
    const steps = record.map(([name]) => name);
    assert.equal(steps.includes("menuManager.remove"), true);
    assert.equal(steps.includes("menu.destroy"), true);
    assert.equal(steps.includes("finalize"), true);
    const errors = record.filter(([name]) => name === "error").map(([, message]) => message);
    assert.equal(errors.some((message) => /stop the refresh timer/u.test(message)), true);
    assert.equal(errors.some((message) => /destroy the popup view/u.test(message)), true);
});

test("teardown stays idempotent after a partial failure", () => {
    const {record, overrides} = tracker();
    const applet = construct(overrides({
        poller: {
            start() {},
            stop() { throw new Error("timer already gone"); },
        },
    }));
    assert.equal(applet._teardown(), true);
    const afterFirst = record.length;
    assert.equal(applet._teardown(), false);
    assert.equal(record.length, afterFirst);
    assert.equal(applet._destroyMenu(), false);
});

test("a failing state subscription release does not block later cleanup", () => {
    const {record, overrides} = tracker();
    const applet = construct(overrides({
        manager: {
            subscribe() { return () => { throw new Error("already released"); }; },
            start() {},
            refresh() {},
            dispose: () => record.push(["manager.dispose"]),
        },
    }));
    assert.equal(applet._teardown(), true);
    const steps = record.map(([name]) => name);
    assert.equal(steps.includes("manager.dispose"), true);
    assert.equal(steps.includes("finalize"), true);
});
