"use strict";

const childProcess = require("node:child_process");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const {mutationTargets} = require("./mutation-plan.js");
const {mutationPolicy} = require("../package.json");

const ROOT = path.resolve(__dirname, "..");
const REPORT_ROOT = path.join(ROOT, "mutation-report", "full");
const STRYKER = path.join(ROOT, "node_modules", ".bin", "stryker");
const TERMINAL_STATUSES = new Set([
    "CompileError",
    "Ignored",
    "Killed",
    "NoCoverage",
    "RuntimeError",
    "Survived",
    "Timeout",
]);
const DETECTED_STATUSES = new Set(["Killed", "Timeout"]);
const SCORED_STATUSES = new Set(["Killed", "NoCoverage", "Survived", "Timeout"]);

function selectedTargets(arguments_) {
    const targets = mutationTargets();
    if (arguments_.length === 0) {
        return targets;
    }
    const requested = new Set(arguments_);
    const selected = targets.filter((target) => requested.has(target.source)
        || requested.has(path.basename(target.source)));
    const matched = new Set(selected.flatMap((target) => [
        target.source,
        path.basename(target.source),
    ]));
    const unknown = [...requested].filter((name) => !matched.has(name));
    if (unknown.length > 0) {
        throw new Error(`unknown mutation source: ${unknown.join(", ")}`);
    }
    return selected;
}

function reportName(source) {
    return `${source.replaceAll("/", "__").replace(/\.js$/u, "")}.json`;
}

function sha256(data) {
    return crypto.createHash("sha256").update(data).digest("hex");
}

function fileSha256(file) {
    return sha256(fs.readFileSync(file));
}

function testSuiteSha256(tests) {
    const digest = crypto.createHash("sha256");
    for (const file of tests) {
        digest.update(file);
        digest.update("\0");
        digest.update(fileSha256(path.join(ROOT, file)));
        digest.update("\0");
    }
    return digest.digest("hex");
}

function reportMutants(report, source) {
    if (!report || report.schemaVersion !== "1.0" || !report.files) {
        throw new Error(`${source} mutation report has an invalid envelope`);
    }
    if (!Object.hasOwn(report.files, source)
        || Object.keys(report.files).length !== 1) {
        throw new Error(`${source} mutation report has the wrong file inventory`);
    }
    const mutants = report.files[source].mutants;
    if (!Array.isArray(mutants) || mutants.length === 0) {
        throw new Error(`${source} mutation report has no mutants`);
    }
    return mutants;
}

function countedStatuses(mutants, source) {
    const statuses = {};
    for (const mutant of mutants) {
        if (!mutant || !TERMINAL_STATUSES.has(mutant.status)) {
            throw new Error(`${source} mutation report has a non-terminal status`);
        }
        statuses[mutant.status] = (statuses[mutant.status] || 0) + 1;
    }
    return statuses;
}

function statusCounts(report, source) {
    const mutants = reportMutants(report, source);
    const expectedSource = fs.readFileSync(path.join(ROOT, source), "utf8");
    if (report.files[source].source !== expectedSource) {
        throw new Error(`${source} mutation report source does not match the worktree`);
    }
    const statuses = countedStatuses(mutants, source);
    const active = mutants.length - (statuses.Ignored || 0);
    if (active === 0 || statuses.CompileError || statuses.RuntimeError) {
        throw new Error(`${source} mutation report has no valid active campaign`);
    }
    return statuses;
}

function mutationScore(statuses) {
    let detected = 0;
    let scored = 0;
    for (const [status, count] of Object.entries(statuses)) {
        if (DETECTED_STATUSES.has(status)) {
            detected += count;
        }
        if (SCORED_STATUSES.has(status)) {
            scored += count;
        }
    }
    if (scored === 0) {
        throw new Error("mutation report has no scored mutants");
    }
    return Number(((detected / scored) * 100).toFixed(2));
}

function runTarget(target, spawn = childProcess.spawnSync) {
    const reportPath = path.join(REPORT_ROOT, reportName(target.source));
    fs.rmSync(reportPath, {force: true});
    const completed = spawn(
        STRYKER,
        ["run", "stryker.config.cjs"],
        {
            cwd: ROOT,
            env: {
                ...process.env,
                XPUWLM_MUTATION_REPORT: reportPath,
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
    const reportBytes = fs.readFileSync(reportPath);
    const report = JSON.parse(reportBytes);
    statusCounts(report, target.source);
    return {report, reportPath, reportSha256: sha256(reportBytes), target};
}

function gitOutput(arguments_, spawn = childProcess.spawnSync) {
    const completed = spawn("git", arguments_, {
        cwd: ROOT,
        encoding: "utf8",
    });
    if (completed.error) {
        throw completed.error;
    }
    if (completed.status !== 0) {
        throw new Error(`git ${arguments_.join(" ")} exited ${completed.status}`);
    }
    return completed.stdout.trim();
}

function cleanCommit(readGit = gitOutput) {
    const status = readGit(["status", "--porcelain", "--untracked-files=normal"]);
    if (status) {
        throw new Error("mutation campaign requires a clean worktree and index");
    }
    return readGit(["rev-parse", "HEAD"]);
}

function summarize(results, commit) {
    const statuses = {};
    const targets = results.map((result) => {
        const counts = statusCounts(result.report, result.target.source);
        for (const [status, count] of Object.entries(counts)) {
            statuses[status] = (statuses[status] || 0) + count;
        }
        return {
            source: result.target.source,
            sourceSha256: fileSha256(path.join(ROOT, result.target.source)),
            testCount: result.target.tests.length,
            testsSha256: testSuiteSha256(result.target.tests),
            report: path.relative(ROOT, result.reportPath),
            reportSha256: result.reportSha256,
            mutationScore: mutationScore(counts),
            statuses: counts,
        };
    });
    return {
        version: 1,
        commit,
        nodeVersion: process.version,
        strykerVersion: require("@stryker-mutator/core/package.json").version,
        threshold: mutationPolicy.threshold,
        configSha256: fileSha256(path.join(ROOT, "stryker.config.cjs")),
        planSha256: fileSha256(path.join(ROOT, "scripts/mutation-plan.js")),
        targetCount: targets.length,
        mutationScore: mutationScore(statuses),
        statuses,
        targets,
    };
}

function main(arguments_ = process.argv.slice(2), services = {}) {
    const commit = (services.cleanCommit || cleanCommit)();
    fs.mkdirSync(REPORT_ROOT, {recursive: true});
    const targets = selectedTargets(arguments_);
    const execute = services.runTarget || runTarget;
    const summary = summarize(targets.map(execute), commit);
    fs.writeFileSync(
        path.join(REPORT_ROOT, "summary.json"),
        `${JSON.stringify(summary, null, 2)}\n`,
        "utf8",
    );
    process.stdout.write(`mutation campaign passed: ${summary.targetCount} files\n`);
}

if (require.main === module) {
    try {
        main();
    } catch (error) {
        process.stderr.write(`mutation campaign failed: ${error.message}\n`);
        process.exitCode = 1;
    }
}

module.exports = {
    cleanCommit,
    gitOutput,
    main,
    mutationScore,
    reportName,
    runTarget,
    selectedTargets,
    statusCounts,
    summarize,
};
