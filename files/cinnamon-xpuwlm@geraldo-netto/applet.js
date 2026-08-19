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

const PanelStatus = require("./lib/panel-status.js");
const SettingsWindowPlacer = require("./lib/settings-window-placer.js");
const SnapshotReader = require("./lib/snapshot-reader.js");
const WindowPlacement = require("./lib/window-placement.js");
const XpuwlmLauncher = require("./lib/xpuwlm-launcher.js");

const UUID = "cinnamon-xpuwlm@geraldo-netto";
const DEFAULT_PANEL_ICON_SIZE = 32;
// Not 1: an icon Cinnamon sizes to its zone preference is drawn smaller than
// every systray neighbour, and the status shape is the entire message now that
// the panel carries no text.
const MIN_PANEL_ICON_SIZE = 28;
// The shipped default lives in settings-schema.json; this is only the value
// the applet holds between construction and the first binding, so the two
// have to agree or the panel refreshes at a rate nothing configured.
const DEFAULT_REFRESH_SECONDS = 1;
const MIN_REFRESH_SECONDS = 1;
const MAX_REFRESH_SECONDS = 60;

// Cinnamon's panel-zone preference still asks for 16 pixels on a 40-pixel
// panel, which draws this glyph noticeably smaller than the systray icons
// beside it. The floor is what keeps a compact status shape legible without
// touching the panel's own height, which is the user's setting, not ours.
//
// Which is also why the floor is bounded by that height: Cinnamon allows a
// panel down to 20 pixels, and an unconditional 28 would ask such a panel to
// draw an icon taller than the strip it sits in — through an inline
// `icon-size` style, the one declaration the theme cannot outrank. The floor
// raises a small icon; it never overflows a small panel.
function panelIconSize(requestedSize, panelHeight) {
    const requested = Number.isFinite(requestedSize) && requestedSize > 0
        ? Math.floor(requestedSize)
        : DEFAULT_PANEL_ICON_SIZE;
    const floor = Number.isFinite(panelHeight) && panelHeight > 0
        ? Math.min(MIN_PANEL_ICON_SIZE, Math.floor(panelHeight))
        : MIN_PANEL_ICON_SIZE;
    return Math.max(floor, requested);
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

// Cinnamon's AppletSettings takes the xlet, the UUID and the instance id, and
// nothing else. A fourth argument used to be passed here — the panel
// orientation, under a parameter named `environment` — which the constructor
// discarded while the call site read as though settings needed one.
function createAppletSettings(owner, metadata, instanceId, overrides) {
    if (overrides && overrides.settings) {
        return overrides.settings;
    }
    return new Settings.AppletSettings(owner, UUID, settingsInstanceId(metadata, instanceId));
}

class XpuWorkloadApplet extends Applet.TextIconApplet {
    constructor(metadata, orientation, panelHeight, instanceId, overrides = {}) {
        super(orientation, panelHeight, instanceId);
        this._metadata = metadata;
        this._orientation = orientation;
        this._destroyed = false;
        this._timer = null;
        this._reading = false;
        this._state = SnapshotReader.EMPTY_STATE;
        this._panelIconStatus = null;
        // What is on the actor, as opposed to what was last drawn: a panel
        // height change forgets the second to force a redraw, and the class
        // still has to be taken off whatever it was applied for.
        this._panelIconClass = null;
        this._iconSize = overrides.iconSize || DEFAULT_PANEL_ICON_SIZE;
        // Cinnamon's own Applet keeps `_panelHeight` current across a height
        // change; a harness whose base class does not is given the height this
        // applet was constructed with, which is the same number.
        if (!Number.isFinite(this._panelHeight)) {
            this._panelHeight = panelHeight;
        }
        this._lineItems = [];
        this._adoptPorts(overrides);
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

    // Everything the applet talks to the desktop through, and the doubles a
    // test hands in instead. Collected in one place so the constructor reads
    // as what it is: ports, then construction, then the first draw.
    _adoptPorts(overrides) {
        this._environment = overrides.environment || defaultEnvironment();
        this._logger = overrides.logger || defaultLogger();
        this._now = overrides.now || (() => Date.now());
        this._settingsPlacer = overrides.settingsPlacer
            || SettingsWindowPlacer.createSettingsWindowPlacer({
                logger: this._logger,
                placement: WindowPlacement,
            });
        this._launcher = overrides.launcher || XpuwlmLauncher.createLauncher(
            this._environment,
            (commandLine) => Util.spawnCommandLineAsync(commandLine),
            this._logger,
        );
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
        this.settings = createAppletSettings(this, metadata, instanceId, overrides);
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
        for (let index = 0; index < PanelStatus.MAX_POPUP_LINES; index += 1) {
            const item = new PopupMenu.PopupMenuItem("", {reactive: false});
            this._lineItems.push(item);
            this.menu.addMenuItem(item);
        }
        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        const open = new PopupMenu.PopupIconMenuItem(
            "Open XPU Workload Manager",
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
                "XPU Workload Manager",
                "Could not start the client. Is xpuwlm installed?",
            );
        }
    }

    // Asked for, not waited on. The applet runs on the compositor thread, so a
    // blocking read of a document that grows with the host would stall the
    // desktop once a tick; the bytes arrive on a callback instead. A tick that
    // finds the previous read still outstanding is dropped rather than queued,
    // because two reads in flight would draw the older answer last.
    refresh() {
        if (this._destroyed || this._reading) {
            return;
        }
        this._reading = true;
        SnapshotReader.readSnapshotAsync(
            this._environment,
            this._runtimeStatePath || SnapshotReader.RUNTIME_STATE_PATH,
            this._now(),
            (state) => this._receiveState(state),
        );
    }

    // The read outlives the turn that started it, so an applet removed from
    // the panel while one was in flight neither keeps the answer nor draws it.
    // `_render` refuses the draw on its own; this is about the state.
    _receiveState(state) {
        this._reading = false;
        if (this._destroyed) {
            return;
        }
        this._state = state;
        this._render();
    }

    // Guarded here rather than at each caller: Cinnamon broadcasts a height
    // change and an icon-size change to every applet a panel still holds,
    // including one it is in the middle of removing, and both reach the actor,
    // the tooltip and the popup items. After teardown those are destroyed.
    _render() {
        if (this._destroyed) {
            return false;
        }
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
                item.label.set_text(`${line.label}: ${line.value}`);
            }
        });
        return true;
    }

    _setPanelIcon(status) {
        if (status === this._panelIconStatus) {
            return;
        }
        // The status class is what the stylesheet colours, so it is swapped
        // with the icon rather than left behind on the previous status.
        if (this._panelIconClass !== null) {
            this.actor.remove_style_class_name(this._panelIconClass);
        }
        this._panelIconStatus = status;
        this._panelIconClass = `xpuwlm-panel-${status}`;
        this.actor.add_style_class_name(this._panelIconClass);
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
        const icon = this._destroyed ? null : this._applet_icon;
        if (!icon || typeof icon.set_icon_size !== "function") {
            return false;
        }
        const size = panelIconSize(requestedSize, this._panelHeight);
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

    // Cinnamon's own "Configure…", which spawns a window it never places: it
    // sets a size and leaves the position to the window manager, which opens
    // it in a corner while the applet it configures sits at the other end of
    // the panel. The client's windows centre themselves, so this one does too.
    configureApplet(tab = 0) {
        this._placeSettingsWindow();
        super.configureApplet(tab);
    }

    // The waiting itself — the display handler and the mainloop sources it
    // arms — belongs to a collaborator that can be cancelled, because all of
    // it outlives the turn that started it and `global.display` outlives the
    // applet.
    _placeSettingsWindow(display = global.display, mainloop = Mainloop) {
        return this._settingsPlacer.awaitWindow(display, mainloop);
    }

    on_panel_height_changed() {
        this._panelIconStatus = null;
        this._render();
    }

    on_applet_removed_from_panel() {
        this._teardown();
    }

    // Reachable twice: the constructor releases what it managed to build when
    // construction fails, and Cinnamon calls back when the applet leaves the
    // panel. Finalizing a settings binding, removing a menu from its manager,
    // or destroying a menu and a tooltip a second time acts on objects that
    // are already gone, so the flag the applet already keeps is consulted
    // rather than only written.
    _teardown() {
        if (this._destroyed) {
            return false;
        }
        this._destroyed = true;
        this._stopTimer();
        this._settingsPlacer.cancel();
        if (this.settings && typeof this.settings.finalize === "function") {
            this.settings.finalize();
        }
        this._releasePresentation();
        return true;
    }

    // What setup created, teardown releases: `removeMenu` is what disconnects
    // the menu manager's own signals on the menu and its source actor, and the
    // tooltip arms mainloop timers of its own.
    _releasePresentation() {
        if (this.menuManager && this.menu && typeof this.menuManager.removeMenu === "function") {
            this.menuManager.removeMenu(this.menu);
        }
        if (this.menu && typeof this.menu.destroy === "function") {
            this.menu.destroy();
        }
        if (this._tooltip && typeof this._tooltip.destroy === "function") {
            this._tooltip.destroy();
        }
        return true;
    }
}

function main(metadata, orientation, panelHeight, instanceId) {
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
        main,
        panelIconSize,
        refreshSeconds,
        settingsInstanceId,
    };
}
