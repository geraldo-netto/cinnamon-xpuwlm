"use strict";

// Reading the runtime's published snapshot, for the panel and nothing else.
//
// The helper no longer models the runtime — the Python client does, against
// the canonical schemas with a real schema engine. What survives here is the
// smallest read that can colour an icon and fill a five-line popup: open the
// file the service writes, bound it, parse it, and take the half-dozen fields
// the panel shows. Anything the panel does not draw is not read, not
// validated, and not mirrored.
//
// That is the whole reason this is short where the applet used to carry about
// 2,700 lines of hand-written contract mirrors: a reader that renders five
// fields needs to agree with the writer about five fields.
//
// Device load is deliberately not among them. A panel that reports the
// accelerator's instantaneous busy percentage answers "was it busy the moment
// I looked", which is not the question anyone is asking; the client's Health
// page keeps a minute of samples and shows the ninetieth percentile.

// No ceiling: the runtime dropped its own profile cap, so a snapshot can be
// larger than any number this file could have guessed, and refusing to read it
// would report a working runtime as absent — the failure the panel exists to
// tell apart from a real one.
const MAX_SNAPSHOT_BYTES = null;
// Measured against the heartbeat, not against the busy cadence: the service
// publishes every two seconds under load, backs off to ten when idle, and
// emits a proof-of-life heartbeat every ten seconds, so an idle desk that is
// perfectly healthy can be five seconds old at any moment. Fifteen seconds is
// one and a half heartbeats — long enough that a working runtime is never
// reported stale, short enough that a stopped one is named quickly. Shortening
// it towards the two-second figure would report every idle desk as stale.
const STALE_AFTER_MS = 15000;
// The one contract number the panel does check. The canonical schema pins
// `version` to 1, and the deployment order is reader before writer, so a
// document announcing anything else is a runtime this panel is too old to
// read. Saying so is the point: an unrecognised document rendered field by
// field draws a healthy runtime with nothing queued, nothing running and
// nothing to review — the same picture as an idle desk.
const SNAPSHOT_VERSION = 1;
const RUNTIME_STATE_PATH = "~/.local/state/xpu-workload-manager/state.json";

const EMPTY_STATE = Object.freeze({
    runtime: "absent",
    detail: "",
    available: false,
    backend: null,
    reason: "",
    queued: 0,
    running: 0,
    attention: 0,
    paused: false,
    generatedAt: null,
    // The file the state was read from, expanded. Carried by the state rather
    // than asked of the applet because it is the answer to "which file", and
    // the state is what the panel draws that answer from.
    source: "",
});

function expandHome(environment, filename) {
    if (typeof filename !== "string" || !filename.startsWith("~/")) {
        return filename;
    }
    return `${environment.GLib.get_home_dir()}/${filename.slice(2)}`;
}

