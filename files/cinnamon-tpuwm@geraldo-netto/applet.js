"use strict";

const Applet = imports.ui.applet;
const Atk = imports.gi.Atk;
const ByteArray = imports.byteArray;
const Clutter = imports.gi.Clutter;
const Gio = imports.gi.Gio;
const GLib = imports.gi.GLib;
const Gtk = imports.gi.Gtk;
const Main = imports.ui.main;
const Mainloop = imports.mainloop;
const PopupMenu = imports.ui.popupMenu;
const Settings = imports.ui.settings;
const St = imports.gi.St;
const Util = imports.misc.util;

const AlertNotifier = require("./lib/alert-notifier.js");
const CinnamonRuntime = require("./lib/cinnamon-runtime.js");
const FailureBackoff = require("./lib/failure-log-backoff.js");
const Layout = require("./lib/layout.js");
const Manager = require("./lib/manager.js");
const Menu = require("./lib/menu-view.js");
const ViewModel = require("./lib/view-model.js");

const UUID = "cinnamon-tpuwm@geraldo-netto";
const PANEL_STATUSES = Object.freeze(["online", "attention", "detected", "paused", "unavailable"]);

function panelIconFilename(status) {
    const safeStatus = PANEL_STATUSES.includes(status) ? status : "unavailable";
    return `tpuwm-status-${safeStatus}-symbolic.svg`;
}

function defaultEnvironment() {
    return {ByteArray, Gio, GLib};
}

function defaultLogger() {
    return CinnamonRuntime.createLogger("TPU Workload Manager");
}

class TpuWorkloadApplet extends Applet.TextIconApplet {
    constructor(metadata, orientation, panelHeight, instanceId, overrides = {}) {
        super(orientation, panelHeight, instanceId);
        this._metadata = metadata;
        this._orientation = orientation;
        this._destroyed = false;
        this._latestState = null;
        this._panelIconStatus = null;
        this._logger = overrides.logger || defaultLogger();
        this.settings = null;
        this.menu = null;
        this.menuManager = null;
        this._view = null;
        this._manager = null;
        this._notifier = null;
        this._poller = null;
        this._unsubscribe = null;
        try {
            this._construct(metadata, instanceId, overrides);
        } catch (error) {
            // A half-built applet must not stay in the panel holding a timer, a
            // subscription, or a settings binding.
            this._teardown();
            throw error;
        }
    }

    _construct(metadata, instanceId, overrides) {
        this._environment = overrides.environment || defaultEnvironment();
        this._runtimeGatewayFactory = overrides.runtimeGatewayFactory
            || ((path) => CinnamonRuntime.createRuntimeGateway({
                path,
                environment: this._environment,
                logger: this._logger,
            }));
        this.settings = overrides.settings
            || (overrides.settingsFactory
                ? overrides.settingsFactory(this)
                : new Settings.AppletSettings(this, metadata.uuid, instanceId));
        this._bindSettings();
        this._registerIconPath();
        this.set_applet_icon_symbolic_path(`${metadata.path}/icons/tpuwm-symbolic-v2.svg`);
        this.set_applet_tooltip("TPU Workload Manager — starting");
        this.actor.set_accessible_name("TPU Workload Manager, starting");

        this._repository = overrides.repository
            || new CinnamonRuntime.CinnamonSettingsRepository(this.settings);
        this._runtimeGateway = overrides.runtimeGateway
            || this._runtimeGatewayFactory(this.runtimeStatePath);
        this._clock = overrides.clock || Date;
        this._scheduler = overrides.scheduler || new CinnamonRuntime.CinnamonScheduler(Mainloop);
        this._manager = overrides.manager || new Manager.WorkloadManager({
            repository: this._repository,
            runtimeGateway: this._runtimeGateway,
            errorReporter: overrides.errorReporter || new FailureBackoff.FailureErrorBackoff({
                logger: this._logger,
            }),
            logger: this._logger,
            clock: this._clock,
            scheduler: this._scheduler,
        });
        this._notifier = overrides.notifier || new AlertNotifier.CriticalAlertNotifier({
            notifications: overrides.notifications
                || CinnamonRuntime.createCriticalNotifications(Main),
            errorReporter: overrides.notificationReporter
                || new FailureBackoff.FailureErrorBackoff({logger: this._logger}),
            clock: this._clock,
        });
        this._poller = overrides.poller
            || new CinnamonRuntime.CinnamonPoller(Mainloop, () => this._refresh());
        this._menuFactory = overrides.menuFactory
            || ((applet, menuOrientation) => new Applet.AppletPopupMenu(applet, menuOrientation));
        this._menuManagerFactory = overrides.menuManagerFactory
            || ((applet) => new PopupMenu.PopupMenuManager(applet));
        this._layoutProvider = overrides.layoutProvider
            || CinnamonRuntime.createLayoutProvider({Main, St});
        this._layout = this._measureLayout();
        this._viewFactory = overrides.viewFactory
            || ((menu, layout) => new Menu.MenuView({
                St,
                Clutter,
                Atk,
                menu,
                layout,
                actions: this._menuActions(),
            }));
        this.menuManager = this._menuManagerFactory(this);
        this.menu = null;
        this._view = null;
        this._createMenu(this._orientation);
        this._unsubscribe = this._manager.subscribe((state) => this._render(state));
        this._manager.start();
        this._poller.start(this.refreshInterval);
    }

