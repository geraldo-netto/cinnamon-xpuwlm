"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const Domain = require("../../files/cinnamon-tpuwm@geraldo-netto/lib/domain.js");
const BuiltIns = require("../helpers/built-in-workloads.js");
const ViewModel = require("../../files/cinnamon-tpuwm@geraldo-netto/lib/view-model.js");

const NOW = 1_700_000_000_000;

function state(overrides = {}) {
    const profiles = new Domain.WorkloadPortfolio(null, BuiltIns.coreCatalog()).list({
        "hardware-health": {status: "running", queued: 2, detail: "sampling"},
    });
    return {
        selectedTab: "overview",
        paused: false,
        profiles,
        device: {
            id: "tpu-usb",
            backend: "tpu",
            available: true,
            state: "present",
            name: "Coral USB",
            kind: "usb",
            vendor: "",
            load: 41.4,
            reason: "",
        },
        health: {device: "present", runtime: "connected", detail: ""},
        metrics: {queueDepth: 2, runningProfiles: 1},
        alerts: [],
        attentionCount: 0,
        stale: false,
        source: "runtime",
        generatedAt: NOW - 1000,
        ...overrides,
    };
}

test("formatters distinguish missing, recent, minute, and hour values", () => {
    assert.equal(ViewModel.formatLoad(48.8), "49%");
    assert.equal(ViewModel.formatLoad(null), "—");
    assert.equal(ViewModel.formatFraction(0.456), "46%");
    assert.equal(ViewModel.formatFraction("0.5"), "—");
    assert.equal(ViewModel.formatRelativeTime(0, NOW), "unknown");
    assert.equal(ViewModel.formatRelativeTime(NOW - 2000, NOW), "just now");
    assert.equal(ViewModel.formatRelativeTime(NOW - 20_000, NOW), "20s ago");
    assert.equal(ViewModel.formatRelativeTime(NOW - 120_000, NOW), "2m ago");
    assert.equal(ViewModel.formatRelativeTime(NOW - 7_200_000, NOW), "2h ago");
    assert.equal(ViewModel.formatRelativeTime(NOW + 5000, NOW), "just now");
});

test("profile grouping preserves first-seen order and clones entries", () => {
    const profiles = [
        {id: "a", group: "One"},
        {id: "b", group: "Two"},
        {id: "c", group: "One"},
    ];
    const groups = ViewModel.groupProfiles(profiles);
    assert.deepEqual(groups.map((group) => group.name), ["One", "Two"]);
    assert.deepEqual(groups[0].profiles.map((profile) => profile.id), ["a", "c"]);
    groups[0].profiles[0].id = "changed";
    assert.equal(profiles[0].id, "a");
});

test("panel state communicates offline, paused, attention, and online modes", () => {
    assert.equal(ViewModel.attentionReviewText(1), "1 item needs review");
    assert.equal(ViewModel.attentionReviewText(2), "2 items need review");
    assert.deepEqual(ViewModel.panelModel(state({
        device: {available: false, reason: "Disconnected"},
    })), {
        accessibleName: "TPU Workload Manager, unavailable: Disconnected",
        label: "Accel Offline",
        status: "unavailable",
        severity: null,
        tooltip: "TPU Workload Manager — Disconnected",
    });
    assert.deepEqual(ViewModel.panelModel(state({paused: true})), {
        accessibleName: "TPU Workload Manager, paused: all workloads paused",
        label: "Accel Paused",
        status: "paused",
        severity: null,
        tooltip: "TPU Workload Manager — all workloads paused",
    });
    assert.deepEqual(ViewModel.panelModel(state({source: "probe"})), {
        accessibleName: "TPU Workload Manager, detected: hardware detected; runtime not connected",
        label: "TPU Detected",
        status: "detected",
        severity: null,
        tooltip: "TPU Workload Manager — hardware detected; runtime not connected",
    });
    assert.deepEqual(ViewModel.panelModel(state({attentionCount: 2})), {
        accessibleName: "TPU Workload Manager, attention: 2 items need review, highest severity none",
        label: "TPU 41% · none",
        status: "attention",
        severity: null,
        tooltip: "TPU Workload Manager — 2 items need review, highest severity none",
    });
    assert.deepEqual(ViewModel.panelModel(state()), {
        accessibleName: "TPU Workload Manager, online: 41% load",
        label: "TPU 41%",
        status: "online",
        severity: null,
        tooltip: "TPU Workload Manager — online",
    });
});

