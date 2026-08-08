"use strict";

const Applet = imports.ui.applet;
const Atk = imports.gi.Atk;
const ByteArray = imports.byteArray;
const Clutter = imports.gi.Clutter;
const Gio = imports.gi.Gio;
const GLib = imports.gi.GLib;
const Gtk = imports.gi.Gtk;
const Mainloop = imports.mainloop;
const PopupMenu = imports.ui.popupMenu;
const Settings = imports.ui.settings;
const St = imports.gi.St;
const Util = imports.misc.util;

const CinnamonRuntime = require("./lib/cinnamon-runtime.js");
const Manager = require("./lib/manager.js");
const Menu = require("./lib/menu-view.js");
const ViewModel = require("./lib/view-model.js");

const UUID = "cinnamon-tpuwm@geraldo-netto";

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
        this._logger = overrides.logger || defaultLogger();
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
        this.set_applet_icon_path(`${metadata.path}/icons/tpuwm-symbolic.svg`);
        this.set_applet_tooltip("TPU Workload Manager — starting");

        this._repository = overrides.repository
            || new CinnamonRuntime.CinnamonSettingsRepository(this.settings);
        this._runtimeGateway = overrides.runtimeGateway
            || this._runtimeGatewayFactory(this.runtimeStatePath);
        this._manager = overrides.manager || new Manager.WorkloadManager({
            repository: this._repository,
            runtimeGateway: this._runtimeGateway,
            logger: this._logger,
        });
        this._poller = overrides.poller
            || new CinnamonRuntime.CinnamonPoller(Mainloop, () => this._refresh());
        this._menuFactory = overrides.menuFactory
            || ((applet, menuOrientation) => new Applet.AppletPopupMenu(applet, menuOrientation));
        this._menuManagerFactory = overrides.menuManagerFactory
            || ((applet) => new PopupMenu.PopupMenuManager(applet));
        this._viewFactory = overrides.viewFactory
            || ((menu) => new Menu.MenuView({
                St,
                Clutter,
                Atk,
                menu,
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
            refresh: () => this._refresh(),
            openSettings: () => this._openSettings(),
        };
    }

    _createMenu(orientation) {
        this.menu = this._menuFactory(this, orientation);
        this.menuManager.addMenu(this.menu);
        this._view = this._viewFactory(this.menu);
    }

    _destroyMenu() {
        if (!this.menu) {
            return false;
        }
        if (this._view) {
            this._view.destroy();
            this._view = null;
        }
        this.menuManager.removeMenu(this.menu);
        this.menu.destroy();
        this.menu = null;
        return true;
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
    }

    _renderPanel(model = null) {
        if (this._destroyed || (!model && !this._latestState)) {
            return;
        }
        const viewModel = model || ViewModel.toViewModel(this._latestState);
        this.set_applet_label(this.showPanelLabel ? viewModel.panel.label : "");
        this.set_applet_tooltip(viewModel.panel.tooltip);
        for (const status of ["online", "attention", "paused", "unavailable"]) {
            this.actor.remove_style_class_name(`tpuwm-panel-${status}`);
        }
        this.actor.add_style_class_name(`tpuwm-panel-${viewModel.panel.status}`);
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

    _teardown() {
        if (this._destroyed) {
            return false;
        }
        this._destroyed = true;
        if (this._poller) {
            this._poller.stop();
        }
        if (this._unsubscribe) {
            this._unsubscribe();
            this._unsubscribe = null;
        }
        this._destroyMenu();
        if (this._manager) {
            this._manager.dispose();
        }
        if (this.settings) {
            this.settings.finalize();
        }
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
        TpuWorkloadApplet,
        defaultEnvironment,
        defaultLogger,
        main,
    };
}
