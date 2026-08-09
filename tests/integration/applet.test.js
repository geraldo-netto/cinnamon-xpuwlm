"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const Domain = require("../../files/cinnamon-tpuwm@geraldo-netto/lib/domain.js");
const BuiltIns = require("../helpers/built-in-workloads.js");
const Layout = require("../../files/cinnamon-tpuwm@geraldo-netto/lib/layout.js");
const Manifest = require("../../files/cinnamon-tpuwm@geraldo-netto/lib/workload-manifest.js");
const Registry = require("../../files/cinnamon-tpuwm@geraldo-netto/lib/workload-registry.js");
const ManifestFixtures = require("../helpers/workload-manifest-fixtures.js");
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
    "runtime-state-path": "~/.local/state/tpu-workload-manager/runtime.json",
    "show-panel-label": false,
    "profile-state": Domain.defaultProfileState(BuiltIns.coreCatalog()),
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
const notifications = [];
const spawned = [];
const timers = new Map();
let nextTimerId = 1;

global.logWarning = () => {};
global.logError = () => {};
global.imports = {
    byteArray: {toString: (value) => String(value)},
    gi: {
        Atk: createAtk(),
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
        St: {
            ...createSt(),
            ThemeContext: {get_for_stage: () => ({scale_factor: 1})},
        },
    },
    mainloop: {
        timeout_add_seconds(seconds, callback) {
            const id = nextTimerId;
            nextTimerId += 1;
            timers.set(id, {seconds, callback});
            return id;
        },
        timeout_add(milliseconds, callback) {
            const id = nextTimerId;
            nextTimerId += 1;
            timers.set(id, {milliseconds, callback});
            return id;
        },
        source_remove: (id) => timers.delete(id),
    },
    misc: {util: {spawnCommandLineAsync: (command) => spawned.push(command)}},
    ui: {
        applet: {TextIconApplet: FakeTextIconApplet, AppletPopupMenu: FakeMenu},
        main: {
            criticalNotify: (summary, body) => notifications.push({summary, body}),
            layoutManager: {
                primaryMonitor: {width: 1920, height: 1080},
                findMonitorForActor: () => ({width: 1920, height: 1080}),
            },
        },
        popupMenu: {PopupMenuManager: FakeMenuManager},
        settings: {AppletSettings: BoundSettings},
    },
};

const AppletModule = require("../../files/cinnamon-tpuwm@geraldo-netto/applet.js");

test("workload catalog resolver projects only the injected registry", () => {
    const descriptor = new Manifest.WorkloadDescriptor(ManifestFixtures.validWorkloadManifest({
        id: "custom-workload",
    }));
    const registry = new Registry.StaticWorkloadRegistry([descriptor]);
    const catalog = AppletModule.resolveWorkloadCatalog(registry);
    assert.deepEqual(catalog.definitions().map((definition) => definition.id), ["custom-workload"]);
    assert.throws(() => AppletModule.resolveWorkloadCatalog(null), /registry/u);
});