test("effective screen gives safety states precedence over tabs", () => {
    assert.equal(ViewModel.effectiveScreen(state({device: {available: false}})), "unavailable");
    assert.equal(ViewModel.effectiveScreen(state({paused: true})), "paused");
    assert.equal(ViewModel.effectiveScreen(state({selectedTab: "alerts"})), "alerts");
    assert.equal(ViewModel.effectiveScreen(state({selectedTab: "future"})), "overview");
    assert.equal(ViewModel.toViewModel(state({paused: true}), NOW).showTabs, false);

    const unavailablePaused = ViewModel.toViewModel(state({
        paused: true,
        device: {available: false, name: "No TPU", kind: "unknown", reason: "Disconnected"},
    }), NOW);
    assert.equal(unavailablePaused.screen, "unavailable");
    assert.equal(unavailablePaused.policyPaused, true);
    assert.equal(ViewModel.toViewModel(state(), NOW).policyPaused, false);
});

test("metrics explain normal and held workload state", () => {
    const normal = ViewModel.metricModels(state({attentionCount: 1}));
    assert.deepEqual(normal[1], {label: "Queue", value: "2", suffix: "jobs"});
    assert.equal(normal[3].suffix, "item · none");
    assert.equal(normal[3].tone, "attention");
    const paused = ViewModel.metricModels(state({paused: true, attentionCount: 0}));
    assert.equal(paused[0].value, "0%");
    assert.equal(paused[1].suffix, "held");
    assert.equal(paused[2].value, "0");
    assert.equal(paused[3].value, "Paused");
});

test("alert model resolves profile titles and evidence", () => {
    const profiles = state().profiles;
    const known = ViewModel.alertModel({
        profileId: "hardware-health",
        timestamp: NOW - 10_000,
        confidence: 0.8,
        riskScore: null,
    }, profiles, NOW);
    assert.equal(known.profileTitle, "Hardware health");
    assert.equal(known.age, "10s ago");
    assert.equal(known.confidenceText, "80%");
    assert.equal(known.riskText, "—");
    assert.equal(ViewModel.alertModel({profileId: "missing"}, profiles, NOW).profileTitle, "Unknown profile");
});

test("active alert comparator prioritizes severity, recency, then stable ID", () => {
    const base = {id: "beta", severity: "warning", timestamp: NOW};
    assert.ok(ViewModel.compareActiveAlerts(
        {...base, severity: "critical"},
        {...base, severity: "warning"},
    ) < 0);
    assert.ok(ViewModel.compareActiveAlerts(
        {...base, timestamp: NOW},
        {...base, timestamp: NOW - 1},
    ) < 0);
    assert.ok(ViewModel.compareActiveAlerts(
        {...base, id: "alpha"},
        {...base, id: "beta"},
    ) < 0);
    assert.ok(ViewModel.compareActiveAlerts(
        {...base, id: "beta"},
        {...base, id: "alpha"},
    ) > 0);
    assert.equal(ViewModel.compareActiveAlerts(base, {...base}), 0);
});

test("view model sorts only active alerts without mutating runtime order", () => {
    const alerts = [
        {id: "resolved", profileId: "hardware-health", title: "Resolved", severity: "critical", timestamp: NOW, resolved: true},
        {id: "warning-old", profileId: "hardware-health", title: "Warning old", severity: "warning", timestamp: NOW - 2000, resolved: false},
        {id: "advisory", profileId: "hardware-health", title: "Advisory", severity: "advisory", timestamp: NOW, resolved: false},
        {id: "critical", profileId: "hardware-health", title: "Critical", severity: "critical", timestamp: NOW - 5000, resolved: false},
        {id: "warning-z", profileId: "hardware-health", title: "Warning Z", severity: "warning", timestamp: NOW - 1000, resolved: false},
        {id: "warning-a", profileId: "hardware-health", title: "Warning A", severity: "warning", timestamp: NOW - 1000, resolved: false},
    ];
    const runtimeOrder = alerts.map((alert) => alert.id);
    const model = ViewModel.toViewModel(state({alerts, attentionCount: 5}), NOW);

    assert.deepEqual(model.activeAlerts.map((alert) => alert.id), [
        "critical",
        "warning-a",
        "warning-z",
        "warning-old",
        "advisory",
    ]);
    assert.deepEqual(model.resolvedAlerts.map((alert) => alert.id), ["resolved"]);
    assert.deepEqual(alerts.map((alert) => alert.id), runtimeOrder);
});

