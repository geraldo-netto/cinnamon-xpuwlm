"use strict";

// Launching the Python client, which is where the work now lives.
//
// The helper does not talk to the client: it starts it and gets out of the
// way. That is the whole binding — one process launch per user action, no
// daemon, no second protocol to keep in parity. The panel keeps reading the
// published snapshot itself, because a process launch twice a second to draw
// an icon would cost more than the answer is worth.
//
// The command is resolved rather than assumed. A user install puts `xpuwlm`
// in ~/.local/bin, which is not always on the session's PATH, so the launcher
// looks where the client is actually installed before falling back to PATH.

const LAUNCHER_COMMAND = "xpuwlm";
const USER_BIN = ".local/bin";
const VENV_BIN = ".local/share/xpuwlm/venv/bin";

function candidatePaths(environment) {
    const home = environment.GLib.get_home_dir();
    if (typeof home !== "string" || home.length === 0) {
        return [];
    }
    return [
        `${home}/${VENV_BIN}/${LAUNCHER_COMMAND}`,
        `${home}/${USER_BIN}/${LAUNCHER_COMMAND}`,
    ];
}

// The first installed candidate, or the bare command so PATH still gets a
// chance. Returning null instead would make "not installed yet" indis-
// tinguishable from "installed somewhere unusual".
function resolveCommand(environment) {
    const fileTest = environment.GLib.FileTest;
    for (const candidate of candidatePaths(environment)) {
        if (environment.GLib.file_test(candidate, fileTest.IS_EXECUTABLE)) {
            return candidate;
        }
    }
    return LAUNCHER_COMMAND;
}

function quoteArgument(value) {
    return `'${String(value).replace(/'/gu, "'\\''")}'`;
}

// One verb per user action, so the helper never has to know what the client
// does with it — only which action the user asked for.
function launchCommandLine(environment, verb, argument) {
    if (typeof verb !== "string" || !/^[a-z][a-z-]*$/u.test(verb)) {
        throw new TypeError(`Unsupported launcher verb: ${verb}`);
    }
    const parts = [quoteArgument(resolveCommand(environment)), verb];
    if (argument !== undefined && argument !== null) {
        parts.push(quoteArgument(argument));
    }
    return parts.join(" ");
}

function createLauncher(environment, spawn, logger) {
    if (typeof spawn !== "function") {
        throw new TypeError("A launcher needs a spawn port");
    }
    return {
        // Returns whether the launch was *started*, not whether the client
        // succeeded: the client owns its own window and its own errors, and
        // the panel must not sit waiting to find out.
        launch(verb = "ui", argument = null) {
            try {
                spawn(launchCommandLine(environment, verb, argument));
                return true;
            } catch (error) {
                logger?.warn(`Could not start the XPU workload client: ${error}`);
                return false;
            }
        },
    };
}

module.exports = {
    LAUNCHER_COMMAND,
    createLauncher,
    launchCommandLine,
    resolveCommand,
};
