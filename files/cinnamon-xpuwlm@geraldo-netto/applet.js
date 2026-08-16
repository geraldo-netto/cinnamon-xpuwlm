"use strict";

// The Cinnamon helper: a panel presence and a way into the client.
//
// This applet used to be the product — workload screens, workflow forms,
// policy controls, a hand-written mirror of every runtime contract, all in
// GJS. All of that now lives in the Python client (`../xpuwlm`), which owns
// its own window, its own GTK, and its own validation against the canonical
// schemas. What a panel is genuinely good at is what is left here: showing at
// a glance whether the accelerator is working and whether anything is
// waiting, and opening the thing that can do something about it.
//
// The helper never talks to the runtime's socket. It reads the published
// snapshot file, because drawing an icon must not cost a round trip, and it
// starts the client with one spawn per user action. Two directions, no third
// contract to keep in parity.

const Applet = imports.ui.applet;
const Atk = imports.gi.Atk;
const ByteArray = imports.byteArray;
const Gettext = imports.gettext;
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

const I18n = require("./lib/i18n.js");
const PanelStatus = require("./lib/panel-status.js");
const SnapshotReader = require("./lib/snapshot-reader.js");
const XpuwlmLauncher = require("./lib/xpuwlm-launcher.js");

const {_, format} = I18n;

const UUID = "cinnamon-xpuwlm@geraldo-netto";
const DEFAULT_PANEL_ICON_SIZE = 32;
// Not 1: an icon Cinnamon sizes to its zone preference is drawn smaller than
// every systray neighbour, and the status shape is the entire message now that
// the panel carries no text.
const MIN_PANEL_ICON_SIZE = 28;
const DEFAULT_REFRESH_SECONDS = 2;
const MIN_REFRESH_SECONDS = 1;
const MAX_REFRESH_SECONDS = 60;

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

// Cinnamon's panel-zone preference still asks for 16 pixels on a 40-pixel
// panel, which draws this glyph noticeably smaller than the systray icons
// beside it. The floor is what keeps a compact status shape legible without
// touching the panel's own height, which is the user's setting, not ours.
function panelIconSize(requestedSize) {
    const requested = Number.isFinite(requestedSize) && requestedSize > 0
        ? Math.floor(requestedSize)
        : DEFAULT_PANEL_ICON_SIZE;
    return Math.max(MIN_PANEL_ICON_SIZE, requested);
}

function refreshSeconds(requestedSeconds) {
    if (!Number.isFinite(requestedSeconds)) {
        return DEFAULT_REFRESH_SECONDS;
    }
    return Math.max(MIN_REFRESH_SECONDS, Math.min(MAX_REFRESH_SECONDS, Math.floor(requestedSeconds)));
}

function defaultEnvironment() {
    return {
        GLib,
        Gio,
        decode: (contents) => ByteArray.toString(contents),
    };
}

function defaultLogger() {
    return {warn: (message) => global.logWarning(`[${UUID}] ${message}`)};
}

function settingsInstanceId(metadata, instanceId) {
    return metadata && metadata["max-instances"] === 1 ? UUID : instanceId;
}

function createAppletSettings(owner, metadata, instanceId, overrides, environment) {
    if (overrides && overrides.settings) {
        return overrides.settings;
    }
    return new Settings.AppletSettings(owner, UUID, settingsInstanceId(metadata, instanceId), environment);
}

