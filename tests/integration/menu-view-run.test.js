"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const Domain = require("../../files/cinnamon-tpuwm@geraldo-netto/lib/domain.js");
const BuiltIns = require("../helpers/built-in-workloads.js");
const Menu = require("../../files/cinnamon-tpuwm@geraldo-netto/lib/menu-view.js");
const ViewModel = require("../../files/cinnamon-tpuwm@geraldo-netto/lib/view-model.js");
const {FakeMenu, createAtk, createSt, findActors} = require("../helpers/fakes.js");

// The run surface, end to end through the projection and the popup: a picture
// the runtime is allowed to read becomes a button that names it, and everything
// that stops a submission is a sentence rather than a control that does nothing.

const NOW = 1_700_000_000_000;
const ROOT = "/home/tester/omnitensor-inputs";
const RUNNABLE = "visual-library";

function pictures(names) {
    return names.map((name) => ({root: ROOT, name, path: `${ROOT}/${name}`}));
}

function state(overrides = {}) {
    const {inputs = {}, job = null, ...rest} = overrides;
    return {
        selectedTab: "profiles",
        paused: false,
        profiles: new Domain.WorkloadPortfolio(null, BuiltIns.coreCatalog()).list({}),
        device: {
            id: "gpu-renderD128",
            backend: "gpu",
            available: true,
            state: "present",
            name: "AMD GPU",
            kind: "dri",
            vendor: "0x1002",
            load: 3,
            reason: "",
        },
        devices: [],
        health: {device: "present", runtime: "connected", detail: ""},
        metrics: {queueDepth: 0, runningProfiles: 0},
        alerts: [],
        attentionCount: 0,
        stale: false,
        source: "runtime",
        generatedAt: NOW,
        control: {pending: false, message: "", available: true},
        job,
        inputs: {
            roots: [ROOT],
            pictures: pictures(["cat.png"]),
            runnable: [RUNNABLE],
            omitted: 0,
            ...inputs,
        },
        ...rest,
    };
}

function harness() {
    const calls = [];
    const actions = {};
    for (const name of [
        "selectTab", "toggleProfile", "changeWeight",
        "pauseAll", "resumeAll", "refresh", "openSettings",
        "acknowledgeCatalogChanges",
    ]) {
        actions[name] = () => {};
    }
    actions.submitJob = (id, picture) => calls.push([id, picture]);
    const menu = new FakeMenu();
    const view = new Menu.MenuView({
        St: createSt(),
        Clutter: {ActorAlign: {CENTER: "center"}},
        Atk: createAtk(),
        menu,
        actions,
    });
    return {view, root: menu.actors[0], calls};
}

function runRows(root) {
    return findActors(root, (actor) => actor.styleClasses
        && actor.styleClasses.has("tpuwm-run-row"));
}

function textWithClass(root, styleClass) {
    return findActors(root, (actor) => actor.styleClasses && actor.styleClasses.has(styleClass))
        .map((actor) => actor.text);
}

test("the projection offers a picture only where a profile can accept one", () => {
    const run = ViewModel.runModel(state());

    assert.equal(run.reason, "");
    assert.deepEqual(run.roots, [ROOT]);
    assert.deepEqual(run.pictures, pictures(["cat.png"]));
    assert.equal(run.profiles.length, 1);
    assert.equal(run.profiles[0].id, RUNNABLE);
});

test("the projection says why nothing can be submitted, in order of cause", () => {
    assert.match(
        ViewModel.runModel(state({inputs: {roots: []}})).reason,
        /not configured to read input files/u,
    );
    assert.match(
        ViewModel.runModel(state({inputs: {runnable: []}})).reason,
        /No installed profile states what input it needs/u,
    );
    assert.match(
        ViewModel.runModel(state({inputs: {pictures: []}})).reason,
        new RegExp(ROOT, "u"),
    );
});

test("a runtime that predates the field is treated as one that permits nothing", () => {
    const bare = state();
    delete bare.inputs;

    const run = ViewModel.runModel(bare);

    assert.match(run.reason, /not configured to read input files/u);
    assert.deepEqual(run.pictures, []);
    assert.deepEqual(run.profiles, []);
});

test("the picture list is bounded however many the directory holds", () => {
    const many = Array.from({length: ViewModel.MAX_RUN_PICTURES + 10}, (unused, index) => `p${index}.png`);

    const run = ViewModel.runModel(state({inputs: {pictures: pictures(many)}}));

    assert.equal(run.pictures.length, ViewModel.MAX_RUN_PICTURES);
});

