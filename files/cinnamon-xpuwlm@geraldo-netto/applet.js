"use strict";

const Applet = imports.ui.applet;
const Atk = imports.gi.Atk;
const ByteArray = imports.byteArray;
const Gettext = imports.gettext;
const Clutter = imports.gi.Clutter;
const GdkPixbuf = imports.gi.GdkPixbuf;
const Gdk = imports.gi.Gdk;
const Gio = imports.gi.Gio;
const GLib = imports.gi.GLib;
const Gtk = imports.gi.Gtk;
const Main = imports.ui.main;
const Mainloop = imports.mainloop;
const PopupMenu = imports.ui.popupMenu;
const Settings = imports.ui.settings;
const St = imports.gi.St;
const Tooltips = imports.ui.tooltips;
const Util = imports.misc.util;

const AlertNotifier = require("./lib/alert-notifier.js");
const CinnamonPlatform = require("./lib/cinnamon-platform-adapter.js");
const CinnamonPopup = require("./lib/cinnamon-popup-adapter.js");
const CinnamonRuntime = require("./lib/cinnamon-runtime.js");
const ClipboardSelectionPort = require("./lib/clipboard-selection-port.js");
const Domain = require("./lib/domain.js");
const ExternalChooser = require("./lib/external-chooser-port.js");
const FailureBackoff = require("./lib/failure-log-backoff.js");
const I18n = require("./lib/i18n.js");
const JobSubmission = require("./lib/job-submission.js");
const Layout = require("./lib/layout.js");
const Manager = require("./lib/manager.js");
const Menu = require("./lib/menu-view.js");
const PluginInventory = require("./lib/plugin-inventory.js");
const PlatformPorts = require("./lib/platform-ports.js");
const ViewModel = require("./lib/view-model.js");
const WorkloadRegistry = require("./lib/workload-registry.js");
const WorkflowWiring = require("./lib/workflow-wiring.js");

const {_} = I18n;

const UUID = "cinnamon-xpuwlm@geraldo-netto";
const PANEL_STATUSES = Object.freeze(["online", "attention", "detected", "paused", "unavailable"]);
const MIN_PANEL_ICON_SIZE = 32;

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
    return `xpuwlm-status-${safeStatus}-symbolic.svg`;
}

function panelIconName(status) {
    return panelIconFilename(status).slice(0, -4);
}

function panelIconSize(requestedSize) {
    return Number.isFinite(requestedSize) && requestedSize > 0
        ? Math.max(MIN_PANEL_ICON_SIZE, Math.floor(requestedSize))
        : MIN_PANEL_ICON_SIZE;
}

function defaultEnvironment() {
    return {ByteArray, Gdk, GdkPixbuf, Gio, GLib, Gtk};
}

function defaultLogger() {
    return CinnamonRuntime.createLogger("XPU Workload Manager");
}

function settingsInstanceId(metadata, instanceId) {
    const maximum = metadata && metadata["max-instances"];
    return maximum === 1 ? metadata.uuid : instanceId;
}

