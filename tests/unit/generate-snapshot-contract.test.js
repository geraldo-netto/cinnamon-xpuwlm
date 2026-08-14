"use strict";

const assert = require("node:assert/strict");
const childProcess = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const Generator = require("../../scripts/generate-snapshot-contract.js");

const REPOSITORY_ROOT = path.resolve(__dirname, "../..");
const SCHEMA_PATH = path.join(
    REPOSITORY_ROOT,
    "files/cinnamon-xpuwlm@geraldo-netto/runtime-snapshot.schema.json",
);
const GENERATED_PATH = path.join(
    REPOSITORY_ROOT,
    "files/cinnamon-xpuwlm@geraldo-netto/lib/runtime-snapshot-contract.js",
);
const SCRIPT_PATH = path.join(REPOSITORY_ROOT, "scripts/generate-snapshot-contract.js");

test("snapshot contract renderer is byte-identical to the checked-in contract", () => {
    const checkedIn = fs.readFileSync(GENERATED_PATH, "utf8")
        .replace(/^\/\/ @ts-nocheck\n/u, "");
    assert.equal(
        Generator.render(Generator.readSchema(SCHEMA_PATH)),
        checkedIn,
    );
});

test("snapshot contract imports stay inert while the command executes", (context) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "xpuwlm-contract-command-"));
    context.after(() => fs.rmSync(root, {recursive: true, force: true}));
    const copiedScript = path.join(root, "scripts/generate-snapshot-contract.js");
    const copiedSchema = path.join(
        root,
        "files/cinnamon-xpuwlm@geraldo-netto/runtime-snapshot.schema.json",
    );
    const copiedOutput = path.join(
        root,
        "files/cinnamon-xpuwlm@geraldo-netto/lib/runtime-snapshot-contract.js",
    );
    fs.mkdirSync(path.dirname(copiedScript), {recursive: true});
    fs.mkdirSync(path.dirname(copiedOutput), {recursive: true});
    fs.copyFileSync(SCRIPT_PATH, copiedScript);
    fs.copyFileSync(SCHEMA_PATH, copiedSchema);
    fs.copyFileSync(GENERATED_PATH, copiedOutput);

    const imported = childProcess.spawnSync(
        process.execPath,
        ["-e", `require(${JSON.stringify(copiedScript)})`],
        {encoding: "utf8"},
    );
    assert.equal(imported.status, 0, imported.stderr);
    assert.equal(imported.stdout, "");

    const executed = childProcess.spawnSync(process.execPath, [copiedScript], {
        encoding: "utf8",
    });
    assert.equal(executed.status, 0, executed.stderr);
    assert.equal(
        executed.stdout,
        "snapshot contract: wrote "
            + "files/cinnamon-xpuwlm@geraldo-netto/lib/runtime-snapshot-contract.js\n",
    );
});

test("snapshot contract check fails for stale output and passes after generation", (context) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "xpuwlm-contract-"));
    context.after(() => fs.rmSync(root, {recursive: true, force: true}));
    const outputPath = path.join(root, "runtime-snapshot-contract.js");
    const messages = [];
    const options = {
        logger: {log: (message) => messages.push(message)},
        outputPath,
        repositoryRoot: root,
        schemaPath: SCHEMA_PATH,
    };
    fs.writeFileSync(outputPath, "stale contract\n");

    assert.throws(
        () => Generator.main({...options, argv: ["--check"]}),
        /runtime-snapshot-contract\.js is stale/u,
    );
    assert.equal(Generator.main({...options, argv: []}), true);
    assert.equal(Generator.main({...options, argv: ["--check"]}), true);
    assert.match(messages[0], /snapshot contract: wrote/u);
    assert.equal(messages[1], "snapshot contract: derived file matches the schema");
});
