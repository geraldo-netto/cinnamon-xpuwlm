"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const TagFixture = require("../helpers/file-auto-tagging-fixture.js");
const Fixture = require("../helpers/file-categorization-fixture.js");
const Categorization = require("../../files/cinnamon-xpuwlm@geraldo-netto/lib/file-categorization.js");

test("metadata, layout GPU, and hybrid candidates share one measured matrix", async () => {
    const report = await Categorization.runCategorizationBenchmark(Fixture.plan(), {
        clock: TagFixture.clock([3, 8, 5, 12, 4, 6]),
    });
    assert.equal(report.taxonomyVersion, 1);
    assert.deepEqual(report.inputs.map((input) => input.families), [
        ["image"], ["document", "text"],
    ]);
    assert.deepEqual(Categorization.recommendCategorizers(report).map((item) => ({
        input: item.inputId, candidate: item.candidateId, kind: item.candidateKind,
    })), [
        {input: "single", candidate: "metadata", kind: "host"},
        {input: "batch", candidate: "layout-vulkan", kind: "gpu"},
    ]);
});
