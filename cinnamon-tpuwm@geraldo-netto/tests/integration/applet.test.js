"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const Domain = require("../../lib/domain.js");
const {
    FakeActor,
    FakeMenu,
    FakeMenuManager,
    FakeSettings,
    createSt,
} = require("../helpers/fakes.js");

const DEFAULTS = {
    "refresh-interval": 5,
    "runtime-state-path": "~/.local/state/tpu-workload-manager/runtime.json",
    "show-panel-label": false,
    "profile-state": Domain.defaultProfileState(),
    "selected-tab": "overview",
};

class FakeTextIconApplet {
    constructor(orientation, panelHeight, instanceId) {
        this.baseArguments = {orientation, panelHeight, instanceId};
        this.actor = new FakeActor();
        this.iconPath = null;
        this.symbolicIconPaths = [];
        this.label = null;
        this.tooltip = null;
    }

    set_applet_icon_symbolic_path(path) {
        this.iconPath = path;
        this.symbolicIconPaths.push(path);
    }

    set_applet_label(label) {
        this.label = label;
    }

    set_applet_tooltip(tooltip) {
        this.tooltip = tooltip;
    }
}

class BoundSettings extends FakeSettings {
    constructor(owner) {
        super(owner, DEFAULTS);
    }
}

const iconPaths = [];
const spawned = [];
const timers = new Map();
let nextTimerId = 1;

global.logWarning = () => {};
global.logError = () => {};
global.imports = {
    byteArray: {toString: (value) => String(value)},
    gi: {
        Atk: {Role: {PUSH_BUTTON: "push-button"}},
        Clutter: {ActorAlign: {CENTER: "center"}},
        Gio: {
            File: {
                new_for_path: () => ({
                    query_exists: () => false,
                }),
            },
            FileQueryInfoFlags: {NOFOLLOW_SYMLINKS: 1},
        },
        GLib: {
            get_home_dir: () => "/home/tester",
            file_get_contents: () => [false, ""],
        },
        Gtk: {
            IconTheme: {
                get_default: () => ({
                    get_search_path: () => iconPaths.slice(),
                    append_search_path: (path) => iconPaths.push(path),
                }),
            },
        },
        St: createSt(),
    },
    mainloop: {
        timeout_add_seconds(seconds, callback) {
            const id = nextTimerId;
            nextTimerId += 1;
            timers.set(id, {seconds, callback});
            return id;
        },
        source_remove: (id) => timers.delete(id),
    },
    misc: {util: {spawnCommandLineAsync: (command) => spawned.push(command)}},
    ui: {
        applet: {TextIconApplet: FakeTextIconApplet, AppletPopupMenu: FakeMenu},
        popupMenu: {PopupMenuManager: FakeMenuManager},
        settings: {AppletSettings: BoundSettings},
    },
};

const AppletModule = require("../../applet.js");

function liveState(overrides = {}) {
    return {
        selectedTab: "overview",
        paused: false,
        profiles: new Domain.WorkloadPortfolio().list(),
        device: {available: true, name: "Coral USB", kind: "usb", reason: ""},
        metrics: {load: 55, queueDepth: 1, runningProfiles: 2},
        alerts: [],
        attentionCount: 0,
        stale: false,
        source: "probe",
        generatedAt: Date.now(),
        ...overrides,
    };
}

function managerFake(initial = liveState()) {
    return {
        calls: [],
        state: initial,
        subscribe(callback) {
            this.callback = callback;
            return () => { this.calls.push(["unsubscribe"]); };
        },
        start() {
            this.calls.push(["start"]);
            this.callback(this.state);
        },
        refresh() { this.calls.push(["refresh"]); this.callback(this.state); },
        retryDeviceDetection() {
            this.calls.push(["retryDeviceDetection"]);
            this.callback(this.state);
        },
        replaceRuntimeGateway(value) { this.calls.push(["replaceRuntimeGateway", value]); },
        selectTab(value) { this.calls.push(["selectTab", value]); },
        toggleProfile(value) { this.calls.push(["toggleProfile", value]); },
        changeWeight(id, delta) { this.calls.push(["changeWeight", id, delta]); },
        pauseAll() { this.calls.push(["pauseAll"]); },
        resumeAll() { this.calls.push(["resumeAll"]); },
        dispose() { this.calls.push(["dispose"]); },
    };
}

