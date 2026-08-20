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

const PanelIcon = require("./lib/panel-icon.js");
const PanelStatus = require("./lib/panel-status.js");
const SettingsWindowPlacer = require("./lib/settings-window-placer.js");
const SnapshotReader = require("./lib/snapshot-reader.js");
const WindowPlacement = require("./lib/window-placement.js");
const XpuwlmLauncher = require("./lib/xpuwlm-launcher.js");

const UUID = "cinnamon-xpuwlm@geraldo-netto";
// The shipped default lives in settings-schema.json; this is only the value
// the applet holds between construction and the first binding, so the two
// have to agree or the panel refreshes at a rate nothing configured.
const DEFAULT_REFRESH_SECONDS = 1;
const MIN_REFRESH_SECONDS = 1;
const MAX_REFRESH_SECONDS = 60;

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

// Every release, whatever the one before it did.
//
// Teardown exists so that an applet leaving the panel gives back everything it
// took. Written as a run of bare statements it gave back everything up to the
// first one that threw, and stranded the rest for the life of the session: a
// placer whose display handler Cinnamon had already dropped took the icon
// search path with it, so the session's icon theme went on naming a directory
// that leaves with the uninstall; a settings binding that refused to finalize
// took the menu, the menu manager's signals and the tooltip's mainloop timers
// with it. Each release is asked for on its own and every failure is named,
// because a teardown whose whole point is that one failure must not strand the
// rest cannot be a sequence that stops at the first.
function releaseEach(logger, releases) {
    let released = true;
    for (const [subject, release] of releases) {
        try {
            release();
        } catch (error) {
            released = false;
            logger?.warn(`could not release ${subject} at teardown: ${error}`);
        }
    }
    return released;
}

