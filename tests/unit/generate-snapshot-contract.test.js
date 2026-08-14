"use strict";

const assert = require("node:assert/strict");
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
