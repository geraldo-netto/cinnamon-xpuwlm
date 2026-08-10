"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const Domain = require("../../files/cinnamon-tpuwm@geraldo-netto/lib/domain.js");
const BuiltIns = require("../helpers/built-in-workloads.js");
const Menu = require("../../files/cinnamon-tpuwm@geraldo-netto/lib/menu-view.js");
const ViewModel = require("../../files/cinnamon-tpuwm@geraldo-netto/lib/view-model.js");
const {
    FakeActor,
    FakeButton,
    FakeMenu,
    createAtk,
    createSt,
    findActors,
} = require("../helpers/fakes.js");

const NOW = 1_700_000_000_000;

function baseState(overrides = {}) {
    return {
        selectedTab: "overview",
        paused: false,
        // A host where the runtime serves the whole catalog, so a control that
        // is dead in these tests is dead for a reason the test states.
        profiles: new Domain.WorkloadPortfolio(null, BuiltIns.coreCatalog()).list({
            ...BuiltIns.servingProfiles(),
            "hardware-health": {status: "running", queued: 2, detail: "Serving on tpu"},
        }),
        device: {available: true, state: "present", name: "Coral USB", kind: "usb", reason: ""},
        health: {device: "present", runtime: "connected", detail: ""},
        metrics: {load: 42, queueDepth: 2, runningProfiles: 1},
        alerts: [],
        attentionCount: 0,
        stale: false,
        source: "runtime",
        generatedAt: NOW,
        ...overrides,
    };
}

function harness() {
    const calls = [];
    const tooltips = [];
    const actions = {};
    for (const name of ["selectTab", "toggleProfile", "changeWeight", "pauseAll", "resumeAll", "refresh", "openSettings", "acknowledgeCatalogChanges"]) {
        actions[name] = (...args) => calls.push([name, ...args]);
    }
    const menu = new FakeMenu();
    const view = new Menu.MenuView({
        St: createSt(),
        Clutter: {ActorAlign: {CENTER: "center"}},
        Atk: createAtk(),
        menu,
        actions,
        tooltips: (actor, text) => {
            const tooltip = {actor, text};
            tooltips.push(tooltip);
            return tooltip;
        },
    });
    return {calls, menu, tooltips, view, root: menu.actors[0]};
}

function button(root, accessibleName) {
    return findActors(root, (actor) => actor instanceof FakeButton && actor.accessibleName === accessibleName)[0];
}

// A profile the runtime cannot execute names the reason in its toggle, so the
// control is found by what it does rather than by its whole announcement.
function control(root, accessibleNamePrefix) {
    return findActors(root, (actor) => actor instanceof FakeButton
        && actor.accessibleName.startsWith(accessibleNamePrefix))[0];
}

test("menu validates dependencies and required actions", () => {
    const validActions = Object.fromEntries(
        ["selectTab", "toggleProfile", "changeWeight", "pauseAll", "resumeAll", "refresh", "openSettings", "acknowledgeCatalogChanges"]
            .map((name) => [name, () => {}]),
    );
    assert.throws(() => new Menu.MenuView({}), /dependencies/);
    assert.throws(() => new Menu.MenuView({
        St: createSt(),
        Clutter: {},
        menu: new FakeMenu(),
        actions: {...validActions, refresh: null},
    }), /refresh/);
    assert.throws(() => Menu.requireAction(null, "refresh"), /refresh/);
});

test("style and child helpers make updates idempotent", () => {
    const actor = new FakeActor();
    Menu.setStyleClass(actor, "active", true);
    assert.equal(actor.styleClasses.has("active"), true);
    Menu.setStyleClass(actor, "active", false);
    assert.equal(actor.styleClasses.has("active"), false);
    const first = new FakeActor();
    const second = new FakeActor();
    actor.add_child(first);
    actor.add_child(second);
    Menu.destroyChildren(actor);
    assert.equal(first.destroyed, true);
    assert.equal(second.destroyed, true);
    assert.equal(actor.children.length, 0);
});