test("the job projection names the profile the user recognises, not its id", () => {
    const profiles = new Domain.WorkloadPortfolio(null, BuiltIns.coreCatalog()).list({});
    const known = ViewModel.jobModel(
        {pending: false, profileId: RUNNABLE, sourceName: "cat.png", status: "accepted", jobId: "job-1", message: "Job accepted"},
        profiles,
    );

    assert.equal(known.title, profiles.find((profile) => profile.id === RUNNABLE).title);
    assert.equal(known.tone, "normal");
    assert.equal(ViewModel.jobModel({pending: false, profileId: ""}, profiles), null);
    assert.equal(ViewModel.jobModel(null, profiles), null);
    assert.equal(
        ViewModel.jobModel({pending: false, profileId: "gone", status: "rejected"}, profiles).title,
        "gone",
    );
});

test("a pending job is toned as pending and a refused one as attention", () => {
    const profiles = [];

    assert.equal(ViewModel.jobModel({pending: true, profileId: "x"}, profiles).tone, "pending");
    assert.equal(
        ViewModel.jobModel({pending: false, profileId: "x", status: "rejected"}, profiles).tone,
        "attention",
    );
});

test("each picture becomes one button that submits it for one profile", () => {
    const {view, root, calls} = harness();
    view.render(ViewModel.toViewModel(state({
        inputs: {pictures: pictures(["cat.png", "dog.jpg"])},
    }), NOW));

    const rows = runRows(root);
    assert.deepEqual(rows.map((row) => row.accessibleName).sort(), [
        "Run Visual library on cat.png",
        "Run Visual library on dog.jpg",
    ].sort());

    rows[0].emit("clicked");
    assert.equal(calls[0][0], RUNNABLE);
    assert.equal(calls[0][1].path, `${ROOT}/cat.png`);
});

test("the rows carry identities so focus survives a refresh under the cursor", () => {
    const {view, root} = harness();
    view.render(ViewModel.toViewModel(state(), NOW));

    assert.deepEqual(
        runRows(root).map((row) => row.tpuwmIdentity),
        [`run:${RUNNABLE}:cat.png`],
    );
});

test("nothing to run is a sentence, never an empty list of buttons", () => {
    const {view, root} = harness();
    view.render(ViewModel.toViewModel(state({inputs: {roots: [], pictures: []}}), NOW));

    assert.deepEqual(runRows(root), []);
    assert.equal(textWithClass(root, "tpuwm-run-note").length, 1);
    assert.match(textWithClass(root, "tpuwm-run-note")[0], /not configured to read input files/u);
});

test("the last job's outcome names the picture, the profile, and the answer", () => {
    const {view, root} = harness();
    view.render(ViewModel.toViewModel(state({
        job: {
            pending: false,
            profileId: RUNNABLE,
            sourceName: "cat.png",
            jobId: "job-7f3c",
            status: "accepted",
            code: "job-accepted",
            message: "Job accepted",
        },
    }), NOW));

    const outcome = textWithClass(root, "tpuwm-job-outcome");
    assert.equal(outcome.length, 1);
    assert.match(outcome[0], /cat\.png/u);
    assert.match(outcome[0], /Job accepted/u);
    assert.match(outcome[0], /job-7f3c/u);
});

test("a job with no id yet reports what happened without an empty separator", () => {
    const {view, root} = harness();
    view.render(ViewModel.toViewModel(state({
        job: {
            pending: true,
            profileId: RUNNABLE,
            sourceName: "cat.png",
            jobId: "",
            status: "",
            code: "",
            message: "Preparing the picture…",
        },
    }), NOW));

    assert.match(textWithClass(root, "tpuwm-job-outcome")[0], /Preparing the picture…$/u);
});

test("a job acknowledgement rebuilds the body even though the snapshot is unchanged", () => {
    const {view, root} = harness();
    const before = state();
    view.render(ViewModel.toViewModel(before, NOW));
    assert.deepEqual(textWithClass(root, "tpuwm-job-outcome"), []);

    view.render(ViewModel.toViewModel(state({
        job: {
            pending: false,
            profileId: RUNNABLE,
            sourceName: "cat.png",
            jobId: "job-1",
            status: "accepted",
            code: "job-accepted",
            message: "Job accepted",
        },
    }), NOW));

    assert.equal(textWithClass(root, "tpuwm-job-outcome").length, 1);
});

test("a newly dropped picture rebuilds the body on the next render", () => {
    const {view, root} = harness();
    view.render(ViewModel.toViewModel(state(), NOW));
    assert.equal(runRows(root).length, 1);

    view.render(ViewModel.toViewModel(state({
        inputs: {pictures: pictures(["cat.png", "dog.jpg"])},
    }), NOW));

    assert.equal(runRows(root).length, 2);
});

