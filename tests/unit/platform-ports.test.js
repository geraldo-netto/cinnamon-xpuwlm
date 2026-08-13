"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const CinnamonPlatform = require("../../files/cinnamon-xpuwlm@geraldo-netto/lib/cinnamon-platform-adapter.js");
const Guidance = require("../../files/cinnamon-xpuwlm@geraldo-netto/lib/platform-guidance.js");
const Submission = require("../../files/cinnamon-xpuwlm@geraldo-netto/lib/job-submission.js");
const Paths = require("../../files/cinnamon-xpuwlm@geraldo-netto/lib/path-port.js");
const Platform = require("../../files/cinnamon-xpuwlm@geraldo-netto/lib/platform-ports.js");

test("portable platform root shims expose their canonical modules", () => {
    assert.strictEqual(
        require("../../files/cinnamon-xpuwlm@geraldo-netto/cinnamon-platform-adapter.js"),
        CinnamonPlatform,
    );
    assert.strictEqual(
        require("../../files/cinnamon-xpuwlm@geraldo-netto/platform-guidance.js"),
        Guidance,
    );
    assert.strictEqual(
        require("../../files/cinnamon-xpuwlm@geraldo-netto/path-port.js"),
        Paths,
    );
    assert.strictEqual(
        require("../../files/cinnamon-xpuwlm@geraldo-netto/platform-ports.js"),
        Platform,
    );
});

test("POSIX paths remain the safe default and never admit Windows syntax", () => {
    assert.equal(Paths.POSIX_PATHS.isAbsolute("/tmp/item.txt"), true);
    assert.equal(Paths.POSIX_PATHS.isSafeAbsolute("/tmp/item.txt"), true);
    assert.equal(Paths.POSIX_PATHS.isSafeAbsolute("/tmp/../item.txt"), false);
    assert.equal(Paths.POSIX_PATHS.isSafeAbsolute("/tmp/item\0.txt"), false);
    assert.equal(Paths.POSIX_PATHS.isSafeAbsolute("tmp/item.txt"), false);
    assert.equal(Paths.POSIX_PATHS.isSafeAbsolute(String.raw`C:\tmp\item.txt`), false);
    assert.equal(Paths.POSIX_PATHS.isSafeAbsolute(String.raw`\\server\share\item.txt`), false);
    assert.equal(Paths.POSIX_PATHS.basename("/tmp/item.txt"), "item.txt");
    assert.equal(Paths.POSIX_PATHS.isSafeName("item.txt"), true);
    assert.equal(Paths.POSIX_PATHS.isSafeName("../item.txt"), false);
    assert.equal(Paths.POSIX_PATHS.join("/tmp/", "item.txt"), "/tmp/item.txt");
});

test("Windows paths distinguish drives and UNC from unsafe device syntax", () => {
    for (const value of [
        String.raw`C:\Users\Ada\report.txt`,
        String.raw`z:\report.txt`,
        String.raw`\\server\share\folder\report.txt`,
        String.raw`\\server\share`,
    ]) {
        assert.equal(Paths.WINDOWS_PATHS.isAbsolute(value), true, value);
        assert.equal(Paths.WINDOWS_PATHS.isSafeAbsolute(value), true, value);
    }
    for (const value of [
        String.raw`C:/Users/Ada/report.txt`,
        String.raw`C:\Users/Ada\report.txt`,
        String.raw`\\server/share\report.txt`,
        String.raw`\\?\C:\Users\Ada\report.txt`,
        String.raw`\\.\PhysicalDrive0`,
        String.raw`\rooted-only.txt`,
        String.raw`folder\report.txt`,
    ]) {
        assert.equal(Paths.WINDOWS_PATHS.isAbsolute(value), false, value);
        assert.equal(Paths.WINDOWS_PATHS.isSafeAbsolute(value), false, value);
    }
});

test("Windows paths reject traversal, ADS, reserved names, and ambiguous segments", () => {
    for (const value of [
        String.raw`C:\temp\..\report.txt`,
        String.raw`C:\temp\report.txt:private`,
        String.raw`C:\temp\CON`,
        String.raw`C:\temp\con.txt`,
        String.raw`C:\temp\NUL.log`,
        String.raw`C:\temp\COM9.txt`,
        String.raw`C:\temp\LPT1`,
        String.raw`C:\temp\\report.txt`,
        String.raw`\\server\share\\report.txt`,
        "C:\\temp\\trailing. ",
        "C:\\temp\\bad\0name.txt",
    ]) {
        assert.equal(Paths.WINDOWS_PATHS.isSafeAbsolute(value), false, value);
    }
    assert.equal(Paths.WINDOWS_PATHS.basename(String.raw`C:\temp\report.txt`), "report.txt");
    assert.equal(Paths.WINDOWS_PATHS.isSafeName("report.txt"), true);
    assert.equal(Paths.WINDOWS_PATHS.isSafeName("PRN.txt"), false);
    assert.equal(Paths.WINDOWS_PATHS.isSafeName("bad:name.txt"), false);
    assert.equal(Paths.WINDOWS_PATHS.isSafeName("bad?.txt"), false);
    assert.equal(Paths.WINDOWS_PATHS.isSafeName("bad\tname.txt"), false);
    assert.equal(
        Paths.WINDOWS_PATHS.join("C:\\temp\\", "report.txt"),
        String.raw`C:\temp\report.txt`,
    );
});

