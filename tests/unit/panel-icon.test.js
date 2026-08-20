"use strict";

const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");

// The icon's own rules, asked of the module that owns them.
//
// They were checked through `applet.js`'s re-exports, in the applet's
// lifecycle test beside the timer, the settings binding and the teardown —
// which is where they lived before `2f08c63` gave the icon its own module, and
// is not where a reader of that module would look for them. What stays with
// the applet is the applet's half: that the size reaches the actor, and that
// it survives a status change.

const PanelIcon = require(path.resolve(
    __dirname,
    "../../files/cinnamon-xpuwlm@geraldo-netto/lib/panel-icon.js",
));

test("the icon is never drawn smaller than its neighbours in the tray", () => {
    // Cinnamon's zone preference asks for 16 on a 40-pixel panel, which draws
    // the status glyph noticeably smaller than the systray icons beside it —
    // and the glyph is the whole message now that the panel carries no text.
    assert.equal(PanelIcon.panelIconSize(16), PanelIcon.MIN_PANEL_ICON_SIZE);
    // No size at all is the default rather than the floor: an unreadable
    // preference is not evidence that the panel wants the smallest icon.
    assert.equal(PanelIcon.panelIconSize(0), PanelIcon.DEFAULT_PANEL_ICON_SIZE);
    assert.equal(PanelIcon.panelIconSize("large"), PanelIcon.DEFAULT_PANEL_ICON_SIZE);
    // A panel that asks for more than the floor gets what it asked for: this
    // raises a small icon, it does not cap a large one.
    assert.equal(PanelIcon.panelIconSize(48), 48);
    assert.equal(PanelIcon.panelIconSize(36.7), 36);
});

test("the floor never asks a short panel for an icon taller than the strip", () => {
    // Cinnamon allows a panel down to 20 pixels, and the size is applied as an
    // inline style the theme cannot outrank, so an unconditional floor of 28
    // drew outside the panel it sits in.
    assert.equal(PanelIcon.panelIconSize(16, 20), 20);
    assert.equal(PanelIcon.panelIconSize(16, 40), PanelIcon.MIN_PANEL_ICON_SIZE);
    // An unknown panel height keeps the floor: a missing number is not
    // evidence of a short panel.
    assert.equal(PanelIcon.panelIconSize(16, 0), PanelIcon.MIN_PANEL_ICON_SIZE);
    assert.equal(PanelIcon.panelIconSize(16, "tall"), PanelIcon.MIN_PANEL_ICON_SIZE);
});

test("the size nobody asked for is bounded by the panel, and the one that was is not", () => {
    // Regression: the bound reached the floor and not the default, and the
    // default is what an applet holds from construction until Cinnamon reports
    // a size — so a 20-pixel panel was handed 32 pixels of guess first.
    assert.equal(PanelIcon.panelIconSize(null, 20), 20);
    assert.equal(PanelIcon.panelIconSize(null, 28), 28);
    assert.equal(PanelIcon.panelIconSize(null, 40), PanelIcon.DEFAULT_PANEL_ICON_SIZE);
    // A request is Cinnamon's, made by the one party that knows how tall its
    // own strip is, so it is honoured whatever it is.
    assert.equal(PanelIcon.panelIconSize(44, 28), 44);
});

function fakeTheme(entries = []) {
    const searchPath = [...entries];
    return {
        appended: 0,
        get_search_path: () => [...searchPath],
        append_search_path(entry) {
            this.appended += 1;
            searchPath.push(entry);
        },
        set_search_path(entries_) {
            searchPath.length = 0;
            searchPath.push(...entries_);
        },
    };
}

test("the payload's directory is appended once and taken back by its owner", () => {
    const theme = fakeTheme(["/usr/share/icons"]);
    const registration = PanelIcon.createIconSearchPath(theme, "/applets/xpuwlm/icons");

    assert.equal(registration.register(), true);
    assert.deepEqual(theme.get_search_path(), ["/usr/share/icons", "/applets/xpuwlm/icons"]);
    // Appending twice would grow the session's search path on every reload.
    assert.equal(registration.register(), false);
    assert.equal(theme.appended, 1);

    assert.equal(registration.release(), true);
    assert.deepEqual(theme.get_search_path(), ["/usr/share/icons"]);
    // Only the registration that added the entry removes it, so a second
    // release does not take away an entry another applet appended.
    assert.equal(registration.release(), false);
});

test("a theme that cannot be registered with is refused rather than half-registered", () => {
    assert.equal(PanelIcon.createIconSearchPath(null, "/applets/xpuwlm/icons").register(), false);
    // Released without ever having registered: teardown runs whether or not
    // the registration was made.
    assert.equal(PanelIcon.createIconSearchPath(fakeTheme(), "/icons").release(), false);
    const readOnly = fakeTheme();
    delete readOnly.set_search_path;
    const registration = PanelIcon.createIconSearchPath(readOnly, "/icons");
    assert.equal(registration.register(), true);
    assert.equal(registration.release(), false);
});
