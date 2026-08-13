"use strict";

const I18n = require("./i18n.js");

const {N_} = I18n;

// The default text is intentionally byte-for-byte the Cinnamon/Linux UX that
// shipped before guidance became a composition port.
const POSIX_RUNTIME_RECOVERY = Object.freeze({
    "not-started": Object.freeze({
        kicker: N_("Starting"),
        title: N_("Monitoring has not started"),
        description: N_("No runtime state has been read yet. Local profile intent is unchanged."),
        steps: Object.freeze([
            Object.freeze(["1", N_("Wait for the first read"), N_("Monitoring starts with the applet and repeats on the refresh interval.")]),
            Object.freeze(["2", N_("Check the runtime path"), N_("Open the settings and confirm the runtime state path.")]),
        ]),
    }),
    absent: Object.freeze({
        kicker: N_("Runtime absent"),
        title: N_("No runtime service is publishing state"),
        description: N_("Device detection still works. Queue, load, and profile telemetry stay unknown until a runtime publishes a snapshot."),
        steps: Object.freeze([
            Object.freeze(["1", N_("Start the workload runtime"), N_("A trusted local service must publish the snapshot document.")]),
            Object.freeze(["2", N_("Check the runtime path"), N_("Confirm the configured runtime state path matches the service.")]),
        ]),
    }),
    stale: Object.freeze({
        kicker: N_("Runtime stale"),
        title: N_("The runtime snapshot stopped updating"),
        description: N_("The last snapshot is older than its freshness deadline, so its values are no longer shown as current."),
        steps: Object.freeze([
            Object.freeze(["1", N_("Check the runtime service"), N_("Confirm the service is running and still writing its snapshot.")]),
            Object.freeze(["2", N_("Check the clock"), N_("A large clock change can also age a snapshot past its deadline.")]),
        ]),
    }),
    malformed: Object.freeze({
        kicker: N_("Runtime malformed"),
        title: N_("The runtime snapshot failed validation"),
        description: N_("The document was read but rejected by the version 1 contract, so none of its values are displayed."),
        steps: Object.freeze([
            Object.freeze(["1", N_("Check the runtime version"), N_("The service must publish the version 1 snapshot contract.")]),
            Object.freeze(["2", N_("Inspect the document"), N_("Validate it against runtime-snapshot.schema.json.")]),
        ]),
    }),
    unreadable: Object.freeze({
        kicker: N_("Runtime unreadable"),
        title: N_("The runtime snapshot could not be read"),
        description: N_("Reading the snapshot failed, so device and workload telemetry are unknown rather than assumed."),
        steps: Object.freeze([
            Object.freeze(["1", N_("Check permissions"), N_("Confirm the current user can read the runtime state path.")]),
            Object.freeze(["2", N_("Check the path"), N_("A missing directory or a replaced path object also fails the read.")]),
        ]),
    }),
    "probe-failed": Object.freeze({
        kicker: N_("Detection failed"),
        title: N_("Accelerator discovery failed"),
        description: N_("Local discovery could not complete, so device presence is unknown rather than reported as absent."),
        steps: Object.freeze([
            Object.freeze(["1", N_("Check device access"), N_("Confirm the current user can read the USB, PCIe, accel, and render device nodes.")]),
            Object.freeze(["2", N_("Retry detection"), N_("Discovery runs again on request.")]),
        ]),
    }),
    connected: Object.freeze({
        kicker: N_("Connection required"),
        title: N_("No accelerator available"),
        description: N_("Profiles remain saved locally. No data, authorization, or backup policy is changed."),
        steps: Object.freeze([
            Object.freeze(["1", N_("Check the connection"), N_("Connect a supported TPU, NPU, or GPU accelerator.")]),
            Object.freeze(["2", N_("Check device access"), N_("Confirm the current user can access the accelerator runtime.")]),
        ]),
    }),
});

const POSIX_GUIDANCE = Object.freeze({
    recoveryFor(runtime) {
        return POSIX_RUNTIME_RECOVERY[runtime] || POSIX_RUNTIME_RECOVERY.connected;
    },
});

function requireGuidancePort(candidate) {
    if (!candidate || typeof candidate.recoveryFor !== "function") {
        throw new TypeError("Platform guidance port is required");
    }
    return candidate;
}

module.exports = {
    POSIX_GUIDANCE,
    POSIX_RUNTIME_RECOVERY,
    requireGuidancePort,
};
