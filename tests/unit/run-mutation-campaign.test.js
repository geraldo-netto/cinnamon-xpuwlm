"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

// The campaign runner is a release-blocking script that no gate had ever
// loaded: widening the coverage include showed it at 0% executed, its only
// caller a stage no automated run here invokes. Stryker is not run from here —
// the spawn is a double — because what is unproven is the script's own
// argument handling, exit-status handling and summary arithmetic.
const Campaign = require("../../scripts/run-mutation-campaign.js");
const {mutationTargets} = require("../../scripts/mutation-plan.js");

function temporaryReportRoot(t) {
    const reportRoot = fs.mkdtempSync(path.join(os.tmpdir(), "xpuwlm-campaign-"));
    t.after(() => fs.rmSync(reportRoot, {recursive: true, force: true}));
    return reportRoot;
}

function successfulSpawn(reportRoot, mutants) {
    return (command, argv, options) => {
        fs.mkdirSync(reportRoot, {recursive: true});
        fs.writeFileSync(
            options.env.XPUWLM_MUTATION_REPORT,
            JSON.stringify({files: {[options.env.XPUWLM_MUTATION_SOURCE]: {mutants}}}),
        );
        return {status: 0};
    };
}

test("no argument selects every planned target", () => {
    assert.deepEqual(Campaign.selectedTargets([]), mutationTargets());
});

test("a target is selectable by path or by basename", () => {
    const [first] = mutationTargets();
    assert.deepEqual(Campaign.selectedTargets([first.source]), [first]);
    assert.deepEqual(Campaign.selectedTargets([path.basename(first.source)]), [first]);
});

test("an unknown source is named rather than silently dropped", () => {
    assert.throws(
        () => Campaign.selectedTargets(["panel-status.js", "no-such-module.js"]),
        /unknown mutation source: no-such-module\.js/u,
    );
});

test("the report file is named for the source it measures", () => {
    assert.equal(
        Campaign.reportName("files/cinnamon-xpuwlm@geraldo-netto/lib/panel-status.js"),
        "panel-status.json",
    );
});

test("the summary counts every mutant status across every report", () => {
    assert.deepEqual(
        Campaign.summarize([
            {files: {a: {mutants: [{status: "Killed"}, {status: "Survived"}]}}},
            {files: {b: {mutants: [{status: "Killed"}]}, c: {mutants: [{status: "Timeout"}]}}},
        ]),
        {files: 2, statuses: {Killed: 2, Survived: 1, Timeout: 1}},
    );
});

test("an empty report set summarizes to no statuses at all", () => {
    assert.deepEqual(Campaign.summarize([]), {files: 0, statuses: {}});
});

test("a target run hands the source and the report path to the runner", (t) => {
    const reportRoot = temporaryReportRoot(t);
    const seen = [];
    const report = Campaign.runTarget({source: "files/x/lib/panel-status.js"}, {
        reportRoot,
        spawn: (command, argv, options) => {
            seen.push({argv, command, env: options.env});
            return successfulSpawn(reportRoot, [{status: "Killed"}])(command, argv, options);
        },
    });
    assert.equal(seen.length, 1);
    assert.deepEqual(seen[0].argv, ["run", "stryker.config.cjs"]);
    assert.equal(seen[0].env.XPUWLM_MUTATION_SOURCE, "files/x/lib/panel-status.js");
    assert.equal(seen[0].env.XPUWLM_MUTATION_REPORT, path.join(reportRoot, "panel-status.json"));
    assert.deepEqual(report.files["files/x/lib/panel-status.js"].mutants, [{status: "Killed"}]);
});

test("a runner that could not start is rethrown, not summarized", (t) => {
    const reportRoot = temporaryReportRoot(t);
    const cause = new Error("stryker is not installed");
    assert.throws(
        () => Campaign.runTarget({source: "lib/panel-status.js"}, {
            reportRoot,
            spawn: () => ({error: cause}),
        }),
        cause,
    );
});

test("a nonzero exit names the source that failed", (t) => {
    const reportRoot = temporaryReportRoot(t);
    assert.throws(
        () => Campaign.runTarget({source: "lib/panel-status.js"}, {
            reportRoot,
            spawn: () => ({status: 3}),
        }),
        /lib\/panel-status\.js mutation run exited 3/u,
    );
});

test("a campaign writes one summary for every target it ran", (t) => {
    const reportRoot = temporaryReportRoot(t);
    const ran = [];
    Campaign.main([], {
        reportRoot,
        run: (target, options) => {
            ran.push({reportRoot: options.reportRoot, source: target.source});
            return {files: {[target.source]: {mutants: [{status: "Killed"}]}}};
        },
    });
    const planned = mutationTargets();
    assert.deepEqual(ran.map((entry) => entry.source), planned.map((target) => target.source));
    assert.deepEqual(new Set(ran.map((entry) => entry.reportRoot)), new Set([reportRoot]));
    assert.deepEqual(
        JSON.parse(fs.readFileSync(path.join(reportRoot, "summary.json"), "utf8")),
        {files: planned.length, statuses: {Killed: planned.length}},
    );
});

test("the campaign defaults to the repository's own report directory", () => {
    assert.equal(
        Campaign.REPORT_ROOT,
        path.resolve(__dirname, "../../mutation-report/scoped"),
    );
});