    on_applet_clicked(_event) {
        if (this.menu) {
            this.menu.toggle();
        }
    }

    on_orientation_changed(orientation) {
        if (this._destroyed) {
            return;
        }
        this._orientation = orientation;
        this._destroyMenu();
        this.menuManager = this._menuManagerFactory(this);
        this._createMenu(orientation);
        if (this._latestState) {
            this._render(this._latestState);
        }
    }

    on_applet_removed_from_panel() {
        this._teardown();
    }

    _bindSettings() {
        this.settings.bind("refresh-interval", "refreshInterval", () => this._onRuntimeSettingsChanged());
        this.settings.bind("runtime-state-path", "runtimeStatePath", () => this._onRuntimeSettingsChanged());
        this.settings.bind("show-panel-label", "showPanelLabel", () => this._renderPanel());
    }

    _registerIconPath() {
        const iconTheme = Gtk.IconTheme.get_default();
        const iconPath = `${this._metadata.path}/icons`;
        if (!iconTheme.get_search_path().includes(iconPath)) {
            iconTheme.append_search_path(iconPath);
        }
    }

    _menuActions() {
        return {
            selectTab: (tab) => this._manager.selectTab(tab),
            toggleProfile: (id) => this._manager.toggleProfile(id),
            changeWeight: (id, delta) => this._manager.changeWeight(id, delta),
            pauseAll: () => this._manager.pauseAll(),
            resumeAll: () => this._manager.resumeAll(),
            refresh: () => this._manager.retryDeviceDetection(),
            openSettings: () => this._openSettings(),
        };
    }

    _createMenu(orientation) {
        this.menu = this._menuFactory(this, orientation);
        this.menuManager.addMenu(this.menu);
        this._view = this._viewFactory(this.menu, this._layout);
        if (typeof this.menu.connect === "function") {
            this.menu.connect("open-state-changed", (_menu, open) => {
                if (open) {
                    this._applyLayout();
                }
            });
        }
    }

    // The work area, display scale, and text scale can all change while the
    // applet lives, so the popup layout is re-resolved every time it opens.
    _measureLayout() {
        try {
            return Layout.popupLayout(this._layoutProvider.measure(this.actor));
        } catch (error) {
            this._logger.warn(`Could not measure the popup layout: ${error}`);
            return Layout.defaultLayout();
        }
    }

    _applyLayout() {
        if (this._destroyed) {
            return false;
        }
        this._layout = this._measureLayout();
        return this._view ? this._view.applyLayout(this._layout) : false;
    }