function appletHarness() {
    const manager = managerFake();
    const poller = {
        calls: [],
        start(value) { this.calls.push(["start", value]); },
        stop() { this.calls.push(["stop"]); },
    };
    const settingsInstances = [];
    const views = [];
    const menus = [];
    const menuManagers = [];
    const gateways = [];
    const applet = new AppletModule.TpuWorkloadApplet(
        {uuid: AppletModule.UUID, path: "/tmp/tpuwm"},
        "top",
        40,
        7,
        {
            logger: {warn() {}, error() {}},
            environment: {},
            settingsFactory(owner) {
                const settings = new BoundSettings(owner);
                settingsInstances.push(settings);
                return settings;
            },
            runtimeGatewayFactory(path) {
                const gateway = {path, read() { return {}; }};
                gateways.push(gateway);
                return gateway;
            },
            manager,
            poller,
            menuFactory(_owner, orientation) {
                const menu = new FakeMenu();
                menu.orientation = orientation;
                menus.push(menu);
                return menu;
            },
            menuManagerFactory() {
                const menuManager = new FakeMenuManager();
                menuManagers.push(menuManager);
                return menuManager;
            },
            viewFactory(menu) {
                const view = {
                    menu,
                    models: [],
                    destroyed: false,
                    render(model) { this.models.push(model); },
                    destroy() { this.destroyed = true; },
                };
                views.push(view);
                return view;
            },
        },
    );
    return {applet, gateways, manager, menuManagers, menus, poller, settings: settingsInstances[0], views};
}

test("constructor binds settings, registers icon, renders, and starts polling", () => {
    const {applet, manager, menus, poller, views} = appletHarness();
    assert.deepEqual(applet.baseArguments, {orientation: "top", panelHeight: 40, instanceId: 7});
    assert.deepEqual(applet.symbolicIconPaths, [
        "/tmp/tpuwm/icons/tpuwm-symbolic-v2.svg",
        "/tmp/tpuwm/icons/tpuwm-status-detected-symbolic.svg",
    ]);
    assert.equal(iconPaths.includes("/tmp/tpuwm/icons"), true);
    assert.equal(applet.label, "");
    assert.match(applet.tooltip, /hardware detected/);
    assert.match(applet.actor.accessibleName, /detected: hardware detected/);
    assert.equal(applet.actor.styleClasses.has("tpuwm-panel-detected"), true);
    assert.deepEqual(manager.calls[0], ["start"]);
    assert.deepEqual(poller.calls, [["start", 5]]);
    assert.equal(menus.length, 1);
    assert.equal(views[0].models.length, 1);
});

test("menu actions delegate without mixing responsibilities", () => {
    const {applet, manager} = appletHarness();
    const actions = applet._menuActions();
    actions.selectTab("alerts");
    actions.toggleProfile("hardware-health");
    actions.changeWeight("hardware-health", -1);
    actions.pauseAll();
    actions.resumeAll();
    actions.refresh();
    actions.openSettings();
    assert.deepEqual(manager.calls.slice(1), [
        ["selectTab", "alerts"],
        ["toggleProfile", "hardware-health"],
        ["changeWeight", "hardware-health", -1],
        ["pauseAll"],
        ["resumeAll"],
        ["retryDeviceDetection"],
    ]);
    assert.equal(spawned.at(-1), `cinnamon-settings applets ${AppletModule.UUID}`);
});

test("polling refresh remains cacheable while manual refresh requests fresh detection", () => {
    const {applet, manager} = appletHarness();
    applet._refresh();
    applet._menuActions().refresh();
    assert.deepEqual(manager.calls.slice(-2), [
        ["refresh"],
        ["retryDeviceDetection"],
    ]);
});

test("click and orientation lifecycle replace menu and preserve latest state", () => {
    const {applet, menuManagers, menus, views} = appletHarness();
    applet.on_applet_clicked();
    assert.equal(menus[0].toggleCount, 1);
    applet.on_orientation_changed("bottom");
    assert.equal(menus[0].destroyed, true);
    assert.equal(views[0].destroyed, true);
    assert.equal(menuManagers[0].menus.length, 0);
    assert.equal(menus[1].orientation, "bottom");
    assert.equal(views[1].models.length, 1);
    applet.menu = null;
    assert.doesNotThrow(() => applet.on_applet_clicked());
});

test("runtime setting changes replace gateway and restart poller", () => {
    const {applet, gateways, manager, poller, settings} = appletHarness();
    settings.setValue("runtime-state-path", "/run/new.json");
    assert.equal(gateways.at(-1).path, "/run/new.json");
    assert.deepEqual(manager.calls.at(-1), ["replaceRuntimeGateway", gateways.at(-1)]);
    settings.setValue("refresh-interval", 9);
    assert.deepEqual(poller.calls.at(-1), ["start", 9]);
    settings.setValue("show-panel-label", true);
    assert.equal(applet.label, "TPU Detected");
});

