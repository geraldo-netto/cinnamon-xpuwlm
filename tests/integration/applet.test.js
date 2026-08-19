"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
    FakeActor,
    FakeMenu,
    FakeMenuManager,
    FakeSettings,
    createAtk,
    createSt,
} = require("../helpers/fakes.js");

const DEFAULTS = {
    "refresh-interval": 2,
    "runtime-state-path": "~/.local/state/xpu-workload-manager/state.json",
};

const NOW = 1_700_000_000_000;

function snapshotDocument(overrides = {}) {
    return JSON.stringify({
        version: 1,
        generatedAt: NOW,
        devices: [{
            id: "gpu-renderD128",
            backend: "gpu",
            available: true,
            name: "AMD GPU",
            kind: "dri",
            vendor: "AMD",
            load: 40,
            reason: "",
        }],
        metrics: {queueDepth: 1, runningProfiles: 0},
        profiles: {},
        alerts: [],
        ...overrides,
    });
}

class FakeIcon {
    constructor() {
        this.size = null;
    }

    set_icon_size(size) {
        this.size = size;
    }

    get_icon_size() {
        return this.size;
    }
}

class FakeTextIconApplet {
    constructor(orientation, panelHeight, instanceId) {
        this.baseArguments = {orientation, panelHeight, instanceId};
        this.instance_id = instanceId;
        this.actor = new FakeActor();
        this.symbolicIconNames = [];
        this.label = null;
        this._applet_icon = new FakeIcon();
    }

    set_applet_icon_symbolic_name(name) {
        this.symbolicIconNames.push(name);
    }

    set_applet_label(label) {
        this.label = label;
    }

    // Cinnamon's own implementation, which spawns xlet-settings and never
    // places the window it asks for.
    configureApplet(tab) {
        this.configuredTabs = this.configuredTabs || [];
        this.configuredTabs.push(tab);
    }
}

const settingsConstructions = [];

class BoundSettings extends FakeSettings {
    constructor(owner, ...rest) {
        super(owner, DEFAULTS);
        settingsConstructions.push(rest);
    }
}

class FakeTooltip {
    constructor(actor, text) {
        this.actor = actor;
        this.text = text;
    }

    set_text(text) {
        this.text = text;
    }
}

class FakeMenuItem {
    constructor(text, options = {}) {
        this.label = {text: text || "", set_text(value) { this.text = value; }};
        this.actor = new FakeActor();
        this.options = options;
        this.signals = new Map();
        this.nextSignalId = 1;
    }

    connect(signal, callback) {
        const id = this.nextSignalId;
        this.nextSignalId += 1;
        this.signals.set(id, {signal, callback});
        return id;
    }

    activate() {
        for (const entry of this.signals.values()) {
            if (entry.signal === "activate") {
                entry.callback(this);
            }
        }
    }
}

class FakeIconMenuItem extends FakeMenuItem {}

class FakeSeparator extends FakeMenuItem {}

class RecordingMenu extends FakeMenu {
    constructor() {
        super();
        this.items = [];
    }

    addMenuItem(item) {
        this.items.push(item);
    }
}

const iconPaths = [];
const notifications = [];
const spawned = [];
const timers = new Map();
let nextTimerId = 1;
let snapshotContents = snapshotDocument();
let snapshotError = null;
const idlers = new Map();

global.logWarning = () => {};

// Muffin's display, as far as this applet uses it: one signal, and a way to
// stop listening to it.
class FakeDisplay {
    constructor() {
        this.handlers = new Map();
        this.disconnected = [];
        this.nextHandler = 1;
    }

    connect(signal, callback) {
        const id = this.nextHandler;
        this.nextHandler += 1;
        this.handlers.set(id, {signal, callback});
        return id;
    }

    disconnect(id) {
        this.disconnected.push(id);
        this.handlers.delete(id);
    }

    open(window) {
        for (const {signal, callback} of [...this.handlers.values()]) {
            if (signal === "window-created") {
                callback(this, window);
            }
        }
    }
}

