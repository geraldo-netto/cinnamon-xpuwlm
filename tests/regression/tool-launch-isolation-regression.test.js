"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const ROOT = path.resolve(__dirname, "../..");

function production(relativePath) {
    return fs.readFileSync(path.join(
        ROOT, "files/cinnamon-xpuwlm@geraldo-netto", relativePath,
    ), "utf8");
}

test("file-based tools never construct GTK chooser windows in Cinnamon", () => {
    const applet = production("applet.js");
    const wiring = production("lib/workflow-wiring.js");
    assert.match(applet, /new ExternalChooser\.ExternalChooserLifecycle/u);
    assert.match(wiring, /createExternalDocumentPicker/u);
    assert.match(wiring, /createExternalEventSourcePicker/u);
    assert.match(wiring, /createExternalEventExporter/u);
    assert.doesNotMatch(wiring, /createGtkDocumentPicker/u);
    assert.doesNotMatch(wiring, /createGtkEventSourcePicker/u);
    assert.doesNotMatch(wiring, /createGtkEventExporter/u);

    const external = production("lib/external-chooser-port.js");
    assert.match(external, /Gio\.Subprocess\.new/u);
    assert.doesNotMatch(external, /environment\?\.Gtk|new Gtk\.|new Gdk\./u);
});

test("selected-text and diagnostics use a Cinnamon 6.6-compatible clipboard atom", () => {
    const clipboard = production("lib/clipboard-selection-port.js");
    const applet = production("applet.js");
    assert.match(clipboard, /Gdk\.Atom\?\.intern/u);
    assert.match(clipboard, /atom_intern/u);
    assert.match(applet, /ClipboardSelectionPort\.clipboardAtom/u);
    assert.doesNotMatch(applet, /Gtk\.Clipboard\.get\(Gdk\.SELECTION_CLIPBOARD\)/u);
});
