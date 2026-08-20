"use strict";

const childProcess = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const {mutationTargets} = require("./mutation-plan.js");

const ROOT = path.resolve(__dirname, "..");
const REPORT_ROOT = path.join(ROOT, "mutation-report", "scoped");
const STRYKER = path.join(ROOT, "node_modules", ".bin", "stryker");

function selectedTargets(arguments_) {
    const targets = mutationTargets();
    if (arguments_.length === 0) {
        return targets;
    }
    const requested = new Set(arguments_);
    const selected = targets.filter((target) => requested.has(target.source)
        || requested.has(path.basename(target.source)));
    if (selected.length !== requested.size) {
        const matched = new Set(selected.flatMap((target) => [
            target.source,
            path.basename(target.source),
        ]));
        const unknown = [...requested].filter((name) => !matched.has(name));
        throw new Error(`unknown mutation source: ${unknown.join(", ")}`);
    }
    return selected;
}

function reportName(source) {
    return `${path.basename(source, ".js")}.json`;
}

// The spawn and the report directory arrive as arguments so the campaign's own
// argument handling, exit-status handling and summary arithmetic can be loaded
// and asserted without a Stryker run. Nothing here had a seam before, so the
// coverage gate could not reach the file at all — and a file no gate loads is
// a release-blocking script nobody has proven parses under its own entry
// point.
function runTarget(target, {reportRoot = REPORT_ROOT, spawn = childProcess.spawnSync} = {}) {
    const report = path.join(reportRoot, reportName(target.source));
    fs.rmSync(report, {force: true});
    const completed = spawn(
        STRYKER,
        ["run", "stryker.config.cjs"],
        {
            cwd: ROOT,
            env: {
                ...process.env,
                XPUWLM_MUTATION_REPORT: report,
                XPUWLM_MUTATION_SOURCE: target.source,
            },
            stdio: "inherit",
        },
    );
    if (completed.error) {
        throw completed.error;
    }
    if (completed.status !== 0) {
        throw new Error(`${target.source} mutation run exited ${completed.status}`);
    }
    return JSON.parse(fs.readFileSync(report, "utf8"));
}

function summarize(reports) {
    const statuses = {};
    for (const report of reports) {
        for (const result of Object.values(report.files)) {
            for (const mutant of result.mutants) {
                statuses[mutant.status] = (statuses[mutant.status] || 0) + 1;
            }
        }
    }
    return {files: reports.length, statuses};
}

function main(arguments_ = process.argv.slice(2), {reportRoot = REPORT_ROOT, run = runTarget} = {}) {
    fs.mkdirSync(reportRoot, {recursive: true});
    const targets = selectedTargets(arguments_);
    const summary = summarize(targets.map((target) => run(target, {reportRoot})));
    fs.writeFileSync(
        path.join(reportRoot, "summary.json"),
        `${JSON.stringify(summary, null, 2)}\n`,
        "utf8",
    );
    process.stdout.write(`mutation campaign passed: ${summary.files} files\n`);
}

if (require.main === module) {
    try {
        main();
    } catch (error) {
        process.stderr.write(`mutation campaign failed: ${error.message}\n`);
        process.exitCode = 1;
    }
}

module.exports = {REPORT_ROOT, main, reportName, runTarget, selectedTargets, summarize};