function settingsWindow(overrides = {}) {
    return {
        get_wm_class: () => "Xlet-settings.py",
        signals: new Map(),
        connect(signal, callback) {
            const id = this.signals.size + 1;
            this.signals.set(id, {signal, callback});
            return id;
        },
        disconnect(id) {
            this.signals.delete(id);
        },
        // What the window manager does a moment after the window is created.
        placedByTheWindowManager(x, y) {
            this.frame = {x, y, width: 800, height: 632};
            for (const {signal, callback} of [...this.signals.values()]) {
                if (signal === "position-changed") {
                    callback(this);
                }
            }
        },
        frame: {x: 90, y: 90, width: 800, height: 632},
        get_frame_rect() {
            return this.frame;
        },
        get_work_area_current_monitor: () => ({x: 0, y: 0, width: 3840, height: 2120}),
        allows_move: () => true,
        move_frame(userOperation, x, y) {
            this.moved = {userOperation, x, y};
            this.frame = {...this.frame, x, y};
        },
        ...overrides,
    };
}

function runIdlers() {
    for (const [id, callback] of [...idlers.entries()]) {
        idlers.delete(id);
        callback();
    }
}

global.display = new FakeDisplay();
global.imports = {
    byteArray: {toString: (value) => String(value)},
    gi: {
        Atk: createAtk(),
        Gio: {
            IOErrorEnum: {NOT_FOUND: 1},
            File: {
                new_for_path: () => ({
                    load_contents() {
                        if (snapshotError) {
                            throw snapshotError;
                        }
                        return [true, snapshotContents];
                    },
                }),
            },
        },
        GLib: {
            get_home_dir: () => "/home/tester",
            FileTest: {IS_EXECUTABLE: 8},
            file_test: () => false,
        },
        Gtk: {
            IconTheme: {
                get_default: () => ({
                    get_search_path: () => iconPaths.slice(),
                    append_search_path: (candidate) => iconPaths.push(candidate),
                }),
            },
        },
        St: {...createSt()},
    },
    mainloop: {
        timeout_add_seconds(seconds, callback) {
            const id = nextTimerId;
            nextTimerId += 1;
            timers.set(id, {seconds, callback});
            return id;
        },
        idle_add(callback) {
            const id = nextTimerId;
            nextTimerId += 1;
            idlers.set(id, callback);
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
        applet: {TextIconApplet: FakeTextIconApplet, AppletPopupMenu: RecordingMenu},
        main: {notify: (summary, body) => notifications.push({summary, body})},
        popupMenu: {
            PopupMenuManager: FakeMenuManager,
            PopupMenuItem: FakeMenuItem,
            PopupIconMenuItem: FakeIconMenuItem,
            PopupSeparatorMenuItem: FakeSeparator,
        },
        settings: {AppletSettings: BoundSettings},
        tooltips: {PanelItemTooltip: FakeTooltip},
    },
};

const AppletModule = require("../../files/cinnamon-xpuwlm@geraldo-netto/applet.js");

function build(overrides = {}) {
    return new AppletModule.XpuWorkloadApplet(
        {uuid: AppletModule.UUID, "max-instances": 1, path: "/applets/xpuwlm"},
        "top",
        28,
        "instance-1",
        {now: () => NOW, ...overrides},
    );
}

test("the panel draws the runtime's own status the moment it is built", () => {
    snapshotError = null;
    snapshotContents = snapshotDocument();

    const applet = build();

    assert.equal(applet.symbolicIconNames.at(-1), "xpuwlm-status-online-symbolic");
    assert.equal(applet._tooltip.text, "XPU Workload Manager — online, 1 queued");
    applet.on_applet_removed_from_panel();
});

test("a panel change after removal draws nothing into destroyed actors", () => {
    // Cinnamon broadcasts height and icon-size changes to every applet the
    // panel still holds, including one it is in the middle of removing.
    snapshotError = null;
    snapshotContents = snapshotDocument();
    const applet = build();
    applet.on_applet_removed_from_panel();
    const drawn = applet.symbolicIconNames.length;
    const iconSize = applet._applet_icon.get_icon_size();

    applet.on_panel_height_changed();
    applet.on_panel_icon_size_changed(48);

    assert.equal(applet.symbolicIconNames.length, drawn);
    assert.equal(applet._applet_icon.get_icon_size(), iconSize);
});

test("teardown stops holding the presentation it destroyed", () => {
    const applet = build();
    const menu = applet.menu;

    applet.on_applet_removed_from_panel();

    assert.equal(applet.menu, null);
    assert.equal(applet.menuManager, null);
    assert.equal(applet._tooltip, null);
    assert.deepEqual(applet._lineItems, []);
    assert.equal(menu.destroyed, true);
});

test("a click delivered after removal toggles nothing", () => {
    const applet = build();
    const menu = applet.menu;
    applet.on_applet_removed_from_panel();
    const toggles = menu.toggleCount;

    assert.equal(applet.on_applet_clicked(), false);
    assert.equal(applet._launch(), false);
    assert.equal(menu.toggleCount, toggles);
});

test("the panel writes nothing beside its icon", () => {
    const applet = build();

    applet.refresh();

    assert.equal(applet.label, null, "the applet must never set a panel label");
    assert.match(applet.actor.accessibleName, /XPU Workload Manager, online/u);
    applet.on_applet_removed_from_panel();
});

test("a runtime that is not running is drawn as unavailable, and says why", () => {
    snapshotError = Object.assign(new Error("gone"), {code: 1});

    const applet = build();

    assert.equal(applet.symbolicIconNames.at(-1), "xpuwlm-status-unavailable-symbolic");
    assert.match(applet._tooltip.text, /not running/u);
    snapshotError = null;
    applet.on_applet_removed_from_panel();
});

test("a runtime holding every workload draws the paused shape", () => {
    snapshotError = null;
    snapshotContents = snapshotDocument({policy: {revision: 3, paused: true, profiles: {}}});

    const applet = build();

    assert.equal(applet.symbolicIconNames.at(-1), "xpuwlm-status-paused-symbolic");
    assert.equal(applet._tooltip.text, "XPU Workload Manager — paused, 1 queued");
    snapshotContents = snapshotDocument();
    applet.on_applet_removed_from_panel();
});

test("the popup lists the runtime's state above the way into the client", () => {
    snapshotContents = snapshotDocument();
    const applet = build();

    const texts = applet.menu.items
        .filter((item) => item.label && typeof item.label.text === "string")
        .map((item) => item.label.text);

    assert.equal(texts.some((text) => text.startsWith("Runtime:")), true);
    assert.equal(texts.at(-1), "Open XPU Workload Manager");
    applet.on_applet_removed_from_panel();
});

test("choosing the action starts the client and closes the menu", () => {
    spawned.length = 0;
    const applet = build();
    const open = applet.menu.items.at(-1);

    open.activate();

    assert.equal(spawned.length, 1);
    assert.match(spawned[0], /xpuwlm' ui$/u);
    assert.equal(applet.menu.closeCount, 1);
    applet.on_applet_removed_from_panel();
});

test("a client that cannot be started is reported rather than silently missing", () => {
    notifications.length = 0;
    const applet = build({launcher: {launch: () => false}});

    applet.menu.items.at(-1).activate();

    assert.equal(notifications.length, 1);
    assert.match(notifications[0].body, /Is xpuwlm installed\?/u);
    applet.on_applet_removed_from_panel();
});

test("the refresh timer runs on the bound interval and stops with the applet", () => {
    const before = timers.size;
    const applet = build();
    assert.equal(timers.size, before + 1);
    const timer = [...timers.values()].at(-1);
    assert.equal(timer.seconds, 2);

    assert.equal(timer.callback(), true, "a repeating timer must keep itself alive");

    applet.on_applet_removed_from_panel();
    assert.equal(timers.size, before);
});

test("a refresh interval outside the supported range is clamped, not obeyed", () => {
    assert.equal(AppletModule.refreshSeconds(0), AppletModule.MIN_REFRESH_SECONDS);
    assert.equal(AppletModule.refreshSeconds(9999), AppletModule.MAX_REFRESH_SECONDS);
    assert.equal(AppletModule.refreshSeconds("soon"), AppletModule.DEFAULT_REFRESH_SECONDS);
});

test("the icon is never drawn smaller than its neighbours in the tray", () => {
    // Cinnamon's zone preference asks for 16 on a 40-pixel panel, which draws
    // the status glyph noticeably smaller than the systray icons beside it —
    // and the glyph is the whole message now that the panel carries no text.
    assert.equal(AppletModule.panelIconSize(16), AppletModule.MIN_PANEL_ICON_SIZE);
    // No size at all is the default rather than the floor: an unreadable
    // preference is not evidence that the panel wants the smallest icon.
    assert.equal(AppletModule.panelIconSize(0), AppletModule.DEFAULT_PANEL_ICON_SIZE);
    assert.equal(AppletModule.panelIconSize("large"), AppletModule.DEFAULT_PANEL_ICON_SIZE);
    // A panel that asks for more than the floor gets what it asked for: this
    // raises a small icon, it does not cap a large one.
    assert.equal(AppletModule.panelIconSize(48), 48);
    assert.equal(AppletModule.panelIconSize(36.7), 36);
});

test("the floor never asks a short panel for an icon taller than the strip", () => {
    // Cinnamon allows a panel down to 20 pixels, and the size is applied as an
    // inline style the theme cannot outrank, so an unconditional floor of 28
    // drew outside the panel it sits in.
    assert.equal(AppletModule.panelIconSize(16, 20), 20);
    assert.equal(AppletModule.panelIconSize(16, 40), AppletModule.MIN_PANEL_ICON_SIZE);
    // An unknown panel height keeps the floor: a missing number is not
    // evidence of a short panel.
    assert.equal(AppletModule.panelIconSize(16, 0), AppletModule.MIN_PANEL_ICON_SIZE);
    assert.equal(AppletModule.panelIconSize(16, "tall"), AppletModule.MIN_PANEL_ICON_SIZE);
});

test("an applet in a short panel sizes its icon to the panel it was given", () => {
    const applet = new AppletModule.XpuWorkloadApplet(
        {uuid: AppletModule.UUID, "max-instances": 1, path: "/applets/xpuwlm"},
        "top",
        20,
        "instance-short",
        {now: () => NOW},
    );

    applet.on_panel_icon_size_changed(16);

    assert.equal(applet._applet_icon.size, 20);
    applet.on_applet_removed_from_panel();
});

test("the icon size is applied on every status change, not only at startup", () => {
    const applet = build();

    assert.equal(applet._applet_icon.size, AppletModule.DEFAULT_PANEL_ICON_SIZE);

    applet.on_panel_icon_size_changed(44);
    assert.equal(applet._applet_icon.size, 44);

    // Setting a symbolic name replaces the actor's size, so a status change
    // has to re-apply it or the icon silently shrinks back.
    applet._applet_icon.size = 16;
    applet._panelIconStatus = null;
    applet.refresh();
    assert.equal(applet._applet_icon.size, 44);
    applet.on_applet_removed_from_panel();
});

test("the payload's icons are registered once, so the theme can find them", () => {
    // Without this the panel asks Cinnamon for an icon name the theme has
    // never heard of; appending twice would grow the search path on reload.
    iconPaths.length = 0;
    const first = build();
    const second = build();

    assert.deepEqual(iconPaths, ["/applets/xpuwlm/icons"]);
    first.on_applet_removed_from_panel();
    second.on_applet_removed_from_panel();
});

test("clicking the applet toggles its popup", () => {
    const applet = build();

    applet.on_applet_clicked();

    assert.equal(applet.menu.toggleCount, 1);
    applet.on_applet_removed_from_panel();
});

test("an applet whose icon actor cannot be sized says so instead of throwing", () => {
    // Cinnamon's private icon actor is not part of the applet API: a shell
    // that moves it must cost the size, not the panel presence.
    const applet = build();
    const real = applet._applet_icon;
    applet._applet_icon = null;
    assert.equal(applet._applyPanelIconSize(32), false);
    applet._applet_icon = {};
    assert.equal(applet._applyPanelIconSize(32), false);

    applet._applet_icon = real;
    assert.equal(applet._applyPanelIconSize(30), true);
    assert.equal(real.size, 30);
    applet.on_applet_removed_from_panel();
});

test("the actor carries exactly one status class, across a panel height change", () => {
    // The height change forgets the drawn status to force a redraw. If it also
    // forgot which class is on the actor, a status that changed in between
    // would leave two colours on one icon and let stylesheet order pick.
    snapshotError = null;
    snapshotContents = snapshotDocument();
    const applet = build();
    const statusClasses = () => [...applet.actor.styleClasses]
        .filter((name) => name.startsWith("xpuwlm-panel-"));

    assert.deepEqual(statusClasses(), ["xpuwlm-panel-online"]);

    applet.on_panel_height_changed();
    snapshotError = Object.assign(new Error("gone"), {code: 1});
    applet.refresh();

    assert.deepEqual(statusClasses(), ["xpuwlm-panel-unavailable"]);
    snapshotError = null;
    applet.on_applet_removed_from_panel();
});

test("the popup has an item for every line the model can produce", () => {
    const PanelStatus = require("../../files/cinnamon-xpuwlm@geraldo-netto/lib/panel-status.js");
    const applet = build();

    assert.equal(applet._lineItems.length, PanelStatus.MAX_POPUP_LINES);
    applet.on_applet_removed_from_panel();
});

test("a panel height change redraws the icon rather than leaving a stale one", () => {
    const applet = build();
    const drawn = applet.symbolicIconNames.length;

    applet.on_panel_height_changed();

    assert.equal(applet.symbolicIconNames.length, drawn + 1);
    applet.on_applet_removed_from_panel();
});

// Cinnamon's AppletSettings is (xlet, uuid, instanceId). A fourth argument is
// discarded by the constructor, so passing one only misleads the reader about
// what settings needs.
test("the settings object is built with the three arguments Cinnamon accepts", () => {
    settingsConstructions.length = 0;

    const applet = build();

    assert.deepEqual(settingsConstructions, [[AppletModule.UUID, AppletModule.UUID]]);
    applet.on_applet_removed_from_panel();
});

test("an overridden settings object is used instead of building one", () => {
    settingsConstructions.length = 0;
    const bound = [];
    const settings = {bind: (key) => bound.push(key)};

    const applet = build({settings});

    assert.equal(applet.settings, settings);
    assert.deepEqual(bound, ["refresh-interval", "runtime-state-path"]);
    assert.deepEqual(settingsConstructions, []);
    applet.on_applet_removed_from_panel();
});

test("a single-instance applet binds its settings under the UUID", () => {
    assert.equal(
        AppletModule.settingsInstanceId({"max-instances": 1}, "instance-9"),
        AppletModule.UUID,
    );
    assert.equal(AppletModule.settingsInstanceId({"max-instances": 2}, "instance-9"), "instance-9");
});

test("a settings binding failure tears the applet down instead of leaving a timer", () => {
    const before = timers.size;
    assert.throws(() => build({
        settings: {
            bind() {
                throw new Error("settings unavailable");
            },
        },
    }), /settings unavailable/u);
    assert.equal(timers.size, before);
});

test("the default environment reads through GJS rather than through Node", () => {
    const environment = AppletModule.defaultEnvironment();
    assert.equal(typeof environment.decode, "function");
    assert.equal(environment.GLib.get_home_dir(), "/home/tester");
    assert.equal(AppletModule.defaultLogger().warn("noted"), undefined);
});

// Teardown is reachable twice — the constructor releases what it built when
// construction fails, and Cinnamon calls back when the applet leaves the panel
// — and the second pass must not finalize a binding or destroy a menu again.
test("an applet removed from the panel twice releases its presentation once", () => {
    const counts = {finalized: 0, removed: 0, menuDestroyed: 0, tooltipDestroyed: 0};
    const menu = new RecordingMenu();
    menu.destroy = () => {
        counts.menuDestroyed += 1;
    };
    const applet = build({
        settings: {
            bind() {},
            finalize() {
                counts.finalized += 1;
            },
        },
        menu,
        menuManager: {
            addMenu() {},
            removeMenu() {
                counts.removed += 1;
            },
        },
        tooltip: {
            set_text() {},
            destroy() {
                counts.tooltipDestroyed += 1;
            },
        },
    });

    assert.equal(applet._teardown(), true);
    assert.equal(applet._teardown(), false);
    applet.on_applet_removed_from_panel();

    assert.deepEqual(counts, {
        finalized: 1,
        removed: 1,
        menuDestroyed: 1,
        tooltipDestroyed: 1,
    });
});

test("a destroyed applet neither refreshes nor re-arms its timer", () => {
    const applet = build();
    applet.on_applet_removed_from_panel();
    const drawn = applet.symbolicIconNames.length;
    const running = timers.size;

    applet.refresh();
    applet._startTimer();

    assert.equal(applet.symbolicIconNames.length, drawn);
    assert.equal(timers.size, running);
});

test("a missing runtime-state-path falls back to the published default", () => {
    const applet = build();
    applet._runtimeStatePath = "";

    applet.refresh();

    assert.equal(applet._state.runtime, "connected");
    applet.on_applet_removed_from_panel();
});

test("main returns a live applet", () => {
    const applet = AppletModule.main(
        {uuid: AppletModule.UUID, "max-instances": 1},
        "top",
        28,
        "instance-main",
    );

    assert.equal(applet instanceof AppletModule.XpuWorkloadApplet, true);
    applet.on_applet_removed_from_panel();
});

test("Configure… centres the settings window Cinnamon opens", () => {
    // Cinnamon spawns xlet-settings with a size and no position, so the window
    // manager drops it in a corner while the applet sits in the panel.
    const applet = build();
    const display = new FakeDisplay();
    const window = settingsWindow();

    applet._placeSettingsWindow(display, global.imports.mainloop);
    display.open(window);
    runIdlers();

    assert.deepEqual(window.moved, {userOperation: true, x: 1520, y: 744});
    applet.on_applet_removed_from_panel();
});

test("Configure… still asks Cinnamon to open its own settings window", () => {
    const applet = build();

    applet.configureApplet(2);

    assert.deepEqual(applet.configuredTabs, [2]);
    applet.on_applet_removed_from_panel();
});

test("another application's window opening is not moved", () => {
    const applet = build();
    const display = new FakeDisplay();
    const window = settingsWindow({get_wm_class: () => "Google-chrome"});

    applet._placeSettingsWindow(display, global.imports.mainloop);
    display.open(window);
    runIdlers();

    assert.equal(window.moved, undefined);
    assert.deepEqual(display.disconnected, []);
    applet.on_applet_removed_from_panel();
});

test("the applet stops listening once it has placed one window", () => {
    const applet = build();
    const display = new FakeDisplay();

    applet._placeSettingsWindow(display, global.imports.mainloop);
    display.open(settingsWindow());
    runIdlers();

    assert.equal(display.handlers.size, 0);
    assert.equal(display.disconnected.length, 1);
    applet.on_applet_removed_from_panel();
});

test("a settings window that never opens is not waited for forever", () => {
    // A spawn that failed, or a Cinnamon that stopped using xlet-settings.
    const applet = build();
    const display = new FakeDisplay();

    applet._placeSettingsWindow(display, global.imports.mainloop);
    const [waiting] = [...timers.values()].filter((timer) => timer.seconds >= 1).slice(-1);
    waiting.callback();

    assert.equal(display.handlers.size, 0);
    applet.on_applet_removed_from_panel();
});

test("a window that cannot be placed costs the placement, not the settings window", () => {
    const applet = build();
    const display = new FakeDisplay();
    const window = settingsWindow({
        move_frame() {
            throw new Error("the window manager said no");
        },
    });

    applet._placeSettingsWindow(display, global.imports.mainloop);
    display.open(window);

    assert.doesNotThrow(runIdlers);
    applet.on_applet_removed_from_panel();
});

test("a shell that publishes no display is left alone", () => {
    const applet = build();

    assert.equal(applet._placeSettingsWindow(null, global.imports.mainloop), false);
    assert.equal(applet._placeSettingsWindow({}, global.imports.mainloop), false);
    applet.on_applet_removed_from_panel();
});

test("a window the manager places after the first idle turn is still centred", () => {
    // The measured race: the window manager places a new window itself, and
    // that landed either side of the idle depending on how long the settings
    // process took to start. Centred once, left in the corner once.
    const applet = build();
    const display = new FakeDisplay();
    const window = settingsWindow();

    applet._placeSettingsWindow(display, global.imports.mainloop);
    display.open(window);
    runIdlers();
    window.placedByTheWindowManager(50, 50);
    // The correction is queued, not made inside the signal: a move made while
    // the window manager is still placing the window is silently discarded.
    assert.deepEqual(window.get_frame_rect(), {x: 50, y: 50, width: 800, height: 632});
    runIdlers();

    assert.deepEqual(window.moved, {userOperation: true, x: 1520, y: 744});
    applet.on_applet_removed_from_panel();
});

test("the applet stops correcting the window once it has settled", () => {
    const applet = build();
    const display = new FakeDisplay();
    const window = settingsWindow();

    applet._placeSettingsWindow(display, global.imports.mainloop);
    display.open(window);
    runIdlers();
    const settling = [...timers.values()].filter((timer) => timer.milliseconds).slice(-1)[0];
    settling.callback();
    window.placedByTheWindowManager(50, 50);
    runIdlers();

    // Released: a window the person moves a second later is theirs.
    assert.deepEqual(window.get_frame_rect(), {x: 50, y: 50, width: 800, height: 632});
    applet.on_applet_removed_from_panel();
});

test("a window that cannot report signals is still placed once", () => {
    const applet = build();
    const display = new FakeDisplay();
    const window = settingsWindow({connect: undefined, disconnect: undefined});

    applet._placeSettingsWindow(display, global.imports.mainloop);
    display.open(window);
    runIdlers();

    assert.deepEqual(window.moved, {userOperation: true, x: 1520, y: 744});
    applet.on_applet_removed_from_panel();
});

// The panel reads the snapshot without blocking the compositor thread, so the
// state arrives on a callback that outlives the turn which asked for it.
function deferredEnvironment(contents) {
    const pending = [];
    const file = {
        load_contents_async(_cancellable, callback) {
            pending.push(() => callback(file, {}));
        },
        load_contents_finish: () => [true, contents],
    };
    const paths = [];
    return {
        paths,
        pending,
        environment: {
            GLib: {get_home_dir: () => "/home/tester"},
            Gio: {
                IOErrorEnum: {NOT_FOUND: 1},
                File: {
                    new_for_path(target) {
                        paths.push(target);
                        return file;
                    },
                },
            },
            decode: (value) => String(value),
        },
    };
}

test("a tick that finds the previous read outstanding is dropped, not queued", () => {
    const {pending, environment} = deferredEnvironment(snapshotDocument());
    const applet = build({environment});

    assert.equal(pending.length, 1, "construction asks for the snapshot without waiting");
    assert.equal(applet._state.runtime, "absent");

    applet.refresh();
    assert.equal(pending.length, 1, "a second read must not be started beside the first");

    pending.pop()();
    assert.equal(applet._state.runtime, "connected");

    applet.refresh();
    assert.equal(pending.length, 1, "the next tick reads again once the last one landed");
    pending.pop()();
    applet.on_applet_removed_from_panel();
});

test("a snapshot that lands after the applet was removed is not drawn", () => {
    const {pending, environment} = deferredEnvironment(snapshotDocument());
    const applet = build({environment});
    applet.on_applet_removed_from_panel();
    const drawn = applet.symbolicIconNames.length;

    pending.pop()();

    assert.equal(applet._state.runtime, "absent");
    assert.equal(applet.symbolicIconNames.length, drawn);
});

// The read outlives the setting it was started from: the binding answers a
// path change by asking for a refresh, which the outstanding read refuses.
test("a snapshot path changed mid-read is read again, and the old answer dropped", () => {
    const {paths, pending, environment} = deferredEnvironment(snapshotDocument());
    const applet = build({environment});

    assert.deepEqual(paths, ["/home/tester/.local/state/xpu-workload-manager/state.json"]);

    applet._runtimeStatePath = "/tmp/elsewhere/state.json";
    applet.settings.bindings.get("runtime-state-path").callback();
    assert.equal(pending.length, 1, "the outstanding read refuses a second beside it");

    pending.pop()();

    assert.equal(applet._state.runtime, "absent", "the previous file's answer is not drawn");
    assert.equal(paths.at(-1), "/tmp/elsewhere/state.json", "the new path is read at once");

    pending.pop()();

    assert.equal(applet._state.runtime, "connected");
    applet.on_applet_removed_from_panel();
});