test("pause control defaults to local pause intent before first render", () => {
    const {calls, root} = harness();
    button(root, "Pause all workloads").click();
    assert.deepEqual(calls, [["pauseAll"]]);
});

test("overview exposes grouped profiles and all primary actions", () => {
    const {calls, view, root} = harness();
    view.render(ViewModel.toViewModel(baseState(), NOW));
    assert.equal(button(root, "Overview tab, selected").styleClasses.has("tpuwm-tab-active"), true);
    assert.equal(button(root, "Profiles tab").styleClasses.has("tpuwm-tab-active"), false);
    button(root, "Profiles tab").click();
    button(root, "Manage workload profiles").click();
    button(root, "Refresh TPU status").click();
    button(root, "Open TPU Workload Manager settings").click();
    button(root, "Pause all workloads").click();
    control(root, "Disable Hardware health").click();
    assert.deepEqual(calls, [
        ["selectTab", "profiles"],
        ["selectTab", "profiles"],
        ["refresh"],
        ["openSettings"],
        ["pauseAll"],
        ["toggleProfile", "hardware-health"],
    ]);
});

test("profiles screen offers weight and enable controls", () => {
    const {calls, view, root} = harness();
    view.render(ViewModel.toViewModel(baseState({selectedTab: "profiles"}), NOW));
    button(root, "Decrease Hardware health weight").click();
    button(root, "Increase Hardware health weight").click();
    control(root, "Enable Network & peripherals").click();
    assert.deepEqual(calls, [
        ["changeWeight", "hardware-health", -1],
        ["changeWeight", "hardware-health", 1],
        ["toggleProfile", "network-peripherals"],
    ]);
    const minimum = button(root, "Decrease Desktop context weight");
    assert.equal(minimum.reactive, false);
    assert.equal(minimum.can_focus, false);
    assert.equal(minimum.styleClasses.has("tpuwm-button-disabled"), true);

    const maximumState = baseState({selectedTab: "profiles"});
    maximumState.profiles[0].weight = 5;
    view.render(ViewModel.toViewModel(maximumState, NOW));
    const maximum = button(root, "Increase Hardware health weight");
    assert.equal(maximum.reactive, false);
    assert.equal(maximum.can_focus, false);
});

test("pending runtime control is announced and disables policy controls", () => {
    const {view, root} = harness();
    view.render(ViewModel.toViewModel(baseState({
        selectedTab: "profiles",
        control: {pending: true, message: "Applying change in runtime…"},
    }), NOW));
    assert.equal(findActors(root, (actor) => actor.text === "Applying change in runtime…").length, 1);
    for (const accessibleName of [
        "Pause all workloads",
        "Decrease Hardware health weight",
        "Increase Hardware health weight",
        "Disable Hardware health",
    ]) {
        assert.equal(control(root, accessibleName).reactive, false, accessibleName);
    }

    view.render(ViewModel.toViewModel(baseState({
        selectedTab: "profiles",
        control: {pending: false, message: "Runtime rejected the change; retry"},
    }), NOW));
    const feedback = findActors(root, (actor) => actor.text === "Runtime rejected the change; retry")[0];
    assert.equal(feedback.styleClasses.has("tpuwm-control-error"), true);
    assert.equal(button(root, "Pause all workloads").reactive, true);
});