class XpuWorkloadApplet extends Applet.TextIconApplet {
    constructor(metadata, orientation, panelHeight, instanceId, overrides = {}) {
        super(orientation, panelHeight, instanceId);
        this._metadata = metadata;
        this._orientation = orientation;
        this._destroyed = false;
        this._timer = null;
        this._state = SnapshotReader.EMPTY_STATE;
        this._panelIconStatus = null;
        this._iconSize = overrides.iconSize || DEFAULT_PANEL_ICON_SIZE;
        this._lineItems = [];
        this._environment = overrides.environment || defaultEnvironment();
        this._logger = overrides.logger || defaultLogger();
        this._now = overrides.now || (() => Date.now());
        this._launcher = overrides.launcher || XpuwlmLauncher.createLauncher(
            this._environment,
            (commandLine) => Util.spawnCommandLineAsync(commandLine),
            this._logger,
        );
        this.settings = null;
        this.menu = null;
        this.menuManager = null;
        try {
            this._construct(metadata, instanceId, overrides);
        } catch (error) {
            // A half-built applet must not stay in the panel holding a timer
            // or a settings binding.
            this._teardown();
            throw error;
        }
    }

    _construct(metadata, instanceId, overrides) {
        this._registerIconPath(metadata, overrides);
        this._createSettings(metadata, instanceId, overrides);
        this._createPresentation(overrides);
        this.refresh();
        this._startTimer();
    }

    // Without this the payload's icons are not in the icon theme, so Cinnamon
    // cannot recolour them: the chip drew in the symbolic fallback grey, which
    // on a dark panel is nearly the background, leaving only the small green
    // status mark visible beside 32-pixel neighbours. Appended once, and only
    // when absent, so a reload does not grow the search path.
    _registerIconPath(metadata, overrides) {
        const iconTheme = (overrides && overrides.iconTheme) || Gtk.IconTheme.get_default();
        const iconPath = `${metadata.path}/icons`;
        if (!iconTheme.get_search_path().includes(iconPath)) {
            iconTheme.append_search_path(iconPath);
        }
    }

    _createSettings(metadata, instanceId, overrides) {
        this.settings = createAppletSettings(this, metadata, instanceId, overrides, this._orientation);
        this._refreshInterval = DEFAULT_REFRESH_SECONDS;
        this._runtimeStatePath = SnapshotReader.RUNTIME_STATE_PATH;
        this.settings.bind("refresh-interval", "_refreshInterval", () => this._startTimer());
        this.settings.bind("runtime-state-path", "_runtimeStatePath", () => this.refresh());
    }

    _createPresentation(overrides) {
        this.menuManager = overrides.menuManager || new PopupMenu.PopupMenuManager(this);
        this.menu = overrides.menu || new Applet.AppletPopupMenu(this, this._orientation);
        this.menuManager.addMenu(this.menu);
        this._tooltip = overrides.tooltip || new Tooltips.PanelItemTooltip(this, "", this._orientation);
        this.actor.set_accessible_role(Atk.Role.PUSH_BUTTON);
        this._buildMenu();
    }

    // Read-only lines, then the one action. The order is deliberate: what is
    // wrong is above the way to fix it.
    _buildMenu() {
        this._lineItems = [];
        for (let index = 0; index < 5; index += 1) {
            const item = new PopupMenu.PopupMenuItem("", {reactive: false});
            this._lineItems.push(item);
            this.menu.addMenuItem(item);
        }
        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        const open = new PopupMenu.PopupIconMenuItem(
            _("Open XPU Workload Manager"),
            "system-run-symbolic",
            St.IconType.SYMBOLIC,
        );
        open.connect("activate", () => this._launch());
        this.menu.addMenuItem(open);
    }

    // The client owns its window and its errors, so a launch reports that it
    // started, never that it worked. Saying more than that from a panel means
    // waiting on a process the panel does not own.
    _launch() {
        this.menu.close();
        if (!this._launcher.launch("ui")) {
            Main.notify(
                _("XPU Workload Manager"),
                _("Could not start the client. Is xpuwlm installed?"),
            );
        }
    }

    refresh() {
        if (this._destroyed) {
            return;
        }
        this._state = SnapshotReader.readSnapshot(
            this._environment,
            this._runtimeStatePath || SnapshotReader.RUNTIME_STATE_PATH,
            this._now(),
        );
        this._render();
    }