class XpuWorkloadApplet extends Applet.TextIconApplet {
    constructor(metadata, orientation, panelHeight, instanceId, overrides = {}) {
        super(orientation, panelHeight, instanceId);
        this._metadata = metadata;
        this._orientation = orientation;
        this._destroyed = false;
        this._timer = null;
        this._reading = false;
        // When the outstanding read was asked for, so a read that never
        // answers can be told from one that has only just been started, and
        // what it was asked for: a read that never answers is the one failure
        // where naming the file matters most, and the applet is what holds the
        // path while nothing comes back from the read that would carry it.
        this._readingSince = 0;
        this._readingTarget = "";
        this._state = SnapshotReader.EMPTY_STATE;
        this._panelIconStatus = null;
        // What is on the actor, as opposed to what was last drawn: a panel
        // height change forgets the second to force a redraw, and the class
        // still has to be taken off whatever it was applied for.
        this._panelIconClass = null;
        // No size until Cinnamon reports one. The default belongs to the icon
        // module, which is where the panel's height can bound it: seeded here
        // it was a number chosen without the panel, and a 20-pixel panel drew
        // a 32-pixel glyph from construction until the first size change.
        this._iconSize = overrides.iconSize || null;
        // Cinnamon's own Applet keeps `_panelHeight` current across a height
        // change; a harness whose base class does not is given the height this
        // applet was constructed with, which is the same number.
        if (!Number.isFinite(this._panelHeight)) {
            this._panelHeight = panelHeight;
        }
        this._lineItems = [];
        // What each surface was last written with, so a tick that changes
        // nothing writes nothing. Counted before this existed: ten thousand
        // ticks of an unchanged snapshot issued one tooltip write, one
        // accessible-name write and five popup-label writes each — seven a
        // second at the shipped interval — while the icon and its style class
        // were written zero times, because those two were the only writes
        // `_render` guarded. `St.Label.set_text` has no equality check of its
        // own, so an identical string still throws away a Pango layout and
        // asks for a relayout, five of them inside a popup that is closed.
        this._drawnTooltip = null;
        this._drawnAccessibleName = null;
        this._drawnLines = [];
        // Nulled before construction can throw: teardown releases the search
        // path, and it runs whether or not the registration was ever made.
        this._iconSearchPath = null;
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

    // The rules and the ownership are `lib/panel-icon.js`'s; what the applet
    // holds is when they happen — appended as it is built, taken back as it
    // leaves the panel.
    _registerIconPath(metadata, overrides) {
        this._iconSearchPath = PanelIcon.createIconSearchPath(
            (overrides && overrides.iconTheme) || Gtk.IconTheme.get_default(),
            `${metadata.path}/icons`,
        );
        return this._iconSearchPath.register();
    }

    _releaseIconPath() {
        return this._iconSearchPath !== null && this._iconSearchPath.release();
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
        this._drawnLines = [];
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
        if (this._destroyed) {
            return false;
        }
        this.menu.close();
        if (!this._launcher.launch("ui")) {
            Main.notify(PanelStatus.LAUNCH_FAILURE.title, PanelStatus.LAUNCH_FAILURE.body);
        }
        return true;
    }

    // The file the panel is reading now. An empty setting is the shipped
    // default rather than a path nothing can read: the entry is a text field,
    // and a person who clears it has asked for the default back.
    _statePath() {
        return this._runtimeStatePath || SnapshotReader.RUNTIME_STATE_PATH;
    }

    // Asked for, not waited on. The applet runs on the compositor thread, so a
    // blocking read of a document that grows with the host would stall the
    // desktop once a tick; the bytes arrive on a callback instead. A tick that
    // finds the previous read still outstanding is dropped rather than queued,
    // because two reads in flight would draw the older answer last.
    refresh() {
        if (this._destroyed) {
            return false;
        }
        if (this._reading) {
            return this._reportUnansweredRead();
        }
        const target = this._statePath();
        this._reading = true;
        this._readingSince = this._now();
        this._readingTarget = target;
        // The clock, not a reading of it: the answer is judged for staleness
        // when its bytes arrive, which is not the turn that asked for them.
        SnapshotReader.readSnapshotAsync(
            this._environment,
            target,
            this._now,
            (state) => this._receiveState(state, target),
        );
        return true;
    }

    // A read that never answers is a fact the panel has to draw. `_reading` is
    // lowered by the answer and by nothing else, so a `load_contents_async`
    // whose callback never arrives — a stalled network mount, a reply that is
    // lost — has every later tick dropped as "a read is already in flight",
    // and the panel goes on showing "online, 3 running" for a runtime that
    // stopped an hour ago. The read is still owned by the mainloop and is
    // still the one that will lower the latch; what changes is that the wait
    // stops being invisible.
    _reportUnansweredRead() {
        const waited = this._now() - this._readingSince;
        if (waited <= SnapshotReader.STALE_AFTER_MS) {
            return false;
        }
        // Named the same way every other failure names its file: the reader
        // resolves the path, so the popup shows the one a read was attempted
        // on rather than a second, hand-expanded copy of it. A state built
        // outside a read is the only one `readFrom` cannot reach on its own.
        this._state = SnapshotReader.readFrom(
            SnapshotReader.unansweredRead(waited),
            SnapshotReader.resolvePath(this._environment, this._readingTarget).target,
        );
        this._render();
        return true;
    }

    // The read outlives the turn that started it, so an applet removed from
    // the panel while one was in flight neither keeps the answer nor draws it.
    // `_render` refuses the draw on its own; this is about the state.
    //
    // And it outlives the setting it was started from. The settings binding
    // answers a change to the snapshot path by asking for a refresh, which a
    // read already in flight refuses — so the state that then arrived was read
    // from the *previous* file and was drawn as though it were the new one,
    // with the new one unread until the next tick: up to a minute at the top
    // of the refresh range. A state read from a path the applet has since been
    // pointed away from is discarded, and the read the change asked for is the
    // one made instead.
    _receiveState(state, target) {
        this._reading = false;
        if (this._destroyed) {
            return false;
        }
        if (target !== this._statePath()) {
            return this.refresh();
        }
        this._state = state;
        this._render();
        return true;
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
        if (model.tooltip !== this._drawnTooltip) {
            this._drawnTooltip = model.tooltip;
            this._tooltip.set_text(model.tooltip);
        }
        if (model.accessibleName !== this._drawnAccessibleName) {
            this._drawnAccessibleName = model.accessibleName;
            this.actor.set_accessible_name(model.accessibleName);
        }
        const lines = PanelStatus.popupLines(this._state);
        this._lineItems.forEach((item, index) => {
            // One string per line, and null for a line this state does not
            // have: whether the item is shown is decided by the same text that
            // fills it, so the two cannot be written a different number of
            // times.
            const line = lines[index];
            const text = line === undefined ? null : `${line.label}: ${line.value}`;
            if (text === this._drawnLines[index]) {
                return;
            }
            this._drawnLines[index] = text;
            item.actor.visible = text !== null;
            if (text !== null) {
                item.label.set_text(text);
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
        const size = PanelIcon.panelIconSize(requestedSize, this._panelHeight);
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
        // The source retires itself once the applet is gone. `_stopTimer` is
        // what normally removes it, and a removal that failed — an id GLib had
        // already retired, a mainloop that is going away — left a source
        // calling into a destroyed applet once a second for the rest of the
        // session, holding the applet and everything it points at reachable.
        // Returning false is the one way a source can leave without being
        // asked to.
        this._timer = Mainloop.timeout_add_seconds(refreshSeconds(this._refreshInterval), () => {
            this.refresh();
            return !this._destroyed;
        });
    }

    // Forgotten before it is removed: a `source_remove` that throws used to
    // leave the id still recorded, so the applet went on believing it held a
    // timer it had already stopped believing in — and a second stop tried the
    // same failing removal again.
    _stopTimer() {
        const timer = this._timer;
        this._timer = null;
        if (timer !== null) {
            Mainloop.source_remove(timer);
        }
    }

    // A click can still be delivered to an applet the panel has already
    // removed, and the menu it would toggle is destroyed by then.
    on_applet_clicked() {
        if (this._destroyed) {
            return false;
        }
        this.menu.toggle();
        return true;
    }

    // Cinnamon's own "Configure…", which spawns a window it never places: it
    // sets a size and leaves the position to the window manager, which opens
    // it in a corner while the applet it configures sits at the other end of
    // the panel. The client's windows centre themselves, so this one does too.
    //
    // Guarded like every other entry point Cinnamon can deliver late, and for
    // a sharper reason than the rest: the placer answers by connecting to
    // `global.display`, which is the session's and not the applet's, and
    // teardown has already run the placer's `cancel()` — so a handler armed
    // after that is one nothing will ever take off again.
    configureApplet(tab = 0) {
        if (this._destroyed) {
            return false;
        }
        this._placeSettingsWindow();
        super.configureApplet(tab);
        return true;
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
        releaseEach(this._logger, [
            ["the refresh timer", () => this._stopTimer()],
            ["the settings-window placer", () => this._settingsPlacer.cancel()],
            ["the icon search path", () => this._releaseIconPath()],
            ["the settings binding", () => this._finalizeSettings()],
            ["the presentation", () => this._releasePresentation()],
        ]);
        return true;
    }

    _finalizeSettings() {
        if (this.settings && typeof this.settings.finalize === "function") {
            this.settings.finalize();
        }
        return true;
    }

    // What setup created, teardown releases: `removeMenu` is what disconnects
    // the menu manager's own signals on the menu and its source actor, and the
    // tooltip arms mainloop timers of its own.
    //
    // Then the references go too. Destroying an object the applet still points
    // at leaves every holder of that applet one property away from a destroyed
    // menu, and the popup items the menu owned are only reachable through the
    // pool this drops.
    _releasePresentation() {
        releaseEach(this._logger, [
            ["the menu from its manager", () => this._removeMenu()],
            ["the popup menu", () => this._destroyMenu()],
            ["the tooltip", () => this._destroyTooltip()],
        ]);
        this.menu = null;
        this.menuManager = null;
        this._tooltip = null;
        this._lineItems = [];
        this._drawnLines = [];
        this._drawnTooltip = null;
        this._drawnAccessibleName = null;
        return true;
    }

    _removeMenu() {
        if (this.menuManager && this.menu && typeof this.menuManager.removeMenu === "function") {
            this.menuManager.removeMenu(this.menu);
        }
        return true;
    }

    _destroyMenu() {
        if (this.menu && typeof this.menu.destroy === "function") {
            this.menu.destroy();
        }
        return true;
    }

    _destroyTooltip() {
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
        // Re-exported, not re-declared: the icon's rules are one module away,
        // and a caller of the applet should not have to know which.
        DEFAULT_PANEL_ICON_SIZE: PanelIcon.DEFAULT_PANEL_ICON_SIZE,
        DEFAULT_REFRESH_SECONDS,
        MAX_REFRESH_SECONDS,
        MIN_PANEL_ICON_SIZE: PanelIcon.MIN_PANEL_ICON_SIZE,
        MIN_REFRESH_SECONDS,
        UUID,
        XpuWorkloadApplet,
        createAppletSettings,
        defaultEnvironment,
        defaultLogger,
        main,
        panelIconSize: PanelIcon.panelIconSize,
        refreshSeconds,
        settingsInstanceId,
    };
}