test("alerts screen renders empty, active, resolved, and fallback evidence", () => {
    const {view, root} = harness();
    view.render(ViewModel.toViewModel(baseState({selectedTab: "alerts"}), NOW));
    assert.equal(findActors(root, (actor) => actor.text === "No active alerts").length, 1);

    const alerts = [
        {id: "active", profileId: "hardware-health", title: "Voltage drift", summary: "", severity: "warning", timestamp: NOW, confidence: null, riskScore: 0.7, resolved: false},
        {id: "done", profileId: "hardware-health", title: "Temperature stable", summary: "Resolved", severity: "advisory", timestamp: NOW, confidence: 0.9, riskScore: 0.1, resolved: true},
    ];
    view.render(ViewModel.toViewModel(baseState({selectedTab: "alerts", alerts, attentionCount: 1}), NOW));
    assert.equal(findActors(root, (actor) => actor.text === "Voltage drift").length, 1);
    assert.equal(findActors(root, (actor) => actor.text === "No additional detail was supplied.").length, 1);
    assert.equal(findActors(root, (actor) => actor.text === "Temperature stable").length, 1);

    const changedAlerts = [
        {
            ...alerts[0],
            title: "Critical voltage drift",
            summary: "Disconnect the supply",
            severity: "critical",
            confidence: 0.8,
            riskScore: 0.9,
        },
        alerts[1],
    ];
    view.render(ViewModel.toViewModel(baseState({
        selectedTab: "alerts",
        alerts: changedAlerts,
        attentionCount: 1,
    }), NOW));
    assert.equal(findActors(root, (actor) => actor.text === "Voltage drift").length, 0);
    assert.equal(findActors(root, (actor) => actor.text === "No additional detail was supplied.").length, 0);
    assert.equal(findActors(root, (actor) => actor.text === "Critical voltage drift").length, 1);
    assert.equal(findActors(root, (actor) => actor.text === "Disconnect the supply").length, 1);
    assert.equal(findActors(root, (actor) => actor.text === "critical").length, 1);
    assert.equal(findActors(root, (actor) => actor.text === "80%").length, 1);
    assert.equal(findActors(root, (actor) => actor.text === "90%").length, 1);
    assert.equal(findActors(root, (actor) => actor.styleClasses.has("tpuwm-alert-critical")).length, 1);
});

test("alerts screen renders critical and newer alerts before lower priorities", () => {
    const {view, root} = harness();
    const alerts = [
        {id: "advisory", profileId: "hardware-health", title: "Advisory", summary: "", severity: "advisory", timestamp: NOW, confidence: null, riskScore: null, resolved: false},
        {id: "warning-old", profileId: "hardware-health", title: "Warning old", summary: "", severity: "warning", timestamp: NOW - 1000, confidence: null, riskScore: null, resolved: false},
        {id: "critical", profileId: "hardware-health", title: "Critical", summary: "", severity: "critical", timestamp: NOW - 5000, confidence: null, riskScore: null, resolved: false},
        {id: "warning-new", profileId: "hardware-health", title: "Warning new", summary: "", severity: "warning", timestamp: NOW, confidence: null, riskScore: null, resolved: false},
    ];
    view.render(ViewModel.toViewModel(baseState({
        selectedTab: "alerts",
        alerts,
        attentionCount: alerts.length,
    }), NOW));

    const titles = findActors(root, (actor) => actor.styleClasses.has("tpuwm-alert-title"))
        .map((actor) => actor.text);
    assert.deepEqual(titles, ["Critical", "Warning new", "Warning old", "Advisory"]);
});

test("paused screen invokes resume independently of button presentation text", () => {
    const {calls, view, root} = harness();
    view.render(ViewModel.toViewModel(baseState({paused: true}), NOW));
    const headerResume = button(root, "Resume all workloads");
    const label = headerResume.children[0];
    label.set_text("Localized resume text");
    headerResume.click();
    const bodyResume = findActors(root, (actor) => actor instanceof FakeButton && actor.accessibleName === "Resume all workloads")[1];
    bodyResume.click();
    assert.deepEqual(calls, [["resumeAll"], ["resumeAll"]]);
    assert.equal(findActors(root, (actor) => actor.text === "Local policy paused").length, 1);
    assert.equal(findActors(root, (actor) => actor.styleClasses.has("tpuwm-tabs"))[0].visible, false);
    assert.equal(button(root, "Manage workload profiles").visible, false);
});

