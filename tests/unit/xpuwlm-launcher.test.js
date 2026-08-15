"use strict";

const assert = require("node:assert/strict");
const {test} = require("node:test");

const Launcher = require("../../files/cinnamon-xpuwlm@geraldo-netto/lib/xpuwlm-launcher.js");

const FILE_TEST = {IS_EXECUTABLE: 8};

function environment({home = "/home/tester", executable = []} = {}) {
    return {
        GLib: {
            FileTest: FILE_TEST,
            get_home_dir: () => home,
            file_test: (path, flag) => flag === FILE_TEST.IS_EXECUTABLE
                && executable.includes(path),
        },
    };
}

test("a client installed in the user's venv is preferred over PATH", () => {
    const venv = "/home/tester/.local/share/xpuwlm/venv/bin/xpuwlm";
    assert.equal(Launcher.resolveCommand(environment({executable: [venv]})), venv);
});

test("a client on the user's bin path is found when no venv exists", () => {
    const userBin = "/home/tester/.local/bin/xpuwlm";
    assert.equal(Launcher.resolveCommand(environment({executable: [userBin]})), userBin);
});

test("the venv wins when both are installed", () => {
    const venv = "/home/tester/.local/share/xpuwlm/venv/bin/xpuwlm";
    const userBin = "/home/tester/.local/bin/xpuwlm";
    assert.equal(Launcher.resolveCommand(environment({executable: [venv, userBin]})), venv);
});

test("an uninstalled client still resolves to the bare command so PATH can answer", () => {
    assert.equal(Launcher.resolveCommand(environment()), "xpuwlm");
});

test("a home directory the session does not report leaves only the bare command", () => {
    assert.equal(Launcher.resolveCommand(environment({home: ""})), "xpuwlm");
});

test("the command line quotes the resolved path and carries one verb", () => {
    const venv = "/home/tester/.local/share/xpuwlm/venv/bin/xpuwlm";
    const line = Launcher.launchCommandLine(environment({executable: [venv]}), "ui");
    assert.equal(line, `'${venv}' ui`);
});

test("an argument is quoted so a path with spaces survives the shell", () => {
    const line = Launcher.launchCommandLine(environment(), "transcribe", "/tmp/my clip.wav");
    assert.equal(line, "'xpuwlm' transcribe '/tmp/my clip.wav'");
});

test("a quote in a filename cannot break out of its argument", () => {
    const line = Launcher.launchCommandLine(environment(), "transcribe", "/tmp/it's here.wav");
    assert.equal(line, "'xpuwlm' transcribe '/tmp/it'\\''s here.wav'");
});

test("a verb that is not a plain word is refused rather than spawned", () => {
    for (const verb of ["ui; rm -rf /", "", "UI", 7, null]) {
        assert.throws(() => Launcher.launchCommandLine(environment(), verb), TypeError);
    }
});

test("launching reports that it started the client, not that the client succeeded", () => {
    const spawned = [];
    const launcher = Launcher.createLauncher(environment(), (line) => spawned.push(line));
    assert.equal(launcher.launch("ui"), true);
    assert.deepEqual(spawned, ["'xpuwlm' ui"]);
});

test("the default verb opens the window", () => {
    const spawned = [];
    Launcher.createLauncher(environment(), (line) => spawned.push(line)).launch();
    assert.deepEqual(spawned, ["'xpuwlm' ui"]);
});

test("a spawn failure is reported and swallowed, never thrown at the panel", () => {
    const warnings = [];
    const launcher = Launcher.createLauncher(
        environment(),
        () => {
            throw new Error("no such binary");
        },
        {warn: (message) => warnings.push(message)},
    );
    assert.equal(launcher.launch("ui"), false);
    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /no such binary/u);
});

test("a launcher without a spawn port is refused at construction", () => {
    assert.throws(() => Launcher.createLauncher(environment(), null), TypeError);
});