test("panel uses cached symbolic state icons and explicit accessible status", () => {
    const {applet, manager} = appletHarness();
    const states = [
        [liveState({source: "runtime"}), "online", /online: 55% load/u],
        [liveState({source: "runtime", attentionCount: 1}), "attention", /attention: 1 item needs review/u],
        [liveState({paused: true}), "paused", /paused: all workloads paused/u],
        [liveState({source: "probe"}), "detected", /detected: hardware detected/u],
        [liveState({device: {available: false, name: "No TPU", kind: "unknown", reason: "Disconnected"}}), "unavailable", /unavailable: Disconnected/u],
    ];

    for (const [state, status, accessibleName] of states) {
        manager.callback(state);
        assert.equal(
            applet.iconPath,
            `/tmp/tpuwm/icons/tpuwm-status-${status}-symbolic.svg`,
        );
        assert.match(applet.actor.accessibleName, accessibleName);
        assert.equal(applet.label, "");
        for (const candidate of AppletModule.PANEL_STATUSES) {
            assert.equal(
                applet.actor.styleClasses.has(`tpuwm-panel-${candidate}`),
                candidate === status,
            );
        }
    }

    const callsBeforeRepeatedState = applet.symbolicIconPaths.length;
    manager.callback(states.at(-1)[0]);
    assert.equal(applet.symbolicIconPaths.length, callsBeforeRepeatedState);
    assert.equal(applet._setPanelIcon("online"), true);
    assert.match(applet.iconPath, /tpuwm-status-online-symbolic\.svg$/u);
    assert.equal(applet._setPanelIcon("online"), false);
    assert.equal(applet._setPanelIcon("future-status"), true);
    assert.match(applet.iconPath, /tpuwm-status-unavailable-symbolic\.svg$/u);
    assert.equal(applet._setPanelIcon("future-status"), false);
    assert.equal(AppletModule.panelIconFilename("future-status"), "tpuwm-status-unavailable-symbolic.svg");
    assert.equal(AppletModule.panelIconFilename("online"), "tpuwm-status-online-symbolic.svg");
});

test("render updates safety styling and ignores work after teardown", () => {
    const {applet, manager, poller, settings} = appletHarness();
    manager.callback(liveState({source: "runtime", attentionCount: 1}));
    assert.equal(applet.actor.styleClasses.has("tpuwm-panel-attention"), true);
    assert.equal(applet.actor.styleClasses.has("tpuwm-panel-online"), false);
    assert.equal(applet._teardown(), true);
    assert.equal(applet._teardown(), false);
    assert.equal(settings.finalized, true);
    assert.deepEqual(poller.calls.at(-1), ["stop"]);
    assert.equal(manager.calls.some((call) => call[0] === "dispose"), true);
    const before = manager.calls.length;
    applet._refresh();
    applet._onRuntimeSettingsChanged();
    applet.on_orientation_changed("left");
    manager.callback(liveState({paused: true}));
    assert.equal(manager.calls.length, before);
});

test("menu destruction and panel rendering tolerate missing transient state", () => {
    const {applet} = appletHarness();
    assert.equal(applet._destroyMenu(), true);
    assert.equal(applet._destroyMenu(), false);
    applet._latestState = null;
    assert.doesNotThrow(() => applet._renderPanel());
    applet.menu = null;
    applet.on_applet_removed_from_panel();
});

test("default environment, logger, and main construct with Cinnamon dependencies", () => {
    assert.equal(AppletModule.defaultEnvironment().Gio, global.imports.gi.Gio);
    const logger = AppletModule.defaultLogger();
    assert.doesNotThrow(() => logger.warn("warning"));
    assert.doesNotThrow(() => logger.error("error"));
    const instance = AppletModule.main(
        {uuid: AppletModule.UUID, path: "/tmp/default-tpuwm"},
        "top",
        40,
        8,
    );
    assert.equal(instance instanceof AppletModule.TpuWorkloadApplet, true);
    assert.equal(instance.label, "");
    assert.match(instance.iconPath, /tpuwm-status-unavailable-symbolic\.svg$/u);
    assert.match(instance.actor.accessibleName, /unavailable:/u);
    const timer = [...timers.values()].at(-1);
    assert.equal(timer.callback(), true);
    instance.on_applet_removed_from_panel();
});