test("unavailable screen hides tabs and offers recovery", () => {
    const {calls, view, root} = harness();
    view.render(ViewModel.toViewModel(baseState({
        device: {available: false, name: "No TPU", kind: "unknown", reason: "Reconnect device"},
    }), NOW));
    assert.equal(findActors(root, (actor) => actor.styleClasses.has("tpuwm-tabs"))[0].visible, false);
    assert.equal(button(root, "Manage workload profiles").visible, false);
    assert.equal(findActors(root, (actor) => actor.text === "Reconnect device").length, 1);
    button(root, "Retry TPU detection").click();
    assert.deepEqual(calls, [["refresh"]]);
});

test("unavailable screen keeps pause control aligned with policy intent", () => {
    const {calls, view, root} = harness();
    const device = {available: false, name: "No TPU", kind: "unknown", reason: "Reconnect device"};
    view.render(ViewModel.toViewModel(baseState({paused: true, device}), NOW));

    assert.equal(findActors(root, (actor) => actor.text === "Reconnect device").length, 1);
    button(root, "Resume all workloads").click();

    view.render(ViewModel.toViewModel(baseState({paused: false, device}), NOW));
    button(root, "Pause all workloads").click();
    assert.deepEqual(calls, [["resumeAll"], ["pauseAll"]]);
});

test("body rendering skips unchanged content and destroy is idempotent", () => {
    const {view, root} = harness();
    const model = ViewModel.toViewModel(baseState(), NOW);
    view.render(model);
    const body = findActors(root, (actor) => actor.styleClasses.has("tpuwm-body"))[0];
    const originalChildren = body.children.slice();
    view.render(model);
    assert.deepEqual(body.children, originalChildren);
    assert.equal(view.destroy(), true);
    assert.equal(root.destroyed, true);
    assert.equal(view.destroy(), false);
});

test("labels tolerate actors without a clutter text delegate", () => {
    const {view} = harness();
    view._St = {...view._St, Label: FakeActor};
    const label = view._label("Accessible text", "copy");
    assert.equal(label.text, "Accessible text");
    assert.equal(view._label(null, "copy").text, "");
    view.destroy();
});

// Plug-in installs, upgrades, and removals were computed and discarded. The
// popup now states them above the workload data they affect, in words, and
// keeps the notice until the user acknowledges it.
test("the catalog notice appears with named plug-ins and dismisses on demand", () => {
    const {calls, view, root} = harness();
    const notice = findActors(root, (actor) => actor.styleClasses
        && actor.styleClasses.has("tpuwm-catalog-notice"))[0];
    assert.equal(notice.visible, false);

    view.render(ViewModel.toViewModel(baseState({
        catalogChanges: {
            installed: ["hardware-health"],
            upgraded: [],
            removed: ["third-party-workload"],
        },
    }), NOW));
    assert.equal(notice.visible, true);
    assert.equal(
        notice.accessibleName,
        "Workload catalog changed: Installed: Hardware health · Removed: third-party-workload",
    );
    const texts = findActors(notice, (actor) => typeof actor.text === "string").map((actor) => actor.text);
    assert.deepEqual(texts, [
        "2 workload plug-ins changed",
        "Installed: Hardware health · Removed: third-party-workload",
        "Dismiss",
    ]);
    // The copy stacks title over detail and takes the free width, so the
    // dismiss control keeps its own edge instead of floating mid-row.
    assert.equal(notice.children[0].vertical, true);
    assert.equal(notice.children[0].x_expand, true);

    button(root, "Dismiss the workload catalog change notice").click();
    assert.deepEqual(calls, [["acknowledgeCatalogChanges"]]);

    // Acknowledgement clears the projection, and the next render hides the row
    // without rebuilding the body underneath it.
    view.render(ViewModel.toViewModel(baseState(), NOW));
    assert.equal(notice.visible, false);

    // A model built before this notice existed carries no field at all; the
    // row must stay hidden rather than render an undefined change set.
    view.render({...ViewModel.toViewModel(baseState(), NOW), catalogNotice: undefined});
    assert.equal(notice.visible, false);
});

