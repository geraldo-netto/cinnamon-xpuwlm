"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const Wiring = require("../../files/cinnamon-xpuwlm@geraldo-netto/lib/workflow-wiring.js");
const WiringFacade = require("../../files/cinnamon-xpuwlm@geraldo-netto/workflow-wiring.js");

const APPLET_PATH = path.join(
    __dirname,
    "../../files/cinnamon-xpuwlm@geraldo-netto/applet.js",
);

test("workflow controller construction stays outside the applet lifecycle", () => {
    const source = fs.readFileSync(APPLET_PATH, "utf8");
    assert.match(source, /WorkflowWiring\.createWorkflowControllers\(\{/u);
    for (const method of [
        "_createEventImportController",
        "_createDocumentQuestionController",
        "_createSelectedTextController",
        "_createFileOrganizerController",
        "_createMediaTranscriptionController",
    ]) {
        assert.equal(source.includes(`${method}(`), false, `${method} leaked into applet.js`);
    }
    assert.strictEqual(WiringFacade, Wiring);
});

test("workflow controller overrides preserve their exact identities", () => {
    const overrides = {
        eventImportController: {id: "event"},
        documentQuestionController: {id: "document"},
        selectedTextController: {id: "text"},
        fileOrganizerController: {id: "organizer"},
        mediaTranscriptionController: {id: "media"},
    };
    const controllers = Wiring.createWorkflowControllers({
        environment: null,
        chooserLifecycle: null,
        scheduler: null,
        clock: null,
        overrides,
    });
    assert.strictEqual(controllers.eventImport, overrides.eventImportController);
    assert.strictEqual(controllers.documentQuestion, overrides.documentQuestionController);
    assert.strictEqual(controllers.selectedText, overrides.selectedTextController);
    assert.strictEqual(controllers.fileOrganizer, overrides.fileOrganizerController);
    assert.strictEqual(controllers.mediaTranscription, overrides.mediaTranscriptionController);
});
