"use strict";

const Applet = imports.ui.applet;
const Atk = imports.gi.Atk;
const ByteArray = imports.byteArray;
const Gettext = imports.gettext;
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
const Domain = require("./lib/domain.js");
const FailureBackoff = require("./lib/failure-log-backoff.js");
const I18n = require("./lib/i18n.js");
const Layout = require("./lib/layout.js");
const Manager = require("./lib/manager.js");
const Menu = require("./lib/menu-view.js");
const ViewModel = require("./lib/view-model.js");
const WorkloadRegistry = require("./lib/workload-registry.js");

const {_} = I18n;

const UUID = "cinnamon-tpuwm@geraldo-netto";
const PANEL_STATUSES = Object.freeze(["online", "attention", "detected", "paused", "unavailable"]);

// Binds the applet UUID text domain and routes the shared translation port
// through GJS gettext. Absent gettext (test harnesses) keeps the identity
// fallback, so English msgids remain the untranslated UI.
function installTranslations(gettextModule, environment) {
    if (!gettextModule || typeof gettextModule.dgettext !== "function") {
        return false;
    }
    if (typeof gettextModule.bindtextdomain === "function") {
        gettextModule.bindtextdomain(UUID, `${environment.GLib.get_home_dir()}/.local/share/locale`);
    }
    I18n.install({
        translate: (msgid) => gettextModule.dgettext(UUID, msgid),
        translatePlural: (singular, plural, count) => (
            typeof gettextModule.dngettext === "function"
                ? gettextModule.dngettext(UUID, singular, plural, count)
                : I18n.identityTranslatePlural(singular, plural, count)
        ),
    });
    return true;
}

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

function resolveWorkloadCatalog(workloadRegistry) {
    return new Domain.WorkloadCatalog(WorkloadRegistry.profileDefinitions(workloadRegistry));
}

function resolveWorkloadRegistry(metadata, environment, override, logger = defaultLogger()) {
    return override || CinnamonRuntime.createMergedWorkloadRegistry({
        bundledRoot: `${metadata.path}/workloads`,
        environment,
        uuid: UUID,
        logger,
    });
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
        this._createSettings(metadata, instanceId, overrides);
        this._createServices(metadata, overrides);
        this._createPresentation(overrides);
        this._unsubscribe = this._manager.subscribe((state) => this._render(state));
        this._manager.start();
        this._poller.start(this.refreshInterval);
    }

    _createSettings(metadata, instanceId, overrides) {
        this._environment = overrides.environment || defaultEnvironment();
        installTranslations(
            Object.hasOwn(overrides, "gettext") ? overrides.gettext : Gettext,
            this._environment,
        );
        this.settings = overrides.settings
            || (overrides.settingsFactory
                ? overrides.settingsFactory(this)
                : new Settings.AppletSettings(this, metadata.uuid, instanceId));
        this._bindSettings();
        this._registerIconPath();
        this.set_applet_icon_symbolic_path(`${metadata.path}/icons/tpuwm-symbolic-v2.svg`);
        this.set_applet_tooltip(_("TPU Workload Manager — starting"));
        this.actor.set_accessible_name(_("TPU Workload Manager, starting"));
    }

    _createServices(metadata, overrides) {
        this._workloadRegistry = resolveWorkloadRegistry(
            metadata,
            this._environment,
            overrides.workloadRegistry,
            this._logger,
        );
        this._workloadCatalog = resolveWorkloadCatalog(this._workloadRegistry);
        this._runtimeGatewayFactory = overrides.runtimeGatewayFactory
            || ((path) => CinnamonRuntime.createRuntimeGateway({
                path,
                environment: this._environment,
                logger: this._logger,
                workloadCatalog: this._workloadCatalog,
            }));
        this._repository = overrides.repository
            || CinnamonRuntime.createStateRepository(this._environment, this.settings);
        this._runtimeGateway = overrides.runtimeGateway
            || this._runtimeGatewayFactory(this.runtimeStatePath);
        this._createControlPorts(overrides);
        this._clock = overrides.clock || Date;
        this._scheduler = overrides.scheduler || new CinnamonRuntime.CinnamonScheduler(Mainloop);
        this._manager = this._createManager(overrides);
        this._notifier = this._createNotifier(overrides);
        this._poller = overrides.poller
            || new CinnamonRuntime.CinnamonPoller(Mainloop, () => this._refresh());
    }

    // Both control ports address the same bus name: the gateway calls it, the
    // watch reports whether anything owns it.
    _createControlPorts(overrides) {
        this._controlGateway = overrides.controlGateway
            || CinnamonRuntime.createRuntimeControlGateway(this._environment);
        this._controlWatch = overrides.controlWatch
            || CinnamonRuntime.createControlServiceWatch(this._environment);
    }

    _createManager(overrides) {
        return overrides.manager || new Manager.WorkloadManager({
            repository: this._repository,
            runtimeGateway: this._runtimeGateway,
            controlGateway: this._controlGateway,
            controlWatch: this._controlWatch,
            errorReporter: overrides.errorReporter
                || new FailureBackoff.FailureErrorBackoff({logger: this._logger}),
            logger: this._logger,
            clock: this._clock,
            scheduler: this._scheduler,
            workloadRegistry: this._workloadRegistry,
        });
    }

    _createNotifier(overrides) {
        return overrides.notifier || new AlertNotifier.CriticalAlertNotifier({
            notifications: overrides.notifications
                || CinnamonRuntime.createCriticalNotifications(Main),
            errorReporter: overrides.notificationReporter
                || new FailureBackoff.FailureErrorBackoff({logger: this._logger}),
            clock: this._clock,
        });
    }

    _createPresentation(overrides) {
        this._menuFactory = overrides.menuFactory
            || ((applet, menuOrientation) => new Applet.AppletPopupMenu(applet, menuOrientation));
        this._menuManagerFactory = overrides.menuManagerFactory
            || ((applet) => new PopupMenu.PopupMenuManager(applet));
        this._layoutProvider = overrides.layoutProvider
            || CinnamonRuntime.createLayoutProvider({Main, St});
        // Cinnamon constructs the applet before adding its actor to the stage.
        // Measuring here makes findMonitorForActor query an unstaged widget and
        // emits St-CRITICAL messages. The popup re-measures when it opens.
        this._layout = Layout.defaultLayout();
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
        this._createMenu(this._orientation);
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
            acknowledgeCatalogChanges: () => this._manager.acknowledgeCatalogChanges(),
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
        installTranslations,
        main,
        panelIconFilename,
        resolveWorkloadCatalog,
        resolveWorkloadRegistry,
    };
}