// Three blockers, three remedies. A host is normally missing more than one
// thing at a time, so the group has to keep them apart rather than average
// them into one sentence.
function blockedState(selectedTab = "profiles") {
    const blockers = {
        "hardware-health": "Ready on gpu; no model bundled",
        "desktop-context": "gpu: ncnn is not installed",
        "storage-intelligence": "tpu: No Coral Edge TPU device detected",
        "build-advisor": "gpu: a reason nobody wrote a label for",
    };
    const state = baseState({selectedTab});
    state.profiles = state.profiles.map((profile) => (Object.hasOwn(blockers, profile.id)
        ? {...profile, status: "unavailable", detail: blockers[profile.id]}
        : profile));
    return state;
}

function disclosure(root) {
    return findActors(root, (actor) => actor.tpuwmIdentity === "blocked-disclosure")[0];
}

function blockedList(root) {
    return findActors(root, (actor) => actor.styleClasses
        && actor.styleClasses.has("tpuwm-disclosure-list"))[0];
}

test("profiles that cannot run collapse into one group under the ones that can", () => {
    const {view, root} = harness();
    view.render(ViewModel.toViewModel(blockedState(), NOW));

    const body = findActors(root, (actor) => actor.styleClasses.has("tpuwm-body"))[0];
    const list = blockedList(root);
    assert.equal(body.children.at(-1), list, "the group is last, under the runnable profiles");
    assert.equal(list.visible, false, "it starts collapsed");
    assert.equal(list.children.length, 4);

    // Each blocked profile states its own reason; the recognised ones are
    // labelled and the unrecognised one is quoted exactly.
    assert.deepEqual(
        findActors(list, (actor) => actor.styleClasses
            && actor.styleClasses.has("tpuwm-profile-limitation")).map((actor) => actor.text),
        [
            "No model installed · see Setup",
            "No supported accelerator present · see Setup",
            "gpu: a reason nobody wrote a label for · see Setup",
            "Accelerator runtime not installed · see Setup",
        ],
    );

    // Runnable profiles stay in their own groups and carry no limitation.
    const runnable = findActors(root, (actor) => actor.styleClasses
        && actor.styleClasses.has("tpuwm-profile-row") && actor.parent === body);
    assert.equal(runnable.length, 4);
    assert.equal(
        findActors(root, (actor) => actor.styleClasses
            && actor.styleClasses.has("tpuwm-profile-limitation")).length,
        4,
    );
});

test("the collapsed group is operable and announces its own state", () => {
    const {view, root} = harness();
    view.render(ViewModel.toViewModel(blockedState(), NOW));

    const toggle = disclosure(root);
    const list = blockedList(root);
    const arrow = findActors(toggle, (actor) => actor.styleClasses
        && actor.styleClasses.has("tpuwm-disclosure-arrow"))[0];
    const title = findActors(toggle, (actor) => actor.styleClasses
        && actor.styleClasses.has("tpuwm-disclosure-title"))[0];

    assert.equal(toggle.accessibleRole, "toggle-button");
    assert.equal(toggle.can_focus, true);
    assert.equal(toggle.accessibleName, "Not available, 4 profiles, collapsed");
    assert.equal(toggle.accessibleStates.has("expanded"), false);
    assert.equal(title.text, "Not available (4)");
    assert.equal(arrow.text, "▸");
    assert.equal(
        findActors(toggle, (actor) => actor.text === "4 profiles cannot run yet").length,
        1,
    );

    toggle.click();
    assert.equal(list.visible, true);
    assert.equal(arrow.text, "▾");
    assert.equal(toggle.accessibleName, "Not available, 4 profiles, expanded");
    assert.equal(toggle.accessibleStates.has("expanded"), true);
    assert.equal(toggle.styleClasses.has("tpuwm-disclosure-open"), true);

    // The reading position survives a refresh that rebuilds the body.
    const changed = blockedState();
    changed.profiles = changed.profiles.map((profile) => ({...profile, queued: 7}));
    view.render(ViewModel.toViewModel(changed, NOW));
    assert.equal(blockedList(root).visible, true);
    assert.equal(disclosure(root).accessibleName, "Not available, 4 profiles, expanded");

    disclosure(root).click();
    assert.equal(blockedList(root).visible, false);
});

