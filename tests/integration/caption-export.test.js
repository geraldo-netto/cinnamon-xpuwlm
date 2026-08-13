"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const Fixture = require("../helpers/caption-export-fixture.js");
const Captions = require("../../files/cinnamon-xpuwlm@geraldo-netto/caption-export.js");

test("caption export is an atomic confirmation-gated action request", () => {
    const document = Captions.captionDocument(Fixture.transcription());
    const request = Captions.exportCaptionAction(document, Fixture.exportRequest());
    assert.equal(request.actionId, "export-captions");
    assert.deepEqual(request.targets, ["/tmp/captions.vtt"]);
    assert.equal(request.parameters.atomic, true);
    assert.equal(request.parameters.cleanupPartialOnCancel, true);
    assert.equal(request.parameters.overwrite, false);
    assert.match(request.parameters.content, /^WEBVTT/u);
    assert.deepEqual(request.parameters.measurements, Fixture.measurements());
    assert.equal(Object.isFrozen(request.parameters), true);
});

test("invalid export requests do not reach an action", () => {
    const document = Captions.captionDocument(Fixture.transcription());
    assert.throws(() => Captions.exportCaptionAction(document, {
        ...Fixture.exportRequest(), destination: "/tmp/../captions.vtt",
    }), (error) => error.code === "export-invalid");
});
