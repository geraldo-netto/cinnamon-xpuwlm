"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const Question = require("../../files/cinnamon-xpuwlm@geraldo-netto/lib/document-question.js");

const repositoryRoot = path.resolve(__dirname, "../..");

function serviceRoot() {
    const candidate = process.env.XPUWLM_OMNITENSOR_ROOT
        || path.resolve(repositoryRoot, "../omnitensor");
    return fs.existsSync(path.join(candidate, "plugin-manifests/ask-selected-files.json"))
        ? candidate
        : null;
}

function requireService(t) {
    const root = serviceRoot();
    if (root === null) {
        t.skip("set XPUWLM_OMNITENSOR_ROOT to run the selected-document contract gate");
    }
    return root;
}

function readJson(root, relative) {
    return JSON.parse(fs.readFileSync(path.join(root, relative), "utf8"));
}

test("selected-document manifest pins manual grants, bounds, and accelerator policy", (t) => {
    const root = requireService(t);
    if (root === null) {
        return;
    }
    const manifest = readJson(root, "plugin-manifests/ask-selected-files.json");
    const input = manifest.plugin.schemas.input.properties;
    assert.equal(manifest.id, Question.PROFILE_ID);
    assert.equal(manifest.plugin.entryPoint, Question.PROFILE_ID);
    assert.deepEqual(manifest.plugin.triggers, ["manual"]);
    assert.deepEqual(manifest.plugin.permissions, [
        "accelerator:gpu",
        "files:read-selected",
    ]);
    assert.equal(input.sources.maxItems, Question.MAX_SOURCES);
    assert.equal(input.question.maxLength, Question.MAX_QUESTION_CHARACTERS);
    assert.deepEqual(manifest.requirements.acceleratorPreference, ["gpu"]);
});

test("public result schema and defensive parser agree on every citation bound", (t) => {
    const root = requireService(t);
    if (root === null) {
        return;
    }
    const schema = readJson(root, "schemas/document-question-result.schema.json");
    const citation = schema.$defs.citation.properties;
    assert.equal(schema.properties.version.const, 1);
    assert.equal(schema.properties.answer.maxLength, Question.MAX_ANSWER_CHARACTERS);
    assert.equal(schema.properties.citations.maxItems, Question.MAX_CITATIONS);
    assert.equal(citation.fileId.pattern, "^selected-file-[1-9][0-9]*$");
    assert.equal(citation.page.maximum, 2000);
    assert.equal(citation.span.properties.end.maximum, 5_000_000);
    assert.deepEqual(schema.properties.accelerator.enum, ["gpu", "npu"]);
});

test("OmniTensor supplies the exact worker and D-Bus boundaries the applet calls", (t) => {
    const root = requireService(t);
    if (root === null) {
        return;
    }
    const plugin = fs.readFileSync(
        path.join(root, "src/omnitensor/plugins/document_qa.py"), "utf8",
    );
    const service = fs.readFileSync(path.join(root, "src/omnitensor/service.py"), "utf8");
    assert.match(plugin, /class DocumentQuestionPlugin/u);
    assert.match(plugin, /question_fragment/u);
    assert.match(plugin, /citation source was not retrieved/u);
    for (const method of ["DescribePlugins", "SubmitJob", "GetJobResult", "CancelJob"]) {
        assert.match(service, new RegExp(`def ${method}\\(`, "u"));
    }
});