test("controls on a profile that cannot run are disabled and say why", () => {
    const {calls, tooltips, view, root} = harness();
    view.render(ViewModel.toViewModel(blockedState(), NOW));

    const reason = "No model installed · see Setup";
    const inert = control(root, "Disable Hardware health");
    assert.equal(inert.accessibleName, `Disable Hardware health — ${reason}`);
    assert.equal(inert.reactive, false, "a control that changes nothing is not offered");
    assert.equal(inert.can_focus, false);
    assert.equal(inert.styleClasses.has("tpuwm-button-disabled"), true);
    assert.equal(inert.accessibleStates.has("sensitive"), false);

    for (const name of ["Decrease Hardware health weight", "Increase Hardware health weight"]) {
        const weight = control(root, name);
        assert.equal(weight.reactive, false, name);
        assert.equal(weight.can_focus, false, name);
        assert.equal(weight.styleClasses.has("tpuwm-button-disabled"), true, name);
    }

    // The pointer falls through the dead controls to the row, which carries a
    // tooltip with the same words the row prints.
    const row = findActors(root, (actor) => actor.styleClasses
        && actor.styleClasses.has("tpuwm-profile-inert"))[0];
    assert.equal(row.reactive, true);
    assert.equal(tooltips.filter((tooltip) => tooltip.actor === row)[0].text, reason);
    assert.equal(tooltips.length, 4);

    const runnable = control(root, "Enable Network & peripherals");
    assert.equal(runnable.accessibleName, "Enable Network & peripherals");
    assert.equal(runnable.reactive, true);
    runnable.click();
    assert.deepEqual(calls, [["toggleProfile", "network-peripherals"]]);
});

test("a catalog the runtime serves whole carries no group and no limitation", () => {
    const {view, root} = harness();
    view.render(ViewModel.toViewModel(baseState({selectedTab: "profiles"}), NOW));

    assert.equal(disclosure(root), undefined);
    assert.equal(blockedList(root), undefined);
    assert.equal(
        findActors(root, (actor) => actor.styleClasses
            && actor.styleClasses.has("tpuwm-profile-limitation")).length,
        0,
    );
    assert.equal(
        findActors(root, (actor) => actor.styleClasses
            && actor.styleClasses.has("tpuwm-empty-note")).length,
        0,
    );
});

test("a catalog nothing can run says so instead of showing an empty tab", () => {
    const {view, root} = harness();
    const state = baseState({selectedTab: "profiles"});
    state.profiles = state.profiles.map((profile) => ({
        ...profile,
        status: "unavailable",
        detail: "gpu: ncnn is not installed",
    }));
    view.render(ViewModel.toViewModel(state, NOW));

    const note = findActors(root, (actor) => actor.styleClasses
        && actor.styleClasses.has("tpuwm-empty-note"))[0];
    assert.match(note.text, /No workload profile can run on this machine yet/u);
    assert.match(note.text, /Setup tab/u);
    assert.equal(blockedList(root).children.length, state.profiles.length);
});