test("the overview and alerts screens carry no run surface", () => {
    const {view, root} = harness();

    for (const tab of ["overview", "alerts", "setup"]) {
        view.render(ViewModel.toViewModel(state({selectedTab: tab}), NOW));
        assert.deepEqual(runRows(root), [], tab);
    }
});

test("an accepted job that has not finished does not read as finished", () => {
    const {view, root} = harness();
    view.render(ViewModel.toViewModel(state({
        job: {
            pending: false,
            profileId: RUNNABLE,
            sourceName: "cat.png",
            jobId: "job-1",
            status: "accepted",
            code: "job-accepted",
            message: "Job accepted",
            state: "running",
            progress: {fraction: 0.5, detail: "infer"},
            reading: null,
        },
    }), NOW));

    const outcome = textWithClass(root, "tpuwm-job-outcome")[0];
    assert.match(outcome, /Running/u);
    assert.match(outcome, /50%/u);
    assert.match(outcome, /infer/u);
    assert.deepEqual(textWithClass(root, "tpuwm-job-reading"), []);
});

test("a finished job prints the candidates it was run for", () => {
    const {view, root} = harness();
    view.render(ViewModel.toViewModel(state({
        job: {
            pending: false,
            profileId: RUNNABLE,
            sourceName: "cat.png",
            jobId: "job-1",
            status: "accepted",
            code: "job-succeeded",
            message: "Job finished",
            state: "succeeded",
            progress: null,
            reading: {
                kind: "classification",
                top: [{index: 669, score: 0.0918}, {index: 2, score: 0.0411, label: "beacon"}],
            },
        },
    }), NOW));

    const rows = textWithClass(root, "tpuwm-job-reading");
    assert.equal(rows.length, 2);
    assert.match(rows[0], /class 669/u, "an index with no labels file stays an index");
    assert.match(rows[0], /0\.092/u);
    assert.match(rows[1], /^beacon/u, "a verified label is used where one exists");
});

test("a forecast renders one bounded advisory row without invented meaning", () => {
    const {view, root} = harness();
    view.render(ViewModel.toViewModel(state({
        job: {
            pending: false,
            profileId: RUNNABLE,
            sourceName: "",
            jobId: "job-forecast",
            status: "accepted",
            code: "job-succeeded",
            message: "Job finished",
            state: "succeeded",
            progress: null,
            reading: {kind: "forecast", targetFeature: "queueDepth", horizon: 3, value: 2.5},
        },
    }), NOW));

    const rows = textWithClass(root, "tpuwm-job-reading");
    assert.equal(rows.length, 1);
    assert.match(rows[0], /^Forecast · queueDepth · 3 observations ahead · 2\.5$/u);
    assert.doesNotMatch(rows[0], /%|confidence|risk|action/iu);
});

test("the reading is bounded however many candidates the runtime returned", () => {
    const many = Array.from({length: ViewModel.MAX_READING_ROWS + 5}, (unused, index) => ({
        index,
        score: 0.1,
    }));

    const reading = ViewModel.readingModel({kind: "classification", top: many});

    assert.equal(reading.entries.length, ViewModel.MAX_READING_ROWS);
});

test("only a reduction that means something is rendered as one", () => {
    assert.equal(ViewModel.readingModel(null), null);
    assert.equal(ViewModel.readingModel(undefined), null);
    assert.equal(ViewModel.readingModel({kind: "embedding", top: []}), null);
    assert.equal(ViewModel.readingModel({
        kind: "forecast", targetFeature: "load", horizon: 0, value: 1,
    }), null);
    assert.deepEqual(ViewModel.readingModel({kind: "classification", top: []}).entries, []);
});

test("every state the runtime reports has words a user can read", () => {
    const profiles = [];
    for (const reported of ["running", "succeeded", "failed", "cancelled", "unknown"]) {
        const job = ViewModel.jobModel({pending: false, profileId: "x", state: reported}, profiles);
        assert.notEqual(job.stateText, "", reported);
    }
    assert.equal(
        ViewModel.jobModel({pending: false, profileId: "x", state: ""}, profiles).stateText,
        "",
        "a job with no reported state says nothing about one",
    );
});