test("view model groups profiles, separates alerts, and creates stable body key", () => {
    const alerts = [
        {id: "a", profileId: "hardware-health", title: "Review", timestamp: NOW, confidence: 0.5, riskScore: 0.4, resolved: false},
        {id: "b", profileId: "hardware-health", title: "Done", timestamp: NOW, confidence: 0.9, riskScore: 0.2, resolved: true},
    ];
    const model = ViewModel.toViewModel(state({alerts, attentionCount: 1}), NOW);
    assert.equal(model.screen, "overview");
    assert.equal(model.device.status, "Online");
    assert.equal(model.showTabs, true);
    assert.equal(model.enabledGroups.length, 3);
    assert.equal(model.allGroups.length, 3);
    assert.equal(model.pausedProfiles.length, 3);
    assert.equal(model.activeAlerts.length, 1);
    assert.equal(model.resolvedAlerts.length, 1);
    assert.match(model.headerSubtitle, /Updated just now/);
    assert.match(
        ViewModel.toViewModel(state({
            source: "probe",
            health: {device: "present", runtime: "absent", detail: ""},
        }), NOW).headerSubtitle,
        /Runtime absent/,
    );
    assert.doesNotThrow(() => JSON.parse(model.bodyKey));
    const agedModel = ViewModel.toViewModel(state({alerts, attentionCount: 1}), NOW + 10_000);
    assert.notEqual(agedModel.bodyKey, model.bodyKey);

    const offline = ViewModel.toViewModel(state({
        device: {available: false, state: "absent", name: "No TPU", kind: "unknown", reason: "Connect device"},
        health: {device: "absent", runtime: "connected", detail: "Connect device"},
    }), NOW);
    assert.equal(offline.device.status, "No device");
    assert.equal(offline.showTabs, false);
    assert.match(offline.headerSubtitle, /Connect device/);

    const pending = ViewModel.toViewModel(state({
        control: {pending: true, message: "Applying change in runtime…"},
    }), NOW);
    assert.equal(pending.controlPending, true);
    assert.match(pending.controlMessage, /Applying/u);
    assert.notEqual(pending.bodyKey, model.bodyKey);
});

test("body key tracks every rendered field of a same-identity alert", () => {
    const alert = {
        id: "stable-alert",
        profileId: "hardware-health",
        title: "Voltage drift",
        summary: "Review the supply",
        severity: "warning",
        timestamp: NOW,
        confidence: 0.2,
        riskScore: 0.3,
        resolved: false,
    };
    const initial = ViewModel.toViewModel(state({alerts: [alert], attentionCount: 1}), NOW);
    const equivalent = ViewModel.toViewModel(state({alerts: [{...alert}], attentionCount: 1}), NOW);
    assert.equal(equivalent.bodyKey, initial.bodyKey);

    for (const [field, value] of Object.entries({
        title: "Critical voltage drift",
        summary: "Disconnect the supply",
        severity: "critical",
        confidence: 0.8,
        riskScore: 0.9,
    })) {
        const changed = ViewModel.toViewModel(state({
            alerts: [{...alert, [field]: value}],
            attentionCount: 1,
        }), NOW);
        assert.notEqual(changed.bodyKey, initial.bodyKey, field);
    }
});