test("the collapsed group and the setup tab report what they did", () => {
    const {view, root} = harness();
    const blocked = ViewModel.toViewModel(blockedState(), NOW);

    // No group on a screen that has none, and no stale reference left behind
    // by the screen that did.
    view.render(ViewModel.toViewModel(baseState(), NOW));
    assert.equal(view._applyBlockedExpansion(), false);
    assert.equal(view._toggleBlockedProfiles(), false);
    assert.equal(view._renderBlockedProfiles({blockedGroup: null}), false);
    assert.equal(view._renderBlockedProfiles({blockedGroup: undefined}), false);

    view.render(blocked);
    assert.equal(view._applyBlockedExpansion(), false, "the group starts collapsed");
    assert.equal(view._toggleBlockedProfiles(), true);

    // The disclosure stacks its title over its summary and takes the free
    // width, so the arrow keeps its own edge.
    const copy = findActors(root, (actor) => actor.styleClasses
        && actor.styleClasses.has("tpuwm-disclosure-title"))[0].parent;
    assert.equal(copy.vertical, true);
    assert.equal(copy.x_expand, true);
    // The arrow sits beside that column, and the rows stack under the button.
    const arrowRow = findActors(root, (actor) => actor.styleClasses
        && actor.styleClasses.has("tpuwm-disclosure-row"))[0];
    assert.equal(arrowRow.vertical, false);
    assert.equal(blockedList(root).vertical, true);

    view.render(ViewModel.toViewModel(blockedState("setup"), NOW));
    const setupCopy = findActors(root, (actor) => actor.styleClasses
        && actor.styleClasses.has("tpuwm-setup-row"))[0].children[0];
    assert.equal(setupCopy.vertical, true);
    assert.equal(setupCopy.x_expand, true);

    assert.equal(view._renderSetup(blocked), true);
    assert.equal(view._renderSetup(ViewModel.toViewModel(baseState(), NOW)), false);
    assert.equal(view._renderBlockedProfiles(blocked), true);
    assert.deepEqual(
        blocked.setup.sections.map((section) => view._renderSetupSection(section)),
        ["runtime", "model", "hardware", "unknown"],
    );
});

test("the setup tab explains each remedy once, for every profile that needs it", () => {
    const {view, root} = harness();
    view.render(ViewModel.toViewModel(blockedState("setup"), NOW));

    const titles = findActors(root, (actor) => actor.styleClasses
        && actor.styleClasses.has("tpuwm-group-title")).map((actor) => actor.text);
    assert.deepEqual(titles, [
        "Install the accelerator runtime",
        "Install a model",
        "Connect supported hardware",
        "Reported by the runtime",
    ]);
    const counts = findActors(root, (actor) => actor.styleClasses
        && actor.styleClasses.has("tpuwm-group-value")).map((actor) => actor.text);
    assert.deepEqual(counts, ["1 profile", "1 profile", "1 profile", "1 profile"]);

    // Every affected profile is named under its own remedy.
    const rows = findActors(root, (actor) => actor.styleClasses
        && actor.styleClasses.has("tpuwm-setup-row"));
    assert.deepEqual(
        rows.map((row) => findActors(row, (actor) => actor.styleClasses
            && actor.styleClasses.has("tpuwm-profile-title"))[0].text),
        ["Desktop context", "Hardware health", "Storage intelligence", "Build advisor"],
    );
    assert.equal(
        findActors(root, (actor) => actor.text === "gpu: a reason nobody wrote a label for").length,
        1,
        "an unrecognised reason reaches the tab that explains it, unaltered",
    );

    // Only the two remedies that have a reference carry a note; the section
    // for hardware that cannot be installed adds nothing after its rows.
    assert.equal(
        findActors(root, (actor) => actor.styleClasses
            && actor.styleClasses.has("tpuwm-setup-note")).length,
        2,
    );
    assert.equal(
        findActors(root, (actor) => actor.styleClasses
            && actor.styleClasses.has("tpuwm-setup-description")).length,
        4,
    );

    // Two remedies are a command; missing hardware has none and none is faked.
    const commands = findActors(root, (actor) => actor.styleClasses
        && actor.styleClasses.has("tpuwm-command"));
    assert.deepEqual(commands.map((actor) => actor.text), [
        "pip install 'omnitensor[gpu]'",
        "omnitensor-prepare-artifact <model>.param --id <id> --version <v> --format ncnn"
        + " --install-root ~/.local/share/omnitensor/artifacts",
    ]);
    // Selectable rather than a Copy button St cannot honour, and never
    // ellipsized: a truncated command is one the user cannot retype.
    for (const command of commands) {
        assert.equal(command.reactive, true);
        assert.equal(command.can_focus, true);
        assert.equal(command.clutter_text.selectable, true);
        assert.equal(command.clutter_text.editable, false);
        assert.equal(command.clutter_text.line_wrap, true);
        assert.equal(command.clutter_text.ellipsize, 0);
    }
});