    // Every step runs even when an earlier one throws, so a failing view never
    // leaves the menu registered with the menu manager.
    _destroyMenu() {
        if (!this.menu) {
            return false;
        }
        const menu = this.menu;
        const view = this._view;
        const menuManager = this.menuManager;
        this.menu = null;
        this._view = null;
        this._runIsolated([
            ["destroy the popup view", () => view && view.destroy()],
            ["remove the popup menu", () => menuManager && menuManager.removeMenu(menu)],
            ["destroy the popup menu", () => menu.destroy()],
        ]);
        return true;
    }

    _runIsolated(steps) {
        let failures = 0;
        for (const [description, step] of steps) {
            try {
                step();
            } catch (error) {
                failures += 1;
                this._logger.error(`Could not ${description}: ${error}`);
            }
        }
        return failures;
    }

    _render(state) {
        if (this._destroyed) {
            return;
        }
        this._latestState = state;
        const model = ViewModel.toViewModel(state);
        if (this._view) {
            this._view.render(model);
        }
        this._renderPanel(model);
        this._notifier.observe(state.alerts, state.profiles);
    }

    _renderPanel(model = null) {
        if (this._destroyed || (!model && !this._latestState)) {
            return;
        }
        const viewModel = model || ViewModel.toViewModel(this._latestState);
        this.set_applet_label(this.showPanelLabel ? viewModel.panel.label : "");
        this.set_applet_tooltip(viewModel.panel.tooltip);
        this.actor.set_accessible_name(viewModel.panel.accessibleName);
        this._setPanelIcon(viewModel.panel.status);
        for (const status of PANEL_STATUSES) {
            this.actor.remove_style_class_name(`tpuwm-panel-${status}`);
        }
        this.actor.add_style_class_name(`tpuwm-panel-${viewModel.panel.status}`);
    }

    _setPanelIcon(status) {
        const iconStatus = PANEL_STATUSES.includes(status) ? status : "unavailable";
        if (this._panelIconStatus === iconStatus) {
            return false;
        }
        this.set_applet_icon_symbolic_path(
            `${this._metadata.path}/icons/${panelIconFilename(iconStatus)}`,
        );
        this._panelIconStatus = iconStatus;
        return true;
    }

    _refresh() {
        if (!this._destroyed) {
            this._manager.refresh();
        }
    }

    _onRuntimeSettingsChanged() {
        if (this._destroyed || !this._manager) {
            return;
        }
        this._runtimeGateway = this._runtimeGatewayFactory(this.runtimeStatePath);
        this._manager.replaceRuntimeGateway(this._runtimeGateway);
        if (this._poller) {
            this._poller.start(this.refreshInterval);
        }
    }

    _openSettings() {
        Util.spawnCommandLineAsync(`cinnamon-settings applets ${UUID}`);
    }

    // Teardown attempts every step even after a failure, and stays idempotent
    // afterwards, so a partially failed removal never leaks a timer or a
    // subscription and never runs twice.
    _teardown() {
        if (this._destroyed) {
            return false;
        }
        this._destroyed = true;
        const poller = this._poller;
        const unsubscribe = this._unsubscribe;
        const manager = this._manager;
        const notifier = this._notifier;
        const settings = this.settings;
        this._poller = null;
        this._unsubscribe = null;
        this._runIsolated([
            ["stop the refresh timer", () => poller && poller.stop()],
            ["release the state subscription", () => unsubscribe && unsubscribe()],
            ["destroy the popup menu", () => this._destroyMenu()],
            ["dispose the workload manager", () => manager && manager.dispose()],
            ["dispose the alert notifier", () => notifier && notifier.dispose()],
            ["finalize the applet settings", () => settings && settings.finalize()],
        ]);
        this._latestState = null;
        return true;
    }
}

function main(metadata, orientation, panelHeight, instanceId) {
    return new TpuWorkloadApplet(metadata, orientation, panelHeight, instanceId);
}

if (typeof module !== "undefined") {
    module.exports = {
        UUID,
        PANEL_STATUSES,
        TpuWorkloadApplet,
        defaultEnvironment,
        defaultLogger,
        main,
        panelIconFilename,
    };
}