test("each blocked profile names its own reason and points at Setup", () => {
    const runnable = ViewModel.profileModel({
        id: "a",
        group: "g",
        executable: true,
        status: "watching",
        detail: "Serving on gpu",
    });
    assert.equal(runnable.executable, true);
    assert.equal(runnable.blocker, null);
    assert.equal(runnable.executableText, "");

    const reasons = {
        model: ["Ready on gpu; no model bundled", "No model installed"],
        runtime: ["gpu: ncnn is not installed", "Accelerator runtime not installed"],
        hardware: ["tpu: No Coral Edge TPU device detected", "No supported accelerator present"],
    };
    for (const [kind, [detail, reason]] of Object.entries(reasons)) {
        const blocked = ViewModel.profileModel({
            id: kind,
            group: "g",
            executable: true,
            status: "unavailable",
            detail,
        });
        assert.equal(blocked.executable, false, kind);
        assert.equal(blocked.blocker.kind, kind);
        assert.equal(blocked.blocker.reason, reason);
        assert.equal(blocked.executableText, `${reason} · see Setup`);
    }

    // An unrecognised reason is quoted, never relabelled or dropped.
    const unknown = ViewModel.profileModel({
        id: "d",
        group: "g",
        status: "unavailable",
        detail: "gpu: something nobody has written a label for",
    });
    assert.equal(unknown.blocker.kind, "unknown");
    assert.equal(unknown.blocker.reason, "gpu: something nobody has written a label for");
    assert.equal(ViewModel.blockerReasonText({kind: "unknown", detail: ""}), "the runtime gave no reason");
    assert.equal(ViewModel.blockerModel(null), null);

    // A projection built before this field existed must not be reported as
    // unrunnable on the strength of a missing property.
    assert.equal(ViewModel.profileModel({id: "c", group: "g", detail: "Serving on gpu"}).executable, true);
});

test("the blocked group derives its own size from the live snapshot", () => {
    assert.equal(ViewModel.blockedGroupModel([]), null);
    assert.equal(ViewModel.inexecutableCount([]), 0);

    const serving = state({
        profiles: new Domain.WorkloadPortfolio(null, BuiltIns.coreCatalog())
            .list(BuiltIns.servingProfiles()),
    });
    const ready = ViewModel.toViewModel(serving, NOW);
    assert.equal(ready.inexecutableCount, 0);
    assert.equal(ready.blockedGroup, null);
    assert.deepEqual(ready.blockedProfiles, []);
    assert.equal(
        ready.runnableGroups.flatMap((group) => group.profiles).length,
        serving.profiles.length,
    );

    // Nothing counts profiles from the shipped catalog: one profile stops
    // serving and both sides of the split follow it.
    const partial = state({
        profiles: serving.profiles.map((profile) => (profile.id === "desktop-context"
            ? {...profile, status: "unavailable", detail: "gpu: ncnn is not installed"}
            : profile)),
    });
    const mixed = ViewModel.toViewModel(partial, NOW);
    assert.equal(mixed.inexecutableCount, 1);
    assert.deepEqual(mixed.blockedProfiles.map((profile) => profile.id), ["desktop-context"]);
    assert.equal(mixed.blockedGroup.count, 1);
    assert.equal(mixed.blockedGroup.label, "Not available (1)");
    assert.equal(mixed.blockedGroup.summary, "1 profile cannot run yet");
    assert.equal(mixed.blockedGroup.collapsedName, "Not available, 1 profile, collapsed");
    assert.equal(mixed.blockedGroup.expandedName, "Not available, 1 profile, expanded");
    assert.equal(
        mixed.runnableGroups.flatMap((group) => group.profiles).some((profile) => profile.id === "desktop-context"),
        false,
    );

    // What the shipped catalog collapses is derived twice over: `visual-library`
    // declares a model, and `hardware-health` is serving in this state, so the
    // group is the rest and states its own size in the plural.
    const shipped = ViewModel.toViewModel(state(), NOW);
    const collapsed = state().profiles.filter(
        (profile) => profile.id !== "hardware-health" && !profile.executable,
    ).length;
    assert.equal(shipped.inexecutableCount, collapsed);
    assert.equal(shipped.blockedGroup.count, collapsed);
    assert.equal(shipped.blockedGroup.summary, `${collapsed} profiles cannot run yet`);
    assert.equal(
        shipped.runnableGroups.flatMap((group) => group.profiles).map((profile) => profile.id)
            .includes("visual-library"),
        true,
        "the workload that declares a model is not collapsed with the ones that cannot run",
    );
});

