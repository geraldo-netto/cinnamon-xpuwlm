"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const Port = require(
    "../../files/cinnamon-xpuwlm@geraldo-netto/lib/external-chooser-port.js"
);

function environment() {
    const processes = [];
    class Cancellable {
        constructor() { this.cancelled = false; }
        cancel() { this.cancelled = true; }
    }
    class Process {
        constructor(argv, flags) {
            this.argv = argv;
            this.flags = flags;
            this.status = 0;
            this.reply = [true, "", ""];
            this.callback = null;
            this.forceExitCount = 0;
        }
        communicate_utf8_async(input, cancellable, callback) {
            assert.equal(input, null);
            this.cancellable = cancellable;
            this.callback = callback;
        }
        communicate_utf8_finish() { return this.reply; }
        get_exit_status() { return this.status; }
        force_exit() { this.forceExitCount += 1; }
        complete(status, stdout = "", stderr = "") {
            this.status = status;
            this.reply = [true, stdout, stderr];
            this.callback(this, {});
        }
    }
    const Gio = {
        Cancellable,
        SubprocessFlags: {STDOUT_PIPE: 1, STDERR_PIPE: 2},
        Subprocess: {new(argv, flags) {
            const process = new Process(argv, flags);
            processes.push(process);
            return process;
        }},
    };
    return {
        Gio,
        GLib: {find_program_in_path(name) {
            assert.equal(name, "zenity");
            return "/usr/bin/zenity";
        }},
        processes,
    };
}

test("external chooser builds bounded argv without a shell", () => {
    assert.deepEqual(Port.chooserArguments("/usr/bin/zenity", {
        mode: "open", title: "Choose documents", multiple: true,
        filter: {name: "Documents", patterns: ["*.pdf", "*.PDF"]},
    }), [
        "/usr/bin/zenity", "--file-selection", "--title=Choose documents",
        "--multiple", `--separator=${Port.PATH_SEPARATOR}`,
        "--file-filter=Documents | *.pdf *.PDF",
    ]);
    assert.deepEqual(Port.chooserArguments("/usr/bin/zenity", {
        mode: "folder", title: "Choose folder",
    }), ["/usr/bin/zenity", "--file-selection", "--title=Choose folder", "--directory"]);
    assert.deepEqual(Port.chooserArguments("/usr/bin/zenity", {
        mode: "save", title: "Save events", filename: "confirmed-events.ics",
    }), [
        "/usr/bin/zenity", "--file-selection", "--title=Save events", "--save",
        "--filename=confirmed-events.ics",
    ]);
    assert.throws(() => Port.chooserArguments("zenity", {}), /mode and title/u);
    assert.throws(() => Port.chooserArguments("zenity", {
        mode: "save", title: "Save", multiple: true,
    }), /Only open/u);
    assert.throws(() => Port.chooserArguments("zenity", {
        mode: "save", title: "Save", filename: "folder/file.ics",
    }), /filename/u);
    assert.throws(() => Port.chooserArguments("zenity", {
        mode: "open", title: "Open", filter: {name: "Files", patterns: []},
    }), /filter/u);
});

test("external chooser returns selected paths and maps user cancellation to empty selection", () => {
    const env = environment();
    const lifecycle = new Port.ExternalChooserLifecycle(env);
    const replies = [];
    assert.equal(lifecycle.choose({
        mode: "open", title: "Choose", multiple: true,
    }, (error, paths) => replies.push([error, paths])), true);
    assert.equal(env.processes[0].flags, 3);
    env.processes[0].complete(0, `/one.pdf${Port.PATH_SEPARATOR}/two.txt\n`);
    assert.deepEqual(replies, [[null, ["/one.pdf", "/two.txt"]]]);

    lifecycle.choose({mode: "folder", title: "Folder"}, (error, paths) => {
        replies.push([error, paths]);
    });
    env.processes[1].complete(1, "", "cancelled");
    assert.deepEqual(replies[1], [null, []]);
});

test("external chooser reports helper and output failures exactly once", () => {
    const env = environment();
    const lifecycle = new Port.ExternalChooserLifecycle(env);
    const replies = [];
    lifecycle.choose({mode: "open", title: "Open"}, (error, paths) => {
        replies.push([error, paths]);
    });
    env.processes[0].complete(2, "", "display unavailable\n");
    assert.match(String(replies[0][0]), /status 2: display unavailable/u);
    assert.equal(replies[0][1], null);

    lifecycle.choose({mode: "open", title: "Open"}, (error, paths) => {
        replies.push([error, paths]);
    });
    env.processes[1].complete(0, "relative.txt\n");
    assert.match(String(replies[1][0]), /invalid paths/u);
    assert.equal(replies[1][1], null);
});

test("external chooser disposal cancels helpers and suppresses late callbacks", () => {
    const env = environment();
    const lifecycle = new Port.ExternalChooserLifecycle(env, "/custom/zenity");
    let callbacks = 0;
    lifecycle.choose({mode: "open", title: "Open"}, () => { callbacks += 1; });
    const process = env.processes[0];
    assert.equal(process.argv[0], "/custom/zenity");
    assert.equal(lifecycle.dispose(), true);
    assert.equal(lifecycle.dispose(), false);
    assert.equal(process.cancellable.cancelled, true);
    assert.equal(process.forceExitCount, 1);
    process.complete(0, "/late.txt\n");
    assert.equal(callbacks, 0);
    assert.throws(
        () => lifecycle.choose({mode: "open", title: "Open"}, () => {}),
        /disposed/u,
    );
});

test("external chooser validates host APIs, callbacks, and executable discovery", () => {
    assert.throws(() => Port.requireEnvironment(null), /GIO subprocess/u);
    const env = environment();
    assert.equal(Port.requireEnvironment(env), env);
    assert.equal(Port.chooserExecutable(env), "/usr/bin/zenity");
    assert.throws(() => Port.chooserExecutable(env, ""), /executable path/u);
    env.GLib.find_program_in_path = () => null;
    assert.throws(() => Port.chooserExecutable(env), /zenity is required/u);
    const lifecycle = new Port.ExternalChooserLifecycle(environment());
    assert.throws(() => lifecycle.choose({mode: "open", title: "Open"}), /callback/u);
    assert.equal(Port.requireChooserLifecycle(lifecycle), lifecycle);
    assert.throws(() => Port.requireChooserLifecycle({dispose() {}}), /external/u);
});

test("selection parser preserves path text and rejects ambiguous boundaries", () => {
    assert.deepEqual(Port.parseSelection("/a file.pdf\n"), ["/a file.pdf"]);
    assert.deepEqual(Port.parseSelection(""), []);
    assert.equal(Port.stripOutputTerminator("/a\r\n"), "/a");
    assert.throws(() => Port.parseSelection(null), /not text/u);
    assert.throws(
        () => Port.parseSelection(`relative${Port.PATH_SEPARATOR}/safe`, true),
        /invalid paths/u,
    );
    assert.throws(
        () => Port.parseSelection(`/first${Port.PATH_SEPARATOR.repeat(33)}/last`, true),
        /invalid paths/u,
    );
    assert.match(String(Port.processFailure("x".repeat(800), 4)), /status 4/u);
    assert.ok(String(Port.processFailure("x".repeat(800), 4)).length < 600);
});