test("portable job staging composes with the injected path syntax", () => {
    assert.equal(
        Submission.stagedPath("/runtime", "visual-library", "xpuwlm-1-1"),
        "/runtime/.xpuwlm-staged/visual-library-xpuwlm-1-1.f32",
    );
    assert.equal(
        Submission.stagedPath(
            String.raw`C:\runtime`,
            "visual-library",
            "xpuwlm-1-1",
            Paths.WINDOWS_PATHS,
        ),
        String.raw`C:\runtime\.xpuwlm-staged\visual-library-xpuwlm-1-1.f32`,
    );
});

test("path and platform contracts reject partial adapters", () => {
    assert.strictEqual(Paths.requirePathPort(Paths.POSIX_PATHS), Paths.POSIX_PATHS);
    assert.throws(() => Paths.requirePathPort(null), /Path port/u);
    assert.throws(() => Paths.requirePathPort({...Paths.POSIX_PATHS, join: null}), /Path port/u);
    assert.throws(() => Paths.POSIX_PATHS.join("relative", "item"), /Safe absolute/u);
    assert.throws(() => Paths.WINDOWS_PATHS.join("C:\\temp", "NUL.txt"), /Safe absolute/u);

    const transport = {
        createControlGateway() {}, createControlWatch() {}, createContractGateway() {},
        createJobGateway() {}, createPluginInventoryGateway() {},
    };
    const discovery = {createInputCatalog() {}, createRuntimeGateway() {}};
    const composed = Platform.platformComposition({
        paths: Paths.POSIX_PATHS,
        guidance: Guidance.POSIX_GUIDANCE,
        transport,
        discovery,
    });
    assert.strictEqual(composed.transport, transport);
    assert.strictEqual(composed.discovery, discovery);
    assert.strictEqual(Platform.requirePlatformComposition(composed).paths, Paths.POSIX_PATHS);
    assert.throws(() => Platform.requirePlatformComposition(null), /composition/u);
    assert.throws(() => Platform.requireTransportPort({}), /transport/u);
    assert.throws(() => Platform.requireDiscoveryPort({}), /Discovery/u);
});

test("POSIX guidance preserves every current recovery state and fallback", () => {
    assert.strictEqual(
        Guidance.requireGuidancePort(Guidance.POSIX_GUIDANCE),
        Guidance.POSIX_GUIDANCE,
    );
    assert.throws(() => Guidance.requireGuidancePort({}), /guidance/u);
    for (const state of Object.keys(Guidance.POSIX_RUNTIME_RECOVERY)) {
        assert.strictEqual(
            Guidance.POSIX_GUIDANCE.recoveryFor(state),
            Guidance.POSIX_RUNTIME_RECOVERY[state],
        );
    }
    assert.strictEqual(
        Guidance.POSIX_GUIDANCE.recoveryFor("future-state"),
        Guidance.POSIX_RUNTIME_RECOVERY.connected,
    );
});

test("Cinnamon composes POSIX paths, Linux discovery, and D-Bus transports lazily", () => {
    const logger = {warn() {}, error() {}};
    const environment = {
        Gio: {},
        GLib: {get_home_dir: () => "/home/tester"},
    };
    const platform = CinnamonPlatform.createCinnamonPlatform({environment, logger});
    assert.strictEqual(platform.paths, Paths.POSIX_PATHS);
    assert.strictEqual(platform.guidance, Guidance.POSIX_GUIDANCE);
    assert.equal(typeof platform.discovery.createInputCatalog().pictures, "function");
    assert.equal(typeof platform.discovery.createRuntimeGateway("~/runtime.json").read, "function");
    assert.equal(typeof platform.transport.createControlGateway().send, "function");
    assert.equal(typeof platform.transport.createControlWatch().watch, "function");
    assert.equal(typeof platform.transport.createContractGateway().describe, "function");
    assert.equal(typeof platform.transport.createJobGateway().submit, "function");
    assert.equal(typeof platform.transport.createPluginInventoryGateway().describe, "function");
    assert.throws(() => CinnamonPlatform.createCinnamonPlatform(), /environment/u);
});
