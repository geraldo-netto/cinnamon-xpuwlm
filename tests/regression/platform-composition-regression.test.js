"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const Caption = require("../../files/cinnamon-xpuwlm@geraldo-netto/lib/caption-export.js");
const Document = require("../../files/cinnamon-xpuwlm@geraldo-netto/lib/document-question.js");
const Events = require("../../files/cinnamon-xpuwlm@geraldo-netto/lib/event-import.js");
const Media = require("../../files/cinnamon-xpuwlm@geraldo-netto/lib/media-transcription.js");
const Paths = require("../../files/cinnamon-xpuwlm@geraldo-netto/lib/path-port.js");
const Validation = require("../../files/cinnamon-xpuwlm@geraldo-netto/lib/validation.js");
const ViewModel = require("../../files/cinnamon-xpuwlm@geraldo-netto/lib/view-model.js");

const APPLET = path.join(
    __dirname,
    "../../files/cinnamon-xpuwlm@geraldo-netto/applet.js",
);

function source(pathValue, name) {
    return {path: pathValue, name, size: 1, regular: true, symlink: false};
}

test("Linux defaults reject Windows paths while explicit sibling syntax can validate them", () => {
    const windowsDocument = source(String.raw`C:\Users\Ada\notes.pdf`, "notes.pdf");
    const windowsEvent = source(String.raw`\\server\share\event.ics`, "event.ics");
    const windowsMedia = source(String.raw`C:\Users\Ada\meeting.mp4`, "meeting.mp4");

    assert.throws(() => Document.selectedSources([windowsDocument]), /supported/u);
    assert.throws(() => Events.selectedSources([windowsEvent]), /supported/u);
    assert.throws(() => Media.selectedSource([windowsMedia]), /supported/u);
    assert.equal(Caption.validDestination(String.raw`C:\out\captions.srt`, "srt"), false);

    assert.equal(
        Document.selectedSources([windowsDocument], Paths.WINDOWS_PATHS)[0].path,
        windowsDocument.path,
    );
    assert.equal(
        Events.selectedSources([windowsEvent], Paths.WINDOWS_PATHS)[0].path,
        windowsEvent.path,
    );
    assert.equal(
        Media.selectedSource([windowsMedia], Paths.WINDOWS_PATHS).path,
        windowsMedia.path,
    );
    assert.equal(Validation.validExportDestination(
        String.raw`C:\out\captions.srt`, "srt", ["srt"], 4096, Paths.WINDOWS_PATHS,
    ), true);
});

test("applet composition no longer reaches concrete transport or discovery factories", () => {
    const sourceText = fs.readFileSync(APPLET, "utf8");
    for (const factory of [
        "CinnamonRuntime.createRuntimeGateway",
        "CinnamonRuntime.createRuntimeControlGateway",
        "CinnamonRuntime.createRuntimeJobGateway",
        "CinnamonRuntime.createControlServiceWatch",
        "CinnamonRuntime.createRuntimeContractGateway",
        "CinnamonRuntime.createPluginInventoryGateway",
        "CinnamonRuntime.createInputCatalog",
    ]) {
        assert.equal(sourceText.includes(factory), false, factory);
    }
    assert.match(sourceText, /CinnamonPlatform\.createCinnamonPlatform/u);
    assert.match(sourceText, /this\._platform\.transport/u);
    assert.match(sourceText, /this\._platform\.discovery/u);
});

test("view projection accepts platform guidance without changing the POSIX default", () => {
    const state = {
        profiles: [], alerts: [], paused: false, selectedTab: "overview",
        device: {available: false, state: "absent", reason: "none"},
        devices: [], health: {device: "absent", runtime: "absent", detail: "none"},
        metrics: {queueDepth: null, runningProfiles: null}, generatedAt: 0,
        stale: false, source: "none", attentionCount: 0,
    };
    const defaultRecovery = ViewModel.recoveryModel(state);
    const custom = ViewModel.recoveryModel(state, {
        recoveryFor: () => ({
            kicker: "Other OS", title: "Other service", description: "Other transport",
            steps: [["1", "Open service", "Use platform tools"]],
        }),
    });
    assert.equal(defaultRecovery.title, "No runtime service is publishing state");
    assert.equal(custom.title, "Other service");
    assert.equal(custom.steps[0].description, "Use platform tools");
});
