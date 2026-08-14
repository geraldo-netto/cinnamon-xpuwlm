"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const {
    cleanCommit,
    gitOutput,
    main,
    mutationScore,
    reportName,
    runTarget,
    selectedTargets,
    statusCounts,
} = require("../../scripts/run-mutation-campaign.js");

const SOURCE = "files/cinnamon-xpuwlm@geraldo-netto/lib/domain.js";

function report(statuses, source = SOURCE) {
    return {
        schemaVersion: "1.0",
        files: {
            [source]: {
                source: fs.readFileSync(source, "utf8"),
                mutants: statuses.map((status, index) => ({
                    id: String(index),
                    status,
                })),
            },
        },
    };
}

test("runner resolves full-scope targets without shell aliases", () => {
    assert.equal(selectedTargets([]).length, 101);
    assert.deepEqual(selectedTargets([SOURCE]).map((target) => target.source), [SOURCE]);
    assert.deepEqual(selectedTargets(["domain.js"]).map((target) => target.source), [SOURCE]);
    assert.throws(() => selectedTargets(["missing.js"]), /unknown mutation source/u);
    assert.equal(
        reportName(SOURCE),
        "files__cinnamon-xpuwlm@geraldo-netto__lib__domain.json",
    );
});

test("report validation accepts only one complete terminal source campaign", () => {
    const statuses = statusCounts(
        report(["Killed", "Survived", "NoCoverage", "Timeout", "Ignored"]),
        SOURCE,
    );
    assert.deepEqual(statuses, {
        Killed: 1,
        Survived: 1,
        NoCoverage: 1,
        Timeout: 1,
        Ignored: 1,
    });
    assert.equal(mutationScore(statuses), 50);

    for (const invalid of [
        null,
        {},
        {schemaVersion: "2.0", files: {}},
        {schemaVersion: "1.0", files: {}},
        report([], SOURCE),
        report(["Pending"], SOURCE),
        report(["Ignored"], SOURCE),
        report(["RuntimeError"], SOURCE),
        report(["CompileError"], SOURCE),
    ]) {
        assert.throws(() => statusCounts(invalid, SOURCE), /mutation report/u);
    }
    const extra = report(["Killed"], SOURCE);
    extra.files["extra.js"] = {mutants: [{id: "2", status: "Killed"}]};
    assert.throws(() => statusCounts(extra, SOURCE), /wrong file inventory/u);
    const stale = report(["Killed"], SOURCE);
    stale.files[SOURCE].source = "stale";
    assert.throws(() => statusCounts(stale, SOURCE), /does not match/u);
    assert.throws(() => mutationScore({Ignored: 2}), /no scored mutants/u);
});

test("runner refuses process failures and validates the emitted source report", () => {
    const target = selectedTargets([SOURCE])[0];
    assert.throws(
        () => runTarget(target, () => ({error: new Error("spawn failed")})),
        /spawn failed/u,
    );
    assert.throws(
        () => runTarget(target, () => ({status: 9})),
        /mutation run exited 9/u,
    );
    const result = runTarget(target, (_command, _arguments, options) => {
        fs.mkdirSync(path.dirname(options.env.XPUWLM_MUTATION_REPORT), {recursive: true});
        fs.writeFileSync(
            options.env.XPUWLM_MUTATION_REPORT,
            JSON.stringify(report(["Killed", "Ignored"])),
        );
        return {status: 0};
    });
    assert.equal(result.target, target);
    assert.match(result.reportSha256, /^[0-9a-f]{64}$/u);
    assert.equal(statusCounts(result.report, SOURCE).Killed, 1);
});

test("Git boundary and summary publication fail closed", () => {
    assert.equal(cleanCommit((arguments_) => (
        arguments_[0] === "status" ? "" : "a".repeat(40)
    )), "a".repeat(40));
    assert.throws(() => cleanCommit(() => "dirty"), /clean worktree/u);
    assert.equal(
        gitOutput(["rev-parse", "HEAD"], () => ({status: 0, stdout: "abc\n"})),
        "abc",
    );
    assert.throws(
        () => gitOutput(["status"], () => ({error: new Error("git missing")})),
        /git missing/u,
    );
    assert.throws(
        () => gitOutput(["status"], () => ({status: 3, stdout: ""})),
        /git status exited 3/u,
    );

    const target = selectedTargets([SOURCE])[0];
    const result = {
        report: report(["Killed", "Ignored"]),
        reportPath: path.resolve("mutation-report/full/fake.json"),
        reportSha256: "b".repeat(64),
        target,
    };
    assert.doesNotThrow(() => main([SOURCE], {
        cleanCommit: () => "c".repeat(40),
        runTarget: (...arguments_) => {
            assert.equal(arguments_.length, 1);
            assert.deepEqual(arguments_[0], target);
            return result;
        },
    }));
    const summary = JSON.parse(fs.readFileSync("mutation-report/full/summary.json", "utf8"));
    assert.equal(summary.version, 1);
    assert.equal(summary.commit, "c".repeat(40));
    assert.equal(summary.targetCount, 1);
    assert.equal(summary.threshold, 80);
    assert.equal(summary.mutationScore, 100);
    assert.equal(summary.targets[0].source, SOURCE);
    assert.equal(summary.targets[0].testCount, target.tests.length);
    assert.match(summary.targets[0].sourceSha256, /^[0-9a-f]{64}$/u);
    assert.match(summary.targets[0].testsSha256, /^[0-9a-f]{64}$/u);
});