test("the setup tab says so when nothing needs installing", () => {
    const {view, root} = harness();
    view.render(ViewModel.toViewModel(baseState({selectedTab: "setup"}), NOW));

    assert.equal(findActors(root, (actor) => actor.text === "Every workload profile can run").length, 1);
    assert.equal(
        findActors(root, (actor) => actor.text === "8 of 8 workload profiles can run on this machine").length,
        1,
    );
    assert.equal(
        findActors(root, (actor) => actor.styleClasses && actor.styleClasses.has("tpuwm-command")).length,
        0,
    );
    assert.equal(
        findActors(root, (actor) => actor.styleClasses && actor.styleClasses.has("tpuwm-setup-row")).length,
        0,
    );
});

test("the setup tab joins the strip and is reachable from the collapsed group", () => {
    const {calls, view, root} = harness();
    view.render(ViewModel.toViewModel(blockedState(), NOW));

    // The terse group names Setup, and Setup is a tab the user can reach.
    const limitation = findActors(root, (actor) => actor.styleClasses
        && actor.styleClasses.has("tpuwm-profile-limitation"))[0];
    assert.match(limitation.text, /see Setup$/u);
    button(root, "Setup tab").click();
    assert.deepEqual(calls, [["selectTab", "setup"]]);

    view.render(ViewModel.toViewModel(blockedState("setup"), NOW));
    assert.equal(button(root, "Setup tab, selected").styleClasses.has("tpuwm-tab-active"), true);
});

test("the alerts screen states runtime content it could not render", () => {
    const {view, root} = harness();
    const sectionTitles = () => findActors(root, (actor) => actor.styleClasses
        && actor.styleClasses.has("tpuwm-section-title")).map((actor) => actor.text);

    view.render(ViewModel.toViewModel(baseState({
        selectedTab: "alerts",
        unknownContent: {profiles: 1, alerts: 2},
    }), NOW));
    const notice = sectionTitles().find((text) => text.includes("not installed here"));
    assert.equal(notice, "3 runtime items name workloads that are not installed here");
    const heading = findActors(root, (actor) => actor.accessibleName
        && actor.accessibleName.includes("Install the missing workload plug-in"));
    assert.equal(heading.length, 1);

    view.render(ViewModel.toViewModel(baseState({selectedTab: "alerts"}), NOW));
    assert.equal(sectionTitles().some((text) => text.includes("not installed here")), false);

    // A model built before this notice existed carries no field at all.
    view.render({
        ...ViewModel.toViewModel(baseState({selectedTab: "alerts"}), NOW),
        unknownContent: undefined,
        bodyKey: "forced-rebuild",
    });
    assert.equal(sectionTitles().some((text) => text.includes("not installed here")), false);
});

// The notice sits outside the tab body so a plug-in change is still reported
// while the popup is showing a safety state.
test("the catalog notice survives the unavailable and paused screens", () => {
    const {view, root} = harness();
    const notice = findActors(root, (actor) => actor.styleClasses
        && actor.styleClasses.has("tpuwm-catalog-notice"))[0];
    for (const overrides of [
        {paused: true},
        {device: {available: false, state: "absent", name: "No device", kind: "unknown", reason: "No accelerator detected"}},
    ]) {
        view.render(ViewModel.toViewModel(baseState({
            ...overrides,
            catalogChanges: {installed: ["desktop-context"], upgraded: [], removed: []},
        }), NOW));
        assert.equal(notice.visible, true);
    }
});
