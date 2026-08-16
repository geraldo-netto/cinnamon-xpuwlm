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

class FakeTextIconApplet {
    constructor(orientation, panelHeight, instanceId) {
        this.baseArguments = {orientation, panelHeight, instanceId};
        this.instance_id = instanceId;
        this.actor = new FakeActor();
        this.symbolicIconNames = [];
        this.label = null;
    }

    set_applet_icon_symbolic_name(name) {
        this.symbolicIconNames.push(name);
    }

    set_applet_label(label) {
        this.label = label;
    }

}

class BoundSettings extends FakeSettings {
    constructor(owner) {
        super(owner, DEFAULTS);
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

const notifications = [];
const spawned = [];
const timers = new Map();
let nextTimerId = 1;
let snapshotContents = snapshotDocument();
let snapshotError = null;

global.logWarning = () => {};
global.imports = {
    byteArray: {toString: (value) => String(value)},
    gettext: null,
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
        St: {...createSt()},
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
        {uuid: AppletModule.UUID, "max-instances": 1},
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
    assert.equal(AppletModule.panelIconSize(0), AppletModule.DEFAULT_PANEL_ICON_SIZE);
    assert.equal(AppletModule.panelIconSize(24.7), 24);
});

test("clicking the applet toggles its popup", () => {
    const applet = build();

    applet.on_applet_clicked();

    assert.equal(applet.menu.toggleCount, 1);
    applet.on_applet_removed_from_panel();
});

test("a panel height change redraws the icon rather than leaving a stale one", () => {
    const applet = build();
    const drawn = applet.symbolicIconNames.length;

    applet.on_panel_height_changed();

    assert.equal(applet.symbolicIconNames.length, drawn + 1);
    applet.on_applet_removed_from_panel();
});

test("a single-instance applet binds its settings under the UUID", () => {
    assert.equal(
        AppletModule.settingsInstanceId({"max-instances": 1}, "instance-9"),
        AppletModule.UUID,
    );
    assert.equal(AppletModule.settingsInstanceId({"max-instances": 2}, "instance-9"), "instance-9");
});

test("absent gettext keeps the untranslated English msgids", () => {
    assert.equal(AppletModule.installTranslations(null, {GLib: {get_home_dir: () => "/home"}}), false);
    const calls = [];
    const installed = AppletModule.installTranslations({
        dgettext: (domain, msgid) => {
            calls.push([domain, msgid]);
            return msgid;
        },
        bindtextdomain: () => {},
    }, {GLib: {get_home_dir: () => "/home/tester"}});
    assert.equal(installed, true);
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

test("main installs translations and returns a live applet", () => {
    const applet = AppletModule.main(
        {uuid: AppletModule.UUID, "max-instances": 1},
        "top",
        28,
        "instance-main",
    );

    assert.equal(applet instanceof AppletModule.XpuWorkloadApplet, true);
    applet.on_applet_removed_from_panel();
});

test("installed translations route msgids through the desktop's catalogue", () => {
    const I18n = require("../../files/cinnamon-xpuwlm@geraldo-netto/lib/i18n.js");
    const seen = [];
    AppletModule.installTranslations({
        dgettext: (domain, msgid) => {
            seen.push([domain, msgid]);
            return `translated:${msgid}`;
        },
        dngettext: (domain, singular, plural, count) => (
            count === 1 ? `translated:${singular}` : `translated:${plural}`
        ),
        bindtextdomain: () => {},
    }, {GLib: {get_home_dir: () => "/home/tester"}});

    assert.equal(I18n._("Online"), "translated:Online");
    assert.equal(I18n.ngettext("one", "many", 2), "translated:many");
    assert.equal(seen[0][0], AppletModule.UUID);
    I18n.reset();
});

test("gettext without plural support still resolves a plural msgid", () => {
    const I18n = require("../../files/cinnamon-xpuwlm@geraldo-netto/lib/i18n.js");
    AppletModule.installTranslations({
        dgettext: (_domain, msgid) => msgid,
    }, {GLib: {get_home_dir: () => "/home/tester"}});

    assert.equal(I18n.ngettext("one", "many", 3), "many");
    I18n.reset();
});