function createAppletSettings(owner, metadata, instanceId, overrides, environment) {
    if (overrides.settings) {
        return overrides.settings;
    }
    if (overrides.settingsFactory) {
        return overrides.settingsFactory(owner);
    }
    const currentIdentity = CinnamonRuntime.readCurrentIdentitySettings(
        metadata.uuid,
        settingsInstanceId(metadata, instanceId),
        environment,
    );
    const settings = new Settings.AppletSettings(owner, metadata.uuid, instanceId);
    CinnamonRuntime.migrateLegacyAppletSettings(settings, environment);
    CinnamonRuntime.restoreCurrentRefreshInterval(settings, currentIdentity);
    return settings;
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

class XpuWorkloadApplet extends Applet.TextIconApplet {
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
        this._eventUnsubscribe = null;
        this._documentUnsubscribe = null;
        this._selectedTextUnsubscribe = null;
        this._fileOrganizerUnsubscribe = null;
        this._mediaTranscriptionUnsubscribe = null;
        this._chooserLifecycle = null;
        this._chooserLaunchHandle = null;
        this._chooserFeedback = null;
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
        this._eventUnsubscribe = this._eventImport.subscribe(() => {
            if (this._latestState) {
                this._render(this._latestState);
            }
            this._restoreChooserFeedback(this._eventImport, this._eventImport.state().phase);
        });
        this._documentUnsubscribe = this._documentQuestion.subscribe(() => {
            if (this._latestState) {
                this._render(this._latestState);
            }
            this._restoreChooserFeedback(
                this._documentQuestion,
                this._documentQuestion.state().phase,
            );
        });
        this._selectedTextUnsubscribe = this._selectedText.subscribe(() => {
            if (this._latestState) {
                this._render(this._latestState);
            }
        });
        this._fileOrganizerUnsubscribe = this._fileOrganizer.subscribe(() => {
            if (this._latestState) {
                this._render(this._latestState);
            }
            this._restoreChooserFeedback(this._fileOrganizer, this._fileOrganizer.state().phase);
        });
        this._mediaTranscriptionUnsubscribe = this._mediaTranscription.subscribe(() => {
            if (this._latestState) {
                this._render(this._latestState);
            }
            this._restoreChooserFeedback(
                this._mediaTranscription,
                this._mediaTranscription.state().phase,
            );
        });
        this._manager.start();
        this._refreshEventAvailability();
        this._poller.start(this.refreshInterval);
    }

    _createSettings(metadata, instanceId, overrides) {
        this._environment = overrides.environment || defaultEnvironment();
        installTranslations(
            Object.hasOwn(overrides, "gettext") ? overrides.gettext : Gettext,
            this._environment,
        );
        this.settings = createAppletSettings(
            this,
            metadata,
            instanceId,
            overrides,
            this._environment,
        );
        this._bindSettings();
        this._registerIconPath();
        this.set_applet_icon_symbolic_name("xpuwlm-v2-symbolic");
        this._applyPanelIconSize(this._iconSize);
        this.set_applet_tooltip(_("XPU Workload Manager — starting"));
        this.actor.set_accessible_name(_("XPU Workload Manager, starting"));
    }

    _createServices(metadata, overrides) {
        this._workloadRegistry = resolveWorkloadRegistry(
            metadata,
            this._environment,
            overrides.workloadRegistry,
            this._logger,
        );
        this._workloadCatalog = resolveWorkloadCatalog(this._workloadRegistry);
        this._clock = overrides.clock || Date;
        this._platform = PlatformPorts.requirePlatformComposition(
            overrides.platform || CinnamonPlatform.createCinnamonPlatform({
                environment: this._environment,
                clock: this._clock,
                logger: this._logger,
                workloadCatalog: this._workloadCatalog,
            }),
        );
        this._runtimeGatewayFactory = overrides.runtimeGatewayFactory
            || ((path) => this._platform.discovery.createRuntimeGateway(path));
        this._repository = overrides.repository
            || CinnamonRuntime.createStateRepository(this._environment, this.settings);
        this._runtimeGateway = overrides.runtimeGateway
            || this._runtimeGatewayFactory(this.runtimeStatePath);
        this._scheduler = overrides.scheduler || new CinnamonRuntime.CinnamonScheduler(Mainloop);
        this._createControlPorts(overrides);
        this._createEventPorts(overrides);
        this._manager = this._createManager(overrides);
        this._notifier = this._createNotifier(overrides);
        this._poller = overrides.poller
            || new CinnamonRuntime.CinnamonPoller(Mainloop, () => this._refresh());
    }

    // All three ports address the same bus name: the control gateway changes
    // policy on it, the watch reports whether anything owns it, and the
    // contract gateway asks what the owner speaks before either is used.
    _createControlPorts(overrides) {
        this._controlGateway = overrides.controlGateway
            || this._platform.transport.createControlGateway();
        this._jobSubmitter = overrides.jobSubmitter || new JobSubmission.JobSubmitter({
            gateway: this._platform.transport.createJobGateway(),
            imagePort: CinnamonRuntime.createImagePort(this._environment),
            clock: overrides.clock || Date,
            paths: this._platform.paths,
        });
        this._inputCatalog = overrides.inputCatalog
            || this._platform.discovery.createInputCatalog();
        this._controlWatch = overrides.controlWatch
            || this._platform.transport.createControlWatch();
        this._contractGateway = overrides.contractGateway
            || this._platform.transport.createContractGateway();
    }

    _createEventPorts(overrides) {
        try {
            this._chooserLifecycle = ExternalChooser.requireChooserLifecycle(
                overrides.chooserLifecycle
                || new ExternalChooser.ExternalChooserLifecycle(this._environment),
            );
        } catch {
            this._chooserLifecycle = null;
        }
        this._pluginInventoryGateway = overrides.pluginInventoryGateway
            || this._platform.transport.createPluginInventoryGateway();
        const controllers = WorkflowWiring.createWorkflowControllers({
            environment: this._environment,
            chooserLifecycle: this._chooserLifecycle,
            scheduler: this._scheduler,
            clock: this._clock,
            paths: this._platform.paths,
            jobGatewayFactory: () => this._platform.transport.createJobGateway(),
            overrides,
        });
        this._eventImport = controllers.eventImport;
        this._documentQuestion = controllers.documentQuestion;
        this._selectedText = controllers.selectedText;
        this._fileOrganizer = controllers.fileOrganizer;
        this._mediaTranscription = controllers.mediaTranscription;
    }

    _createManager(overrides) {
        return overrides.manager || new Manager.WorkloadManager({
            repository: this._repository,
            runtimeGateway: this._runtimeGateway,
            contractGateway: this._contractGateway,
            controlGateway: this._controlGateway,
            controlWatch: this._controlWatch,
            jobSubmitter: this._jobSubmitter,
            inputCatalog: this._inputCatalog,
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
            || CinnamonPopup.createCenteredPopupMenuFactory({Applet, Main});
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
                actionScheduler: this._scheduler,
                actions: this._menuActions(),
                // A Cinnamon tooltip attaches itself to the actor and dies with
                // it, so the popup only has to hand over the pair.
                tooltips: overrides.tooltips
                    || ((actor, text) => new Tooltips.Tooltip(actor, text)),
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

    on_panel_icon_size_changed(size) {
        this._applyPanelIconSize(size);
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
            clearActivity: () => this._clearActivity(),
            openLogs: () => this._openLogs(),
            copyReport: (report) => this._copyReport(report),
            acknowledgeCatalogChanges: () => this._manager.acknowledgeCatalogChanges(),
            submitJob: (id, picture) => this._manager.submitJob(id, picture),
            chooseEventFiles: () => this._launchChooser(
                () => this._eventImport.chooseFiles(), this._eventImport, "selecting",
            ),
            chooseEventFolder: () => this._launchChooser(
                () => this._eventImport.chooseFolder(), this._eventImport, "selecting",
            ),
            startEventImport: () => this._eventImport.start(),
            cancelEventImport: () => this._eventImport.cancel(),
            editEventCandidate: (id, patch) => this._eventImport.edit(id, patch),
            decideEventCandidate: (id, decision) => this._eventImport.decide(id, decision),
            beginEventExport: () => this._eventImport.beginExport(),
            confirmEventExport: () => this._launchChooser(
                () => this._eventImport.confirmExport(), this._eventImport, "exporting",
            ),
            backEventPreview: () => this._eventImport.backToPreview(),
            resetEventImport: () => this._eventImport.reset(),
            chooseQuestionFiles: () => this._launchChooser(
                () => this._documentQuestion.chooseFiles(), this._documentQuestion, "selecting",
            ),
            startDocumentQuestion: (question) => this._documentQuestion.start(question),
            cancelDocumentQuestion: () => this._documentQuestion.cancel(),
            resetDocumentQuestion: () => this._documentQuestion.reset(),
            startSelectedText: (operation, language) => this._selectedText.start(operation, language),
            cancelSelectedText: () => this._selectedText.cancel(),
            resetSelectedText: () => this._selectedText.reset(),
            chooseOrganizerFiles: () => this._launchChooser(
                () => this._fileOrganizer.chooseFiles(), this._fileOrganizer, "selecting",
            ),
            startFileOrganizer: () => this._fileOrganizer.start(),
            cancelFileOrganizer: () => this._fileOrganizer.cancel(),
            resetFileOrganizer: () => this._fileOrganizer.reset(),
            chooseMediaFile: () => this._launchChooser(
                () => this._mediaTranscription.chooseFiles(),
                this._mediaTranscription,
                "selecting",
            ),
            startMediaTranscription: () => this._mediaTranscription.start(),
            cancelMediaTranscription: () => this._mediaTranscription.cancel(),
            resetMediaTranscription: () => this._mediaTranscription.reset(),
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
                    this._refreshEventAvailability();
                    // Input enumeration is asynchronous and starts only when
                    // somebody opens the popup, never on the poll interval.
                    this._manager.refreshInputs();
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
        this._latestState = {
            ...state,
            eventImport: this._eventImport.state(),
            documentQuestion: this._documentQuestion.state(),
            selectedText: this._selectedText.state(),
            fileOrganizer: this._fileOrganizer.state(),
            mediaTranscription: this._mediaTranscription.state(),
        };
        const model = ViewModel.toViewModel(
            this._latestState,
            Date.now(),
            this._platform.guidance,
        );
        if (this._view) {
            this._view.render(model);
        }
        this._renderPanel(model);
        this._notifier.observe(this._latestState.alerts, this._latestState.profiles);
    }

    _refreshEventAvailability() {
        if (this._destroyed) {
            return false;
        }
        try {
            return this._pluginInventoryGateway.describe((error, inventory) => {
                if (this._destroyed) {
                    return;
                }
                if (error) {
                    this._eventImport.setAvailability(false, _("Event provider is not ready"));
                    this._documentQuestion.setAvailability(false, _("Document provider is not ready"));
                    this._selectedText.setAvailability(false, _("Selected-text provider is not ready"));
                    this._fileOrganizer.setAvailability(false, _("File organizer provider is not ready"));
                    this._mediaTranscription.setAvailability(
                        false,
                        _("Media transcription provider is not ready"),
                    );
                    return;
                }
                const readiness = PluginInventory.eventReadiness(inventory);
                this._eventImport.setAvailability(readiness.available, readiness.detail);
                const documentReadiness = PluginInventory.documentQuestionReadiness(inventory);
                this._documentQuestion.setAvailability(
                    documentReadiness.available,
                    documentReadiness.detail,
                );
                const selectedTextReadiness = PluginInventory.selectedTextReadiness(inventory);
                this._selectedText.setAvailability(
                    selectedTextReadiness.available,
                    selectedTextReadiness.detail,
                );
                const fileOrganizerReadiness = PluginInventory.fileOrganizerReadiness(inventory);
                this._fileOrganizer.setAvailability(
                    fileOrganizerReadiness.available,
                    fileOrganizerReadiness.detail,
                );
                const mediaReadiness = PluginInventory.mediaTranscriptionReadiness(inventory);
                this._mediaTranscription.setAvailability(
                    mediaReadiness.available,
                    mediaReadiness.detail,
                );
            });
        } catch {
            this._eventImport.setAvailability(false, _("Event provider is not ready"));
            this._documentQuestion.setAvailability(false, _("Document provider is not ready"));
            this._selectedText.setAvailability(false, _("Selected-text provider is not ready"));
            this._fileOrganizer.setAvailability(false, _("File organizer provider is not ready"));
            this._mediaTranscription.setAvailability(
                false,
                _("Media transcription provider is not ready"),
            );
            return false;
        }
    }

    _renderPanel(model = null) {
        if (this._destroyed || (!model && !this._latestState)) {
            return;
        }
        const viewModel = model || ViewModel.toViewModel(
            this._latestState,
            Date.now(),
            this._platform.guidance,
        );
        this.set_applet_label(this.showPanelLabel ? viewModel.panel.label : "");
        this.set_applet_tooltip(viewModel.panel.tooltip);
        this.actor.set_accessible_name(viewModel.panel.accessibleName);
        this._setPanelIcon(viewModel.panel.status);
        for (const status of PANEL_STATUSES) {
            this.actor.remove_style_class_name(`xpuwlm-panel-${status}`);
        }
        this.actor.add_style_class_name(`xpuwlm-panel-${viewModel.panel.status}`);
    }

    _setPanelIcon(status) {
        const iconStatus = PANEL_STATUSES.includes(status) ? status : "unavailable";
        if (this._panelIconStatus === iconStatus) {
            return false;
        }
        this.set_applet_icon_symbolic_name(panelIconName(iconStatus));
        this._applyPanelIconSize(this._iconSize);
        this._panelIconStatus = iconStatus;
        return true;
    }

    _applyPanelIconSize(requestedSize) {
        const icon = this._applet_icon;
        if (!icon || typeof icon.set_icon_size !== "function") {
            return false;
        }
        const size = panelIconSize(requestedSize);
        if (typeof icon.get_icon_size === "function" && icon.get_icon_size() === size) {
            return false;
        }
        icon.set_icon_size(size);
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
        Util.spawnCommandLineAsync(`xlet-settings applet ${UUID} -i ${this.instance_id}`);
    }

    _clearActivity() {
        const results = [
            this._clearWorkflowHistory(this._eventImport),
            this._clearWorkflowHistory(this._documentQuestion),
            this._clearWorkflowHistory(this._selectedText),
            this._clearWorkflowHistory(this._fileOrganizer),
            this._clearWorkflowHistory(this._mediaTranscription),
            this._manager.clearActivity(),
        ];
        return results.some(Boolean);
    }

    _clearWorkflowHistory(controller) {
        const phase = controller.state().phase;
        return ["complete", "error"].includes(phase) ? controller.reset() : false;
    }

    _openLogs() {
        try {
            Util.spawnCommandLineAsync(
                "x-terminal-emulator -e journalctl --user -u omnitensor.service -f",
            );
            return true;
        } catch (error) {
            this._logger.warn(`Could not open workload service logs: ${error}`);
            return false;
        }
    }

    _copyReport(report) {
        try {
            if (typeof report !== "string" || report === "") {
                return false;
            }
            const clipboard = Gtk.Clipboard.get(
                ClipboardSelectionPort.clipboardAtom(this._environment),
            );
            clipboard.set_text(report, -1);
            if (typeof clipboard.store === "function") {
                clipboard.store();
            }
            return true;
        } catch (error) {
            this._logger.warn(`Could not copy diagnostics report: ${error}`);
            return false;
        }
    }

    _launchChooser(action, owner, pendingPhase) {
        if (this._destroyed || typeof action !== "function"
            || this._chooserLaunchHandle !== null) {
            return false;
        }
        if (!this.menu || this.menu.isOpen !== true || typeof this.menu.close !== "function") {
            return action();
        }
        this.menu.close(false);
        this._chooserFeedback = {owner, pendingPhase};
        this._chooserLaunchHandle = this._scheduler.schedule(0, () => {
            this._chooserLaunchHandle = null;
            if (!this._destroyed) {
                const launched = action();
                if (launched === false) {
                    this._restoreChooserFeedback(owner, "");
                }
            }
        });
        return true;
    }

    _restoreChooserFeedback(owner, currentPhase) {
        if (this._destroyed || this._chooserFeedback === null
            || owner !== this._chooserFeedback.owner
            || currentPhase === this._chooserFeedback.pendingPhase) {
            return false;
        }
        this._chooserFeedback = null;
        if (!this.menu || this.menu.isOpen === true || typeof this.menu.open !== "function") {
            return false;
        }
        this.menu.open(false);
        return true;
    }

    _cancelChooserLaunch() {
        if (this._chooserLaunchHandle === null) {
            return false;
        }
        const handle = this._chooserLaunchHandle;
        this._chooserLaunchHandle = null;
        return this._scheduler.cancel(handle);
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
        const eventUnsubscribe = this._eventUnsubscribe;
        const documentUnsubscribe = this._documentUnsubscribe;
        const selectedTextUnsubscribe = this._selectedTextUnsubscribe;
        const fileOrganizerUnsubscribe = this._fileOrganizerUnsubscribe;
        const mediaTranscriptionUnsubscribe = this._mediaTranscriptionUnsubscribe;
        const manager = this._manager;
        const notifier = this._notifier;
        const settings = this.settings;
        const chooserLifecycle = this._chooserLifecycle;
        this._poller = null;
        this._unsubscribe = null;
        this._eventUnsubscribe = null;
        this._documentUnsubscribe = null;
        this._selectedTextUnsubscribe = null;
        this._fileOrganizerUnsubscribe = null;
        this._mediaTranscriptionUnsubscribe = null;
        this._chooserLifecycle = null;
        this._chooserFeedback = null;
        this._runIsolated([
            ["stop the refresh timer", () => poller && poller.stop()],
            ["cancel a pending chooser launch", () => this._cancelChooserLaunch()],
            ["destroy open file choosers", () => chooserLifecycle && chooserLifecycle.dispose()],
            ["release the state subscription", () => unsubscribe && unsubscribe()],
            ["release the event subscription", () => eventUnsubscribe && eventUnsubscribe()],
            ["release the document subscription", () => documentUnsubscribe && documentUnsubscribe()],
            ["release the selected-text subscription", () => selectedTextUnsubscribe && selectedTextUnsubscribe()],
            ["release the file-organizer subscription", () => fileOrganizerUnsubscribe && fileOrganizerUnsubscribe()],
            ["release the media-transcription subscription", () => mediaTranscriptionUnsubscribe && mediaTranscriptionUnsubscribe()],
            ["cancel plug-in inventory", () => this._pluginInventoryGateway && this._pluginInventoryGateway.cancel()],
            ["destroy the popup menu", () => this._destroyMenu()],
            ["dispose the workload manager", () => manager && manager.dispose()],
            ["dispose event import", () => this._eventImport && this._eventImport.dispose()],
            ["dispose document question", () => this._documentQuestion && this._documentQuestion.dispose()],
            ["dispose selected-text tools", () => this._selectedText && this._selectedText.dispose()],
            ["dispose file organizer", () => this._fileOrganizer && this._fileOrganizer.dispose()],
            ["dispose media transcription", () => this._mediaTranscription && this._mediaTranscription.dispose()],
            ["dispose the alert notifier", () => notifier && notifier.dispose()],
            ["finalize the applet settings", () => settings && settings.finalize()],
        ]);
        this._latestState = null;
        return true;
    }
}

function main(metadata, orientation, panelHeight, instanceId) {
    return new XpuWorkloadApplet(metadata, orientation, panelHeight, instanceId);
}

if (typeof module !== "undefined") {
    module.exports = {
        UUID,
        MIN_PANEL_ICON_SIZE,
        PANEL_STATUSES,
        XpuWorkloadApplet,
        createAppletSettings,
        defaultEnvironment,
        defaultLogger,
        installTranslations,
        main,
        panelIconFilename,
        panelIconName,
        panelIconSize,
        resolveWorkloadCatalog,
        resolveWorkloadRegistry,
        settingsInstanceId,
        unavailableEventFilePorts: WorkflowWiring.unavailableEventFilePorts,
        unavailableDocumentPicker: WorkflowWiring.unavailableDocumentPicker,
        unavailableClipboardReader: WorkflowWiring.unavailableClipboardReader,
    };
}
