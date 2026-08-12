"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const Clipboard = require(
    "../../files/cinnamon-xpuwlm@geraldo-netto/lib/clipboard-selection-port.js"
);

function environment() {
    const requested = [];
    const clipboard = {
        callback: null,
        request_text(callback) { requested.push(true); this.callback = callback; },
    };
    return {
        Gdk: {SELECTION_CLIPBOARD: "clipboard"},
        Gtk: {Clipboard: {get(selection) {
            assert.equal(selection, "clipboard");
            return clipboard;
        }}},
        clipboard,
        requested,
    };
}

test("GTK clipboard reader performs one explicit read and never installs a watcher", () => {
    const env = environment();
    const reader = Clipboard.createGtkClipboardSelectionReader(env);
    assert.deepEqual(env.requested, []);
    assert.equal(env.clipboard.connect, undefined);
    const replies = [];
    assert.equal(reader.readText((error, text) => replies.push([error, text])), true);
    assert.equal(env.requested.length, 1);
    env.clipboard.callback(env.clipboard, "selected once");
    assert.deepEqual(replies, [[null, "selected once"]]);

    reader.readText((error, text) => replies.push([error, text]));
    const stale = env.clipboard.callback;
    assert.equal(reader.cancel(), true);
    reader.readText((error, text) => replies.push([error, text]));
    const current = env.clipboard.callback;
    stale(env.clipboard, "ignored");
    assert.equal(replies.length, 1);
    current(env.clipboard, null);
    assert.deepEqual(replies.at(-1), [null, ""]);
});

test("GTK clipboard reader resolves Cinnamon 6.6 clipboard atom", () => {
    const env = environment();
    delete env.Gdk.SELECTION_CLIPBOARD;
    env.Gdk.Atom = {intern(name, onlyIfExists) {
        assert.equal(name, "CLIPBOARD");
        assert.equal(onlyIfExists, false);
        return "clipboard";
    }};
    assert.equal(Clipboard.clipboardAtom(env), "clipboard");
    const reader = Clipboard.createGtkClipboardSelectionReader(env);
    let reply = null;
    reader.readText((error, text) => { reply = [error, text]; });
    env.clipboard.callback(env.clipboard, "modern selection");
    assert.deepEqual(reply, [null, "modern selection"]);

    delete env.Gdk.Atom;
    env.Gdk.atom_intern = () => "clipboard";
    assert.equal(Clipboard.clipboardAtom(env), "clipboard");
});

test("clipboard port rejects missing dependencies, callbacks, and GTK text support", () => {
    assert.throws(() => Clipboard.requireEnvironment(null), /dependencies/u);
    assert.throws(() => Clipboard.requireEnvironment({Gdk: {}, Gtk: {}}), /API/u);
    assert.throws(() => Clipboard.requireEnvironment({
        Gdk: {SELECTION_CLIPBOARD: "clipboard"}, Gtk: {Clipboard: {}},
    }), /API/u);
    assert.throws(() => Clipboard.requireEnvironment({
        Gdk: {}, Gtk: {Clipboard: {get() {}}},
    }), /API/u);
    assert.throws(() => Clipboard.clipboardAtom(null), /dependency/u);
    const env = environment();
    const reader = new Clipboard.GtkClipboardSelectionReader(env);
    assert.throws(() => reader.readText(null), /callback/u);
    env.Gtk.Clipboard.get = () => null;
    let reply = null;
    assert.equal(reader.readText((error, text) => { reply = [error, text]; }), false);
    assert.match(String(reply[0]), /unavailable/u);
    assert.equal(reply[1], null);
    env.Gtk.Clipboard.get = () => ({});
    reader.readText((error, text) => { reply = [error, text]; });
    assert.match(String(reply[0]), /unavailable/u);
});