test("the setup projection groups blocked profiles by the remedy they need", () => {
    const details = {
        "hardware-health": "Ready on gpu; no model bundled",
        "storage-intelligence": "Ready on gpu; no model bundled",
        "desktop-context": "gpu: ncnn is not installed",
        "build-advisor": "tpu: No Coral Edge TPU device detected",
        "document-intelligence": "gpu: a reason with no label",
    };
    const profiles = new Domain.WorkloadPortfolio(null, BuiltIns.coreCatalog())
        .list(BuiltIns.servingProfiles())
        .map((profile) => (Object.hasOwn(details, profile.id)
            ? {...profile, status: "unavailable", detail: details[profile.id]}
            : profile));
    const setup = ViewModel.toViewModel(state({profiles}), NOW).setup;

    assert.equal(setup.resolved, false);
    assert.equal(setup.title, "What these profiles need");
    assert.equal(setup.summary, "3 of 8 workload profiles can run on this machine");
    // Ordered by how reachable the remedy is: a package first, then work with
    // no honest generic command, then hardware that cannot be installed.
    assert.deepEqual(setup.sections.map((section) => section.kind), [
        "runtime", "model-design", "hardware", "unknown",
    ]);
    assert.deepEqual(
        setup.sections.map((section) => section.profiles.map((profile) => profile.id)),
        [
            ["desktop-context"],
            ["hardware-health", "storage-intelligence"],
            ["build-advisor"],
            ["document-intelligence"],
        ],
    );

    const [runtime, modelDesign, hardware, unknown] = setup.sections;
    assert.match(runtime.command, /^pip install 'omnitensor\[gpu\]'$/u);
    assert.equal(modelDesign.command, "");
    assert.match(modelDesign.note, /Do not attach arbitrary weights/u);
    // No command exists for missing hardware, and none is invented.
    assert.equal(hardware.command, "");
    assert.equal(hardware.note, "");
    assert.equal(unknown.command, "");
    // The unrecognised reason survives into the tab that explains it.
    assert.equal(unknown.profiles[0].reason, "gpu: a reason with no label");
});

test("setup separates local forecasting, missing design, and broken artifacts", () => {
    const blocked = (id, reason) => ViewModel.profileModel({
        id,
        title: id,
        status: "unavailable",
        detail: "localized detail",
        reason,
        executable: false,
    });
    const setup = ViewModel.setupModel([
        blocked("resource-scheduler", "no-model"),
        blocked("hardware-health", "no-model"),
        blocked("visual-library", "artifact-unavailable"),
    ]);

    assert.deepEqual(setup.sections.map((section) => section.kind), [
        "forecast", "model", "model-design",
    ]);
    assert.match(setup.sections[0].command, /^omnitensor-record-runtime-snapshot /u);
    assert.match(setup.sections[0].note, /omnitensor-install-trained-model/u);
    assert.match(setup.sections[1].command, /^omnitensor-prepare-artifact /u);
    assert.equal(setup.sections[2].command, "");

    const legacyResource = ViewModel.profileModel({
        id: "resource-scheduler",
        title: "resource-scheduler",
        status: "unavailable",
        detail: "Ready on gpu; no model bundled",
        executable: false,
    });
    assert.equal(ViewModel.setupKind(legacyResource), "forecast");

    const currentCodeOverridesStaleDetail = ViewModel.profileModel({
        id: "visual-library",
        title: "visual-library",
        status: "unavailable",
        detail: "Ready on gpu; no model bundled",
        reason: "artifact-unavailable",
        executable: true,
    });
    assert.equal(ViewModel.setupKind(currentCodeOverridesStaleDetail), "model");
    assert.equal(ViewModel.setupKind({
        id: "resource-scheduler",
        reason: "",
        blocker: {kind: "model", detail: null},
    }), "model");
});

test("the setup projection is useful when nothing is missing at all", () => {
    const serving = state({
        profiles: new Domain.WorkloadPortfolio(null, BuiltIns.coreCatalog())
            .list(BuiltIns.servingProfiles()),
    });
    const setup = ViewModel.toViewModel(serving, NOW).setup;
    assert.equal(setup.resolved, true);
    assert.deepEqual(setup.sections, []);
    assert.equal(setup.title, "Nothing is missing");
    assert.equal(setup.summary, "8 of 8 workload profiles can run on this machine");

    // A catalog with nothing in it is not "everything works".
    assert.equal(ViewModel.setupModel([]).summary, "No workload profiles are installed.");
    assert.equal(ViewModel.setupSummary(1, 1), "1 of 1 workload profile can run on this machine");
    // An unrecognised class still gets a section rather than being dropped.
    assert.equal(ViewModel.setupSection("invented", []).title, "Reported by the runtime");
});