    _render() {
        const model = PanelStatus.panelModel(this._state);
        this._setPanelIcon(model.status);
        // No text in the panel. The icon carries the status — five distinct
        // shapes in the desktop's own symbolic colours — and a word beside it
        // repeats that in a strip where every pixel is contested. What the
        // words are for is the tooltip, the accessible name, and the popup.
        this._tooltip.set_text(model.tooltip);
        this.actor.set_accessible_name(model.accessibleName);
        const lines = PanelStatus.popupLines(this._state);
        this._lineItems.forEach((item, index) => {
            const line = lines[index];
            item.actor.visible = line !== undefined;
            if (line !== undefined) {
                item.label.set_text(format(_("%s: %s"), line.label, line.value));
            }
        });
    }

    _setPanelIcon(status) {
        if (status === this._panelIconStatus) {
            return;
        }
        // The status class is what the stylesheet colours, so it is swapped
        // with the icon rather than left behind on the previous status.
        if (this._panelIconStatus !== null) {
            this.actor.remove_style_class_name(`xpuwlm-panel-${this._panelIconStatus}`);
        }
        this._panelIconStatus = status;
        this.actor.add_style_class_name(`xpuwlm-panel-${status}`);
        this.set_applet_icon_symbolic_name(PanelStatus.panelIconName(status));
        this._applyPanelIconSize(this._iconSize);
    }

    // Setting the icon replaces the actor's size, so the size is re-applied
    // after every status change rather than once at construction.
    //
    // Both paths are used deliberately. `set_icon_size` is the property, and
    // the desktop theme's own `.applet-icon { icon-size: ... }` rule overrides
    // it — which is why this glyph drew at 14 pixels beside 32-pixel systray
    // neighbours. An inline style is the one declaration a stylesheet cannot
    // outrank, so it is what actually decides the size.
    _applyPanelIconSize(requestedSize) {
        const icon = this._applet_icon;
        if (!icon || typeof icon.set_icon_size !== "function") {
            return false;
        }
        const size = panelIconSize(requestedSize);
        icon.set_icon_size(size);
        if (typeof icon.set_style === "function") {
            icon.set_style(`icon-size: ${size}px;`);
        }
        return true;
    }

    on_panel_icon_size_changed(size) {
        this._iconSize = size;
        this._applyPanelIconSize(size);
    }

    _startTimer() {
        this._stopTimer();
        if (this._destroyed) {
            return;
        }
        this._timer = Mainloop.timeout_add_seconds(refreshSeconds(this._refreshInterval), () => {
            this.refresh();
            return true;
        });
    }

    _stopTimer() {
        if (this._timer !== null) {
            Mainloop.source_remove(this._timer);
            this._timer = null;
        }
    }

    on_applet_clicked() {
        this.menu.toggle();
    }

    on_panel_height_changed() {
        this._panelIconStatus = null;
        this._render();
    }

    on_applet_removed_from_panel() {
        this._teardown();
    }

    _teardown() {
        this._destroyed = true;
        this._stopTimer();
        if (this.settings && typeof this.settings.finalize === "function") {
            this.settings.finalize();
        }
        if (this.menu && typeof this.menu.destroy === "function") {
            this.menu.destroy();
        }
    }
}

function main(metadata, orientation, panelHeight, instanceId) {
    installTranslations(Gettext, {GLib});
    return new XpuWorkloadApplet(metadata, orientation, panelHeight, instanceId);
}

if (typeof module !== "undefined") {
    module.exports = {
        DEFAULT_PANEL_ICON_SIZE,
        DEFAULT_REFRESH_SECONDS,
        MAX_REFRESH_SECONDS,
        MIN_PANEL_ICON_SIZE,
        MIN_REFRESH_SECONDS,
        UUID,
        XpuWorkloadApplet,
        createAppletSettings,
        defaultEnvironment,
        defaultLogger,
        installTranslations,
        main,
        panelIconSize,
        refreshSeconds,
        settingsInstanceId,
    };
}