function isRecord(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isCount(value) {
    return Number.isInteger(value) && value >= 0;
}

// The members a version-1 document has to carry for the figures the panel
// draws to mean anything, and the type each of them has to be. Every one is
// `required` in the canonical schema, and a contract gate holds this list to
// that so the panel cannot come to demand something the runtime may omit.
//
// This is the other half of the version check. Absent was read as zero
// everywhere it mattered: a document publishing no `metrics` at all, or a
// `queueDepth` the writer renamed or started quoting, drew a healthy runtime
// with nothing queued, nothing running and nothing to review — which is
// exactly what an idle desk looks like, and exactly the picture refusing an
// unknown version exists to prevent.
const REQUIRED_MEMBERS = Object.freeze([
    {kind: "an array", name: "devices", accepts: Array.isArray},
    {kind: "an object", name: "metrics", accepts: isRecord},
    {kind: "an array", name: "alerts", accepts: Array.isArray},
]);
const REQUIRED_COUNTS = Object.freeze(["queueDepth", "runningProfiles"]);

// The first member the panel cannot read, named as the sentence the popup
// shows, or null when the document carries them all.
function unreadableMember(document) {
    for (const {accepts, kind, name} of REQUIRED_MEMBERS) {
        if (document[name] === undefined) {
            return `The runtime snapshot publishes no ${name}`;
        }
        if (!accepts(document[name])) {
            return `The runtime snapshot's ${name} is not ${kind}`;
        }
    }
    for (const name of REQUIRED_COUNTS) {
        const count = document.metrics[name];
        if (count === undefined) {
            return `The runtime snapshot publishes no metrics.${name}`;
        }
        if (!isCount(count)) {
            return `The runtime snapshot's metrics.${name} is not a count`;
        }
    }
    return null;
}

// The device the panel speaks for: the runtime orders backends gpu > npu >
// tpu and never schedules onto a CPU, so the first available device in that
// order is the one the label names.
const BACKEND_ORDER = Object.freeze(["gpu", "npu", "tpu"]);

function primaryDevice(devices) {
    const usable = devices.filter((device) => isRecord(device));
    for (const backend of BACKEND_ORDER) {
        const available = usable.find(
            (device) => device.backend === backend && device.available === true,
        );
        if (available) {
            return available;
        }
    }
    return usable.find((device) => device.available === true) || usable[0] || null;
}

function unresolvedAlerts(alerts) {
    return alerts.filter((alert) => isRecord(alert) && alert.resolved !== true).length;
}

// A runtime word rather than an exception: every failure to read is a state
// the panel has to draw, so each one is named instead of thrown.
function failed(runtime, detail) {
    return Object.freeze({...EMPTY_STATE, runtime, detail});
}

function deviceFields(device) {
    if (!isRecord(device)) {
        return {available: false, backend: null, reason: ""};
    }
    return {
        available: device.available === true,
        backend: typeof device.backend === "string" ? device.backend : null,
        reason: typeof device.reason === "string" ? device.reason : "",
    };
}

function isStale(generatedAt, nowMs) {
    return generatedAt !== null && nowMs - generatedAt > STALE_AFTER_MS;
}

// The six figures the panel draws, from a document already known to be one
// this panel can read. Absent is not zero anywhere: a field the runtime did
// not publish falls back to the empty state's value rather than to a figure
// the panel would then show as fact.
function connectedState(document, generatedAt) {
    // A hold is the runtime's own state, not a window's: the service enforces
    // it with or without a client attached, so the panel reads it from the
    // snapshot rather than inferring it from an empty queue. A runtime that
    // predates the field publishes no policy at all, which reads as not held —
    // which is why `policy` is not among the members demanded above.
    const policy = isRecord(document.policy) ? document.policy : {};
    return Object.freeze({
        runtime: "connected",
        detail: "",
        ...deviceFields(primaryDevice(document.devices)),
        queued: document.metrics.queueDepth,
        running: document.metrics.runningProfiles,
        attention: unresolvedAlerts(document.alerts),
        paused: policy.paused === true,
        generatedAt,
    });
}

// The version as it was published, not as it prints. A template renders the
// string `"1"` and the number 1 as the same character, so a writer that quoted
// its version number produced "snapshot version 1, not 1": a mismatch report
// that names no mismatch, in the one line `docs/deployment.md` tells an
// installer to read to find out which half of a half-finished upgrade is
// behind. A document with no version at all said "version undefined", which
// names a JavaScript value rather than a fact about the runtime.
function versionMismatch(value) {
    if (value === undefined) {
        return "The runtime publishes a snapshot with no version, and this panel "
            + `reads version ${SNAPSHOT_VERSION}`;
    }
    const quoted = JSON.stringify(value);
    const shown = quoted === undefined ? String(value) : quoted;
    return `The runtime publishes snapshot version ${shown}, not ${SNAPSHOT_VERSION}`;
}

// The envelope, and only the envelope: is this a document, is it a version
// this panel reads, does it carry the members the figures come out of, and is
// it recent enough to believe. Each answer is a runtime word the panel can
// draw; the figures are read once all four pass.
function stateFromDocument(document, nowMs) {
    if (!isRecord(document)) {
        return failed("malformed", "The runtime snapshot is not an object");
    }
    if (document.version !== SNAPSHOT_VERSION) {
        return failed("malformed", versionMismatch(document.version));
    }
    const unreadable = unreadableMember(document);
    if (unreadable !== null) {
        return failed("malformed", unreadable);
    }
    const generatedAt = Number.isInteger(document.generatedAt) ? document.generatedAt : null;
    if (isStale(generatedAt, nowMs)) {
        return Object.freeze({
            ...EMPTY_STATE,
            runtime: "stale",
            detail: "The runtime stopped publishing",
            generatedAt,
        });
    }
    return connectedState(document, generatedAt);
}

// A read that was asked for and never answered.
//
// The panel drops a tick that finds the previous read still outstanding, so a
// read that never completes is not a slow panel but a stopped one: it goes on
// drawing the last picture it had for the rest of the session. Staleness
// cannot catch that — `generatedAt` is judged when bytes arrive, and no bytes
// ever arrive — so the wait itself is the fact, and the elapsed time is named
// because a number that keeps growing is how a person tells this apart from a
// panel that has simply stopped.
function unansweredRead(waitedMs) {
    const seconds = Math.max(1, Math.round(waitedMs / 1000));
    return failed(
        "unreadable",
        `The runtime snapshot has not answered in ${seconds} seconds`,
    );
}

// The ceiling is off by default rather than deleted: a caller that sets one is
// still held to it, so re-imposing a bound is a one-line change.
function tooLargeFor(contents, ceiling) {
    if (ceiling === null || contents.length <= ceiling) {
        return null;
    }
    return failed("malformed", "The runtime snapshot is larger than the panel reads");
}

// The refusals a desk actually meets, each answered with a sentence.
//
// Not-found is the ordinary one — the service is not running — and is reported
// as absence rather than as a failure someone should act on. The other two are
// the ones a person can fix and could not read: a state file owned by another
// account, and a `runtime-state-path` that names a directory. Both used to be
// answered by interpolating the platform's own error into the tooltip, so the
// panel said "Gio.IOErrorEnum: Error opening file /home/…/state.json:
// Permission denied" where a sentence belongs. Anything else keeps the raw
// error, because a refusal nobody predicted is better shown than renamed.
const READ_REFUSALS = Object.freeze([
    {code: "NOT_FOUND", detail: "The runtime is not running", runtime: "absent"},
    {
        code: "PERMISSION_DENIED",
        detail: "The runtime snapshot cannot be read: permission denied",
        runtime: "unreadable",
    },
    {
        code: "IS_DIRECTORY",
        detail: "The runtime snapshot path names a directory, not a file",
        runtime: "unreadable",
    },
]);

// `environment` carries GLib and Gio so this stays testable off a desktop:
// the applet passes the real ones, a test passes doubles.
// Asked through `matches` where the platform offers it: a bare `code`
// comparison says nothing about which error domain raised it, so any domain
// whose first enumerated value happens to be 1 would be drawn as a runtime
// that is simply not running. A platform whose IO domain does not enumerate
// the code at all matches nothing, rather than matching every error with no
// code of its own.
function matchesCode(environment, error, code) {
    const errors = environment.Gio.IOErrorEnum;
    if (errors === undefined || !error || errors[code] === undefined) {
        return false;
    }
    if (typeof error.matches === "function") {
        return error.matches(errors, errors[code]) === true;
    }
    return error.code === errors[code];
}

function refusalFor(environment, error) {
    return READ_REFUSALS.find((refusal) => matchesCode(environment, error, refusal.code)) || null;
}

// The moment the document is judged against, asked for where it is judged.
// A read handed a number was judged against the clock of the turn that asked
// for it, not the turn its bytes arrived in — so a load the disk stalled on
// was reported fresher than it was, which is backwards for the one check that
// exists to notice that publishing stopped. A function is read at parse time;
// a number is still accepted, because a caller that means one fixed instant —
// a test, or the synchronous path's own single turn — is saying so.
function resolveNow(clock) {
    return typeof clock === "function" ? clock() : clock;
}

// One document, from bytes to a runtime word. Shared by both read paths so
// the asynchronous one cannot drift into reporting a different state for the
// same file than the synchronous one does.
function stateFromContents(environment, ok, contents, clock) {
    if (!ok) {
        return failed("unreadable", "The runtime snapshot could not be read");
    }
    const oversized = tooLargeFor(contents, MAX_SNAPSHOT_BYTES);
    if (oversized !== null) {
        return oversized;
    }
    let document;
    try {
        document = JSON.parse(environment.decode(contents));
    } catch (error) {
        return failed("malformed", `The runtime snapshot is not valid JSON: ${error}`);
    }
    return stateFromDocument(document, resolveNow(clock));
}

function stateFromError(environment, error) {
    const refusal = refusalFor(environment, error);
    return refusal === null
        ? failed("unreadable", `The runtime snapshot could not be read: ${error}`)
        : failed(refusal.runtime, refusal.detail);
}

// The path is attached where the read happens rather than threaded through
// every judgement it passes: which file was read is a fact about the read, not
// about the document, and one place to attach it is one place for it to be
// right. The popup names it, because a `runtime-state-path` that disagrees
// with the service's own is a configuration mistake wearing the costume of an
// absent service, and the path is what tells the two apart.
function readFrom(state, target) {
    return Object.freeze({...state, source: target});
}

function readSnapshot(environment, filename, clock) {
    const target = expandHome(environment, filename);
    try {
        const file = environment.Gio.File.new_for_path(target);
        const [ok, contents] = file.load_contents(null);
        return readFrom(stateFromContents(environment, ok, contents, clock), target);
    } catch (error) {
        return readFrom(stateFromError(environment, error), target);
    }
}

// The panel reads this file on every tick, and the applet runs on Cinnamon's
// compositor thread: a blocking read there stalls the whole desktop for as
// long as the disk takes, and the document has no ceiling — the canonical
// schema permits 128 plugin telemetry entries, 64 kernel histograms and 256
// policy profiles, all of which grow with the host. So the bytes arrive from
// the asynchronous form and the parse happens on its callback.
//
// `deliver` is called exactly once, with a state, whatever happened; the state
// machine already has a word for every failure. The synchronous form remains
// the fallback for a platform whose Gio offers no asynchronous load, and is
// what the return value distinguishes: true when the read was handed to the
// mainloop, false when it had already finished by the time this returned.
// "Exactly once" made structural rather than promised. The consumer of a state
// is the panel, and drawing can throw — a destroyed actor, a tooltip already
// gone — so a delivery is not a call that always returns. Wrapped in the
// error handling around the read it would be caught as though the *read* had
// failed, delivering a second, invented state after the real one; the panel
// would then latch onto an "unreadable" runtime it never saw.
function deliverOnce(deliver) {
    let delivered = false;
    return (state) => {
        if (delivered) {
            return false;
        }
        delivered = true;
        deliver(state);
        return true;
    };
}

function readSnapshotAsync(environment, filename, clock, deliverState) {
    let target = filename;
    let file;
    const deliver = deliverOnce((state) => deliverState(readFrom(state, target)));
    try {
        target = expandHome(environment, filename);
        file = environment.Gio.File.new_for_path(target);
    } catch (error) {
        deliver(stateFromError(environment, error));
        return false;
    }
    if (typeof file.load_contents_async !== "function") {
        deliver(readSnapshot(environment, filename, clock));
        return false;
    }
    // Arming the read can fail as loudly as finishing it — a path Gio refuses
    // outright, a mainloop that is gone — and a throw here used to escape
    // without ever calling `deliver`. The applet holds a latch while a read is
    // outstanding and only drops it when the state arrives, so one such throw
    // froze the panel on its last picture for the rest of the session. Every
    // exit from this function delivers exactly one state.
    try {
        file.load_contents_async(null, (source, result) => {
            let state;
            try {
                const [ok, contents] = (source || file).load_contents_finish(result);
                state = stateFromContents(environment, ok, contents, clock);
            } catch (error) {
                state = stateFromError(environment, error);
            }
            deliver(state);
        });
    } catch (error) {
        deliver(stateFromError(environment, error));
        return false;
    }
    return true;
}

module.exports = {
    BACKEND_ORDER,
    connectedState,
    deviceFields,
    EMPTY_STATE,
    MAX_SNAPSHOT_BYTES,
    READ_REFUSALS,
    REQUIRED_COUNTS,
    REQUIRED_MEMBERS,
    RUNTIME_STATE_PATH,
    SNAPSHOT_VERSION,
    STALE_AFTER_MS,
    expandHome,
    matchesCode,
    primaryDevice,
    readFrom,
    readSnapshot,
    readSnapshotAsync,
    refusalFor,
    resolveNow,
    stateFromContents,
    stateFromError,
    stateFromDocument,
    tooLargeFor,
    unansweredRead,
    unreadableMember,
    versionMismatch,
};