test("a job that failed after acceptance is toned for attention", () => {
    const profiles = [];

    assert.equal(ViewModel.jobModel({pending: false, profileId: "x", status: "accepted", state: "failed"}, profiles).tone, "attention");
    assert.equal(ViewModel.jobModel({pending: false, profileId: "x", status: "accepted", state: "unknown"}, profiles).tone, "attention");
    assert.equal(ViewModel.jobModel({pending: false, profileId: "x", status: "accepted", state: "running"}, profiles).tone, "pending");
    assert.equal(ViewModel.jobModel({pending: false, profileId: "x", status: "accepted", state: "succeeded"}, profiles).tone, "normal");
});

test("progress is printed only when there is progress to print", () => {
    assert.equal(ViewModel.progressText(null), "");
    assert.equal(ViewModel.progressText({fraction: "half", detail: ""}), "");
    assert.equal(ViewModel.progressText({fraction: 0.25, detail: ""}), "25%");
    assert.equal(ViewModel.progressText({fraction: 1, detail: "done"}), "100% · done");
});

test("the outcome line omits what is not known rather than printing gaps", () => {
    assert.equal(
        Menu.jobDetail({message: "Job accepted", stateText: "", progressText: "", jobId: "job-1"}),
        "Job accepted · job-1",
    );
    assert.equal(
        Menu.jobDetail({message: "", stateText: "Finished", progressText: "", jobId: ""}),
        "Finished",
    );
});

test("a capped picture list says how many it is not showing", () => {
    // A capped list that says nothing about the cap reads as the whole list,
    // and the runtime would happily accept the ones left out.
    const {view, root} = harness();
    const many = Array.from({length: ViewModel.MAX_RUN_PICTURES + 3}, (unused, i) => `p${i}.png`);

    view.render(ViewModel.toViewModel(state({
        inputs: {pictures: pictures(many), omitted: 5},
    }), NOW));

    const notes = textWithClass(root, "tpuwm-run-note");
    assert.equal(notes.length, 1);
    assert.match(notes[0], /8 more pictures are not shown/u, "trimmed here plus omitted upstream");
});

test("a list that shows everything says nothing about omission", () => {
    const {view, root} = harness();
    view.render(ViewModel.toViewModel(state(), NOW));

    assert.deepEqual(textWithClass(root, "tpuwm-run-note"), []);
    assert.equal(ViewModel.runModel(state()).omitted, 0);
});

test("omission counts what the catalog dropped and what this surface trims", () => {
    assert.equal(ViewModel.omittedCount({pictures: [], omitted: 4}), 4);
    assert.equal(ViewModel.omittedCount({pictures: new Array(30), omitted: 0}), 6);
    assert.equal(ViewModel.omittedCount({pictures: new Array(30), omitted: 2}), 8);
    assert.equal(ViewModel.omittedCount({}), 0);
});

test("a profile the popup calls unavailable is not offered a picture", () => {
    // Offering it spends a decode, a staged buffer, and a bus call to learn
    // what the row above already said.
    const base = state();
    const blocked = {
        ...base,
        profiles: base.profiles.map((profile) => (profile.id === RUNNABLE
            ? {...profile, status: "unavailable"}
            : profile)),
    };

    const run = ViewModel.runModel(blocked);

    assert.deepEqual(run.profiles, []);
    assert.match(run.reason, /can serve right now/u);
});

test("a paused or disabled profile is not offered one either", () => {
    const base = state();
    for (const change of [{status: "paused"}, {enabled: false}]) {
        const blocked = {
            ...base,
            profiles: base.profiles.map((profile) => (profile.id === RUNNABLE
                ? {...profile, ...change}
                : profile)),
        };
        assert.deepEqual(ViewModel.runModel(blocked).profiles, [], JSON.stringify(change));
    }
});

test("declaring no input and being unable to serve are different sentences", () => {
    const base = state();
    const noDeclaration = ViewModel.runModel(state({inputs: {runnable: []}}));
    const blocked = ViewModel.runModel({
        ...base,
        profiles: base.profiles.map((profile) => (profile.id === RUNNABLE
            ? {...profile, status: "paused"}
            : profile)),
    });

    assert.match(noDeclaration.reason, /states what input it needs/u);
    assert.match(blocked.reason, /can serve right now/u);
    assert.notEqual(noDeclaration.reason, blocked.reason);
});

test("only a status that can actually run counts as serving", () => {
    for (const status of ["healthy", "running", "watching", "idle"]) {
        assert.equal(ViewModel.canServe({status, enabled: true}), true, status);
    }
    for (const status of ["paused", "unavailable", "", undefined]) {
        assert.equal(ViewModel.canServe({status, enabled: true}), false, String(status));
    }
    assert.equal(ViewModel.canServe({status: "watching", enabled: false}), false);
});
