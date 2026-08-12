"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const Port = require("../../files/cinnamon-xpuwlm@geraldo-netto/lib/event-source-port.js");

const ROOT = path.resolve(__dirname, "../..");

function environment() {
    return {
        ByteArray: {},
        Gio: {},
        Gtk: {ResponseType: {ACCEPT: 1, OK: 2}},
    };
}

function dialog() {
    return {
        handler: null,
        destroyed: false,
        connect(_signal, callback) { this.handler = callback; return 31; },
        disconnect(signalId) { assert.equal(signalId, 31); },
        set_modal(value) { assert.equal(value, true); },
        show_all() {},
        present() {},
        hide() {},
        destroy() { this.destroyed = true; },
    };
}

test("reload destroys a live GTK chooser and suppresses its retained response signal", () => {
    const lifecycle = new Port.GtkChooserLifecycle(environment(), {
        schedule() { throw new Error("a disposed chooser must not schedule"); },
        cancel() { throw new Error("no completion is pending"); },
    });
    const chooser = dialog();
    let callbacks = 0;
    lifecycle.present(chooser, () => ["private-path"], () => { callbacks += 1; });
    const retainedNativeHandler = chooser.handler;

    assert.equal(lifecycle.dispose(), true);
    assert.equal(chooser.destroyed, true);
    retainedNativeHandler(chooser, 1);
    assert.equal(callbacks, 0);
});

test("reload documentation pins Cinnamon's case-sensitive xlet type", () => {
    const guide = fs.readFileSync(path.join(ROOT, "docs/applet.md"), "utf8");
    assert.match(guide, /--method org\.Cinnamon\.ReloadXlet/u);
    assert.match(guide, /'cinnamon-xpuwlm@geraldo-netto' 'APPLET'/u);
    assert.match(guide, /`APPLET` is case-sensitive/u);
    assert.doesNotMatch(guide, /'cinnamon-xpuwlm@geraldo-netto' 'applet'/u);
});

test("chooser audit covers the full Laws of UX catalog", () => {
    const audit = fs.readFileSync(path.join(ROOT, "docs/chooser-ux-audit.md"), "utf8");
    for (const law of [
        "Aesthetic-Usability Effect", "Choice Overload", "Chunking", "Cognitive Bias",
        "Cognitive Load", "Doherty Threshold", "Fitts's Law", "Flow",
        "Goal-Gradient Effect", "Hick's Law", "Jakob's Law", "Law of Common Region",
        "Law of Proximity", "Law of Prägnanz", "Law of Similarity",
        "Law of Uniform Connectedness", "Mental Model", "Miller's Law", "Occam's Razor",
        "Paradox of the Active User", "Pareto Principle", "Parkinson's Law", "Peak-End Rule",
        "Postel's Law", "Selective Attention", "Serial Position Effect", "Tesler's Law",
        "Von Restorff Effect", "Working Memory", "Zeigarnik Effect",
    ]) {
        assert.equal(audit.includes(`| ${law} |`), true, law);
    }
});