test("discarded runtime content is stated in words instead of vanishing", () => {
    assert.equal(ViewModel.unknownContentNotice(state()), null);
    assert.equal(ViewModel.unknownContentNotice(state({unknownContent: {profiles: 0, alerts: 0}})), null);
    assert.equal(ViewModel.toViewModel(state(), NOW).unknownContent, null);

    const single = ViewModel.unknownContentNotice(state({unknownContent: {profiles: 0, alerts: 1}}));
    assert.equal(single.title, "1 runtime item names a workload that is not installed here");
    assert.equal(
        single.detail,
        "Not shown: 0 profile update(s), 1 alert(s). Install the missing workload plug-in to see them.",
    );
    assert.equal(single.accessibleName, `${single.title}. ${single.detail}`);

    const many = ViewModel.unknownContentNotice(state({unknownContent: {profiles: 2, alerts: 3}}));
    assert.equal(many.title, "5 runtime items name workloads that are not installed here");
    assert.match(many.detail, /2 profile update\(s\), 3 alert\(s\)/u);

    // The notice is part of the body identity: it must not be lost to a
    // skipped rebuild when the rest of the state is unchanged.
    assert.notEqual(
        ViewModel.toViewModel(state({unknownContent: {profiles: 1, alerts: 0}}), NOW).bodyKey,
        ViewModel.toViewModel(state(), NOW).bodyKey,
    );
});

test("the catalog notice names plug-ins in words and stays absent when nothing changed", () => {
    assert.equal(ViewModel.catalogNoticeModel(state()), null);
    assert.equal(ViewModel.catalogNoticeModel(state({catalogChanges: {}})), null);
    assert.equal(ViewModel.catalogNoticeModel(state({
        catalogChanges: {installed: [], upgraded: [], removed: []},
    })), null);
    assert.equal(ViewModel.toViewModel(state(), NOW).catalogNotice, null);

    const single = ViewModel.catalogNoticeModel(state({
        catalogChanges: {installed: ["hardware-health"], upgraded: [], removed: []},
    }));
    assert.equal(single.title, "1 workload plug-in changed");
    assert.equal(single.detail, "Installed: Hardware health");
    assert.equal(single.dismissLabel, "Dismiss");
    assert.equal(single.accessibleName, "Workload catalog changed: Installed: Hardware health");

    // A removed plug-in is gone from the catalog, so only its identifier
    // survives; the notice must still name it rather than silently omit it.
    const many = ViewModel.catalogNoticeModel(state({
        catalogChanges: {
            installed: ["hardware-health"],
            upgraded: ["resource-scheduler"],
            removed: ["third-party-workload"],
        },
    }));
    assert.equal(many.title, "3 workload plug-ins changed");
    assert.equal(
        many.detail,
        "Installed: Hardware health · Upgraded: Resource scheduler · Removed: third-party-workload",
    );
    assert.equal(ViewModel.toViewModel(state({
        catalogChanges: {installed: [], upgraded: ["resource-scheduler"], removed: []},
    }), NOW).catalogNotice.detail, "Upgraded: Resource scheduler");
});

test("catalog change grouping keeps a fixed order and rejects non-list values", () => {
    const profiles = [{id: "alpha", title: "Alpha"}];
    assert.deepEqual(ViewModel.catalogChangeGroups({
        profiles,
        catalogChanges: {removed: ["gamma"], installed: ["alpha"], upgraded: "beta"},
    }), [
        {kind: "installed", label: "Installed", names: ["Alpha"]},
        {kind: "removed", label: "Removed", names: ["gamma"]},
    ]);
    assert.deepEqual(ViewModel.CATALOG_CHANGE_KINDS, ["installed", "upgraded", "removed"]);
    assert.equal(ViewModel.catalogEntryName(profiles, "alpha"), "Alpha");
    assert.equal(ViewModel.catalogEntryName(profiles, "missing"), "missing");
});