function liveState(overrides = {}) {
    return {
        selectedTab: "overview",
        paused: false,
        profiles: new Domain.WorkloadPortfolio(null, BuiltIns.coreCatalog()).list(),
        device: {
            id: "tpu-usb",
            backend: "tpu",
            available: true,
            state: "present",
            name: "Coral USB",
            kind: "usb",
            vendor: "",
            load: 55,
            reason: "",
        },
        health: {device: "present", runtime: "connected", detail: ""},
        metrics: {queueDepth: 1, runningProfiles: 2},
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

function appletHarness(extraOverrides = {}) {
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
            workloadRegistry: BuiltIns.coreRegistry(),
            settingsFactory(owner) {
                const settings = new BoundSettings(owner);
                settingsInstances.push(settings);
                return settings;
            },
            runtimeGatewayFactory(path) {
                const gateway = {path, read: (options, callback) => callback(Domain.unavailableSnapshot("stub", 1, "error"))};
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
            viewFactory(menu, layout) {
                const view = {
                    menu,
                    layout,
                    layouts: [],
                    models: [],
                    destroyed: false,
                    render(model) { this.models.push(model); },
                    applyLayout(next) { this.layouts.push(next); return true; },
                    destroy() { this.destroyed = true; },
                };
                views.push(view);
                return view;
            },
            ...extraOverrides,
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

test("critical alerts notify once per occurrence through the applet", () => {
    const delivered = [];
    const {applet, manager} = appletHarness({
        notifications: {notify: (message) => delivered.push(message)},
    });
    const critical = {
        id: "power-risk",
        profileId: "hardware-health",
        title: "Voltage drift",
        summary: "Review the supply",
        severity: "critical",
        timestamp: Date.now(),
        confidence: null,
        riskScore: null,
        resolved: false,
    };

    manager.callback(liveState({source: "runtime", alerts: [critical], attentionCount: 1}));
    manager.callback(liveState({source: "runtime", alerts: [critical], attentionCount: 1}));
    assert.equal(delivered.length, 1);
    assert.equal(delivered[0].summary, "TPU critical alert — Hardware health");

    manager.callback(liveState({
        source: "runtime",
        alerts: [{...critical, resolved: true}],
        attentionCount: 0,
    }));
    manager.callback(liveState({source: "runtime", alerts: [critical], attentionCount: 1}));
    assert.equal(delivered.length, 2);

    applet._teardown();
    manager.callback(liveState({source: "runtime", alerts: [critical], attentionCount: 1}));
    assert.equal(delivered.length, 2);
});

test("the default applet reaches Cinnamon's critical notification tray", () => {
    const {manager} = appletHarness();
    const before = notifications.length;
    manager.callback(liveState({
        source: "runtime",
        alerts: [{
            id: "tray-alert",
            profileId: "hardware-health",
            title: "Voltage drift",
            summary: "",
            severity: "critical",
            timestamp: Date.now(),
            confidence: null,
            riskScore: null,
            resolved: false,
        }],
        attentionCount: 1,
    }));
    assert.equal(notifications.length, before + 1);
    assert.equal(notifications.at(-1).body, "Voltage drift");
});

test("panel state classes are a closed set that is fully cleaned between renders", () => {
    assert.deepEqual(AppletModule.PANEL_STATUSES, [
        "online", "attention", "detected", "paused", "unavailable",
    ]);
    const {applet, manager} = appletHarness();
    for (const status of AppletModule.PANEL_STATUSES) {
        applet.actor.add_style_class_name(`tpuwm-panel-${status}`);
    }
    applet.actor.add_style_class_name("tpuwm-panel-unrelated");

    manager.callback(liveState({source: "runtime"}));
    const applied = [...applet.actor.styleClasses].filter((name) => name.startsWith("tpuwm-panel-"));
    assert.deepEqual(applied.sort(), ["tpuwm-panel-online", "tpuwm-panel-unrelated"].sort());
    assert.deepEqual(
        AppletModule.PANEL_STATUSES.map((status) => AppletModule.panelIconFilename(status)),
        AppletModule.PANEL_STATUSES.map((status) => `tpuwm-status-${status}-symbolic.svg`),
    );
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

test("the popup starts with a safe default and measures only after it opens", () => {
    let measurements = 0;
    const {applet, menus, views} = appletHarness({
        layoutProvider: {
            measure() {
                measurements += 1;
                return {workAreaWidth: 480, workAreaHeight: 900};
            },
        },
    });
    assert.equal(views[0].layout.mode, "wide");
    assert.equal(views[0].layout.widthPx, Layout.PREFERRED_WIDTH);
    assert.deepEqual(views[0].layouts, []);
    assert.equal(measurements, 0, "construction must not inspect an unstaged applet actor");

    menus[0].emit("open-state-changed", true);
    assert.equal(measurements, 1);
    assert.equal(views[0].layouts.length, 1);
    assert.equal(views[0].layouts[0].mode, "compact");
    assert.equal(applet._layout.mode, "compact");

    menus[0].emit("open-state-changed", false);
    assert.equal(measurements, 1);
    assert.equal(views[0].layouts.length, 1, "closing the popup must not re-measure");
});

test("an unusable layout measurement falls back to the default popup layout", () => {
    const warnings = [];
    const menu = new FakeMenu();
    const applet = new AppletModule.TpuWorkloadApplet(
        {uuid: AppletModule.UUID, path: "/tmp/tpuwm"},
        "top",
        40,
        12,
        {
            logger: {warn: (message) => warnings.push(message), error() {}},
            environment: {},
            workloadRegistry: BuiltIns.coreRegistry(),
            settingsFactory: (owner) => new BoundSettings(owner),
            repository: {load: () => ({}), save() {}},
            runtimeGateway: {read: (options, callback) => callback(Domain.unavailableSnapshot("none", 1, "error"))},
            layoutProvider: {measure() { throw new Error("no monitor"); }},
            poller: {start() {}, stop() {}},
            menuFactory: () => menu,
            menuManagerFactory: () => new FakeMenuManager(),
            viewFactory: (_popup, layout) => ({layout, render() {}, applyLayout() {}, destroy() {}}),
        },
    );
    assert.deepEqual(applet._layout, Layout.defaultLayout());
    assert.deepEqual(warnings, []);
    menu.emit("open-state-changed", true);
    assert.match(warnings[0], /Could not measure the popup layout/u);
    applet.on_applet_removed_from_panel();
});

test("layout work stops without a view and after teardown", () => {
    const {applet, views} = appletHarness();
    applet._destroyMenu();
    assert.equal(applet._applyLayout(), false);
    applet._teardown();
    assert.equal(applet._applyLayout(), false);
    assert.deepEqual(views[0].layouts, []);
});

test("applet wires a scheduler so connected state expires without a poll", () => {
    const generatedAt = 1_700_000_000_000;
    let nowMs = generatedAt;
    const scheduled = [];
    const applet = new AppletModule.TpuWorkloadApplet(
        {uuid: AppletModule.UUID, path: "/tmp/tpuwm"},
        "top",
        40,
        11,
        {
            logger: {warn() {}, error() {}},
            environment: {},
            workloadRegistry: BuiltIns.coreRegistry(),
            clock: {now: () => nowMs},
            settingsFactory: (owner) => new BoundSettings(owner),
            repository: {load: () => ({}), save() {}},
            runtimeGateway: {
                read: (options, callback) => callback(Domain.normalizeSnapshot({
                    version: Domain.SNAPSHOT_VERSION,
                    generatedAt,
                    devices: [{id: "tpu-usb", backend: "tpu", available: true, name: "Coral USB", kind: "usb"}],
                    metrics: {queueDepth: 0, runningProfiles: 0},
                    profiles: {},
                    alerts: [],
                }, nowMs)),
            },
            scheduler: {
                schedule(delayMs, callback) {
                    scheduled.push({delayMs, callback});
                    return scheduled.length;
                },
                cancel: () => true,
            },
            poller: {start() {}, stop() {}},
            menuFactory: () => new FakeMenu(),
            menuManagerFactory: () => new FakeMenuManager(),
            viewFactory: () => ({render() {}, destroy() {}}),
        },
    );

    assert.equal(applet.actor.styleClasses.has("tpuwm-panel-online"), true);
    assert.equal(scheduled.length, 1);
    assert.equal(scheduled[0].delayMs, Domain.DEFAULT_STALE_AFTER_MS + 1);

    nowMs = generatedAt + Domain.DEFAULT_STALE_AFTER_MS + 1;
    scheduled[0].callback();
    assert.equal(applet.actor.styleClasses.has("tpuwm-panel-unavailable"), true);
    assert.match(applet.tooltip, /stale/u);
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
    assert.match(instance.actor.accessibleName, /unknown:/u);
    const timer = [...timers.values()].at(-1);
    assert.equal(timer.callback(), true);
    instance.on_applet_removed_from_panel();
});
