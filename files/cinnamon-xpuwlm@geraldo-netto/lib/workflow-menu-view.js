"use strict";

const I18n = require("./i18n.js");

const {_, format, ngettext} = I18n;

// Everything known about one job, in the order it becomes known: what the
// runtime said, then what became of it, then how far along it is. Each part is
// omitted when it is not known rather than printed empty.
function jobDetail(job) {
    return [job.message, job.stateText, job.progressText, job.jobId]
        .filter((part) => typeof part === "string" && part !== "")
        .join(" · ");
}

// Methods execute on MenuView instances after installation. This keeps
// Cinnamon actor construction behind MenuView's narrow host contract while
// workflow-specific layout and action knowledge stays in its own context.
class WorkflowMenuView {
    _renderFileOrganizer(model) {
        if (model === null || model === undefined) {
            return false;
        }
        this._addSectionHeading(
            model.title,
            _("Suggestions only: this applet never moves, renames, overwrites, or deletes files"),
        );
        this._renderFileOrganizerStatus(model);
        this._renderFileOrganizerSources(model);
        this._renderFileOrganizerPlan(model);
        this._renderFileOrganizerActions(model);
        return true;
    }

    _renderMediaTranscription(model) {
        if (model === null || model === undefined) {
            return false;
        }
        this._addSectionHeading(
            model.title,
            _("Audio becomes timestamped speech; document pages, images, video, and slides add visible text and scenes"),
        );
        this._renderMediaStatus(model);
        if (model.sources.length > 0) {
            this._addGroupHeading(_("Selected media"), model.sources[0].name);
        }
        this._renderMediaResult(model);
        this._renderMediaActions(model);
        return true;
    }

    _renderMediaStatus(model) {
        for (const [text, style] of [
            [model.message, "xpuwlm-event-message"],
            [model.progressText, "xpuwlm-event-progress"],
        ]) {
            if (text !== "") {
                this._body.add_child(this._label(text, style, true));
            }
        }
        if (!model.available && model.phase === "idle") {
            this._body.add_child(this._label(
                model.availabilityDetail
                    || _("A hardware-qualified media transcription provider is not configured"),
                "xpuwlm-run-note",
                true,
            ));
        }
        return true;
    }

    _renderMediaResult(model) {
        if (!model.complete) {
            return false;
        }
        this._addGroupHeading(
            _("Transcription"),
            `${model.providerId} · ${model.accelerator.toUpperCase()}`,
        );
        if (model.speech.length > 0) {
            this._addGroupHeading(
                _("Speech"),
                model.language === "" ? _("Language unknown") : model.language,
            );
            for (const segment of model.speech) {
                this._body.add_child(this._label(
                    `${segment.timeText} · ${segment.text}`,
                    "xpuwlm-event-evidence",
                    true,
                ));
            }
        }
        for (const visual of model.visuals) {
            this._addGroupHeading(visual.timeText, visual.visibleText);
            if (visual.visibleText !== "") {
                this._body.add_child(this._label(
                    format(_("Visible text: %s"), visual.visibleText),
                    "xpuwlm-event-confirmation",
                    true,
                ));
            }
            this._body.add_child(this._label(
                visual.description,
                "xpuwlm-event-evidence",
                true,
            ));
        }
        return true;
    }

    _renderMediaActions(model) {
        const controls = this._box("xpuwlm-event-controls");
        if (["idle", "selected", "complete", "error"].includes(model.phase)) {
            controls.add_child(this._eventAction(
                _("Choose media"),
                _("Choose one audio, document, image, video, or presentation file"),
                "media-choose", this._actions.chooseMediaFile, model.chooserEnabled,
            ));
        }
        if (model.phase === "selected") {
            controls.add_child(this._eventAction(
                _("Transcribe"), _("Transcribe the explicitly selected media locally"),
                "media-start", this._actions.startMediaTranscription,
                model.startEnabled, true,
            ));
        }
        if (model.cancelEnabled) {
            controls.add_child(this._eventAction(
                _("Cancel"), _("Cancel media transcription"), "media-cancel",
                this._actions.cancelMediaTranscription, true,
            ));
        }
        if (model.complete) {
            controls.add_child(this._eventAction(
                _("Copy transcript"), _("Copy this media transcription"), "media-copy",
                () => this._actions.copyReport(model.copyText), true,
            ));
        }
        if (model.complete || model.phase === "error") {
            controls.add_child(this._eventAction(
                _("Clear"), _("Clear media transcription"), "media-reset",
                this._actions.resetMediaTranscription, true,
            ));
        }
        this._body.add_child(controls);
        return true;
    }

    _renderFileOrganizerStatus(model) {
        for (const [text, style] of [
            [model.message, "xpuwlm-event-message"],
            [model.progressText, "xpuwlm-event-progress"],
        ]) {
            if (text !== "") {
                this._body.add_child(this._label(text, style, true));
            }
        }
        if (!model.available && model.phase === "idle") {
            this._body.add_child(this._label(
                model.availabilityDetail || _("A qualified file-organizer provider is not configured"),
                "xpuwlm-run-note",
                true,
            ));
        }
        return true;
    }

    _renderFileOrganizerSources(model) {
        if (model.sources.length === 0) {
            return false;
        }
        this._addGroupHeading(_("Selected files for organization"), format(
            ngettext("%d file", "%d files", model.sources.length),
            model.sources.length,
        ));
        for (const source of model.sources) {
            this._body.add_child(this._label(source.name, "xpuwlm-event-source", true));
        }
        return true;
    }

    _renderFileOrganizerPlan(model) {
        if (!model.complete) {
            return false;
        }
        this._addGroupHeading(
            _("Review organization plan"),
            `${model.providerId} · ${model.accelerator.toUpperCase()}`,
        );
        for (const item of model.plan) {
            this._addGroupHeading(item.fileName, item.tagsText);
            for (const text of [item.nameText, item.folderText, item.duplicateText, item.reason]) {
                this._body.add_child(this._label(text, "xpuwlm-event-evidence", true));
            }
            for (const evidence of item.evidence) {
                this._body.add_child(this._label(evidence.text, "xpuwlm-event-evidence", true));
            }
        }
        return true;
    }

    _renderFileOrganizerActions(model) {
        const controls = this._box("xpuwlm-event-controls");
        if (["idle", "selected", "complete", "error"].includes(model.phase)) {
            controls.add_child(this._eventAction(
                _("Choose files"), _("Choose files for a review-only organization plan"),
                "organizer-choose-files", this._actions.chooseOrganizerFiles,
                model.chooserEnabled,
            ));
        }
        if (model.phase === "selected") {
            controls.add_child(this._eventAction(
                _("Create plan"), _("Suggest organization without changing files"),
                "organizer-start", this._actions.startFileOrganizer, model.startEnabled, true,
            ));
        }
        if (model.cancelEnabled) {
            controls.add_child(this._eventAction(
                _("Cancel"), _("Cancel file organization"), "organizer-cancel",
                this._actions.cancelFileOrganizer, true,
            ));
        }
        if (model.complete || model.phase === "error") {
            controls.add_child(this._eventAction(
                _("Clear"), _("Clear the review-only organization plan"), "organizer-reset",
                this._actions.resetFileOrganizer, true,
            ));
        }
        this._body.add_child(controls);
        return true;
    }

    _renderSelectedText(model) {
        if (model === null || model === undefined) {
            return false;
        }
        this._addSectionHeading(
            model.title,
            _("Reads the clipboard once only after an operation is chosen"),
        );
        this._renderSelectedTextStatus(model);
        if (model.operationEnabled) {
            this._renderSelectedTextOperations(model);
        }
        if (model.complete) {
            this._renderSelectedTextResult(model);
        }
        this._renderSelectedTextActions(model);
        return true;
    }

    _renderSelectedTextStatus(model) {
        for (const [text, style] of [
            [model.message, "xpuwlm-event-message"],
            [model.progressText, "xpuwlm-event-progress"],
        ]) {
            if (text !== "") {
                this._body.add_child(this._label(text, style, true));
            }
        }
        if (!model.available && model.phase === "idle") {
            this._body.add_child(this._label(
                model.availabilityDetail || _("A qualified selected-text provider is not configured"),
                "xpuwlm-run-note",
                true,
            ));
        }
        return true;
    }

    _renderSelectedTextActions(model) {
        const controls = this._box("xpuwlm-event-controls");
        if (model.cancelEnabled) {
            controls.add_child(this._eventAction(
                _("Cancel"), _("Cancel selected-text request"), "selected-text-cancel",
                this._actions.cancelSelectedText, true,
            ));
        }
        if (model.complete || model.phase === "error") {
            controls.add_child(this._eventAction(
                _("Clear"), _("Clear selected-text result"), "selected-text-reset",
                this._actions.resetSelectedText, true,
            ));
        }
        this._body.add_child(controls);
        return true;
    }

    _renderSelectedTextOperations(model) {
        const controls = this._box("xpuwlm-event-controls");
        for (const [operation, label] of [
            ["explain", _("Explain")],
            ["summarize", _("Summarize")],
            ["rewrite", _("Rewrite")],
            ["extract-tasks", _("Extract tasks")],
        ]) {
            controls.add_child(this._eventAction(
                label,
                format(_("%s the explicit clipboard selection"), label),
                `selected-text-${operation}`,
                () => this._actions.startSelectedText(operation, null),
                model.operationEnabled,
            ));
        }
        this._body.add_child(controls);
        const translation = this._box("xpuwlm-event-controls");
        const language = this._entry("", _("Translation target language"), "selected-text-language");
        translation.add_child(language);
        translation.add_child(this._eventAction(
            _("Translate"), _("Translate the explicit clipboard selection"), "selected-text-translate",
            () => this._actions.startSelectedText("translate", language.get_text()),
            model.operationEnabled,
        ));
        this._body.add_child(translation);
        return true;
    }

    _renderSelectedTextResult(model) {
        this._addGroupHeading(
            _("Review result"),
            `${model.providerId} · ${model.accelerator.toUpperCase()}`,
        );
        this._body.add_child(this._label(model.result, "xpuwlm-event-confirmation", true));
        if (model.tasks.length > 0) {
            this._addGroupHeading(_("Extracted tasks"), format(
                ngettext("%d suggestion", "%d suggestions", model.tasks.length),
                model.tasks.length,
            ));
            for (const task of model.tasks) {
                this._body.add_child(this._label(task, "xpuwlm-event-evidence", true));
            }
        }
        this._body.add_child(this._label(model.evidenceText, "xpuwlm-event-evidence", true));
        return true;
    }

    _renderDocumentQuestion(model) {
        if (model === null || model === undefined) {
            return false;
        }
        this._addSectionHeading(
            model.title,
            _("Only chosen files and this one question reach the isolated workers"),
        );
        this._renderDocumentQuestionStatus(model);
        this._renderDocumentQuestionSources(model);
        const question = this._documentQuestionEntry(model);
        this._renderDocumentQuestionResult(model);
        this._renderDocumentQuestionActions(model, question);
        return true;
    }

    _renderDocumentQuestionStatus(model) {
        for (const [text, style] of [
            [model.message, "xpuwlm-event-message"],
            [model.progressText, "xpuwlm-event-progress"],
        ]) {
            if (text !== "") {
                this._body.add_child(this._label(text, style, true));
            }
        }
    }

    _renderDocumentQuestionSources(model) {
        if (model.sources.length === 0) {
            return false;
        }
        this._addGroupHeading(_("Selected documents"), format(
            ngettext("%d file", "%d files", model.sources.length),
            model.sources.length,
        ));
        for (const source of model.sources) {
            this._body.add_child(this._label(source.name, "xpuwlm-event-source", true));
        }
        return true;
    }

    _documentQuestionEntry(model) {
        if (model.phase !== "selected") {
            return null;
        }
        const entry = this._entry("", _("Question for selected documents"), "document-question-input");
        this._body.add_child(entry);
        return entry;
    }

    _renderDocumentQuestionResult(model) {
        if (!model.complete) {
            return false;
        }
        this._addGroupHeading(_("Grounded answer"), `${model.providerId} · ${model.accelerator.toUpperCase()}`);
        this._body.add_child(this._label(model.answer, "xpuwlm-event-confirmation", true));
        for (const citation of model.citations) {
            this._body.add_child(this._label(citation.text, "xpuwlm-event-evidence", true));
        }
        return true;
    }

    _renderDocumentQuestionActions(model, question) {
        const controls = this._box("xpuwlm-event-controls");
        if (["idle", "selected", "complete", "error"].includes(model.phase)) {
            controls.add_child(this._eventAction(
                _("Choose files"), _("Choose documents for one question"), "question-choose-files",
                this._actions.chooseQuestionFiles, model.chooserEnabled,
            ));
        }
        if (question !== null) {
            controls.add_child(this._eventAction(
                _("Ask"), _("Ask the explicit question over selected documents"), "question-start",
                () => this._actions.startDocumentQuestion(question.get_text()), model.askEnabled, true,
            ));
        }
        if (model.cancelEnabled) {
            controls.add_child(this._eventAction(
                _("Cancel"), _("Cancel document question"), "question-cancel",
                this._actions.cancelDocumentQuestion, true,
            ));
        }
        if (model.complete) {
            controls.add_child(this._eventAction(
                _("New question"), _("Clear this answer and start again"), "question-reset",
                this._actions.resetDocumentQuestion, true,
            ));
        }
        this._body.add_child(controls);
        return true;
    }

    _renderEventImport(model) {
        if (model === null || model === undefined) {
            return false;
        }
        this._addSectionHeading(model.title, _("Selected files stay private to the isolated workload worker"));
        if (model.message !== "") {
            this._body.add_child(this._label(model.message, "xpuwlm-event-message", true));
        }
        if (model.progressText !== "") {
            this._body.add_child(this._label(model.progressText, "xpuwlm-event-progress", true));
        }
        this._renderEventSources(model);
        if (model.preview) {
            this._renderEventPreview(model);
        } else if (model.confirmation) {
            this._renderEventConfirmation(model);
        }
        this._renderEventActions(model);
        return true;
    }

    _renderEventSources(model) {
        if (model.sources.length === 0) {
            if (!model.available) {
                this._body.add_child(this._label(
                    model.availabilityDetail || _("A qualified event model is not configured"),
                    "xpuwlm-run-note",
                    true,
                ));
            }
            return false;
        }
        this._addGroupHeading(_("Selected sources"), format(
            ngettext("%d file", "%d files", model.sources.length),
            model.sources.length,
        ));
        for (const source of model.sources) {
            this._body.add_child(this._label(source.name, "xpuwlm-event-source", true));
        }
        return true;
    }

    _renderEventPreview(model) {
        this._addGroupHeading(_("Evidence-backed preview"), format(
            _("%d kept · %d rejected · %d undecided"),
            model.confirmed,
            model.rejected,
            model.pending,
        ));
        if (model.duplicatesDropped > 0) {
            this._body.add_child(this._label(format(
                ngettext("%d duplicate removed", "%d duplicates removed", model.duplicatesDropped),
                model.duplicatesDropped,
            ), "xpuwlm-event-dedup", true));
        }
        for (const candidate of model.candidates) {
            this._body.add_child(this._eventCandidate(candidate));
        }
        if (model.exportRefusal !== "") {
            this._body.add_child(this._label(model.exportRefusal, "xpuwlm-run-note", true));
        }
        return true;
    }

    _eventCandidate(candidate) {
        const card = this._box("xpuwlm-event-card", true);
        const fields = {
            title: this._entry(candidate.title, format(_("%s title"), candidate.title), `event-title:${candidate.candidateId}`),
            start: this._entry(candidate.start, format(_("%s start"), candidate.title), `event-start:${candidate.candidateId}`),
            end: this._entry(candidate.endText, format(_("%s end"), candidate.title), `event-end:${candidate.candidateId}`),
            timezone: this._entry(candidate.timezone, format(_("%s timezone"), candidate.title), `event-timezone:${candidate.candidateId}`),
            location: this._entry(candidate.locationText, format(_("%s location"), candidate.title), `event-location:${candidate.candidateId}`),
        };
        const labels = {
            title: _("Title"),
            start: _("Starts"),
            end: _("Ends"),
            timezone: _("Timezone"),
            location: _("Location"),
        };
        for (const [name, entry] of Object.entries(fields)) {
            const field = this._box("xpuwlm-event-field", true);
            field.add_child(this._label(labels[name], "xpuwlm-event-field-label"));
            field.add_child(entry);
            card.add_child(field);
        }
        for (const evidence of candidate.evidenceText) {
            card.add_child(this._label(evidence, "xpuwlm-event-evidence", true));
        }
        const controls = this._box("xpuwlm-event-controls");
        controls.add_child(this._eventEditButton(candidate, fields));
        controls.add_child(this._eventDecisionButton(candidate, "confirmed", _("Keep")));
        controls.add_child(this._eventDecisionButton(candidate, "rejected", _("Reject")));
        card.add_child(controls);
        return card;
    }

    _eventEditButton(candidate, fields) {
        const button = this._identify(this._button(
            "xpuwlm-secondary-button",
            format(_("Apply edits to %s"), candidate.title),
            () => this._actions.editEventCandidate(candidate.candidateId, {
                title: fields.title.get_text(),
                start: fields.start.get_text(),
                end: fields.end.get_text() === "" ? null : fields.end.get_text(),
                timezone: fields.timezone.get_text(),
                location: fields.location.get_text() === "" ? null : fields.location.get_text(),
            }),
        ), `event-edit:${candidate.candidateId}`);
        button.set_child(this._label(_("Apply edits"), "xpuwlm-button-label"));
        return button;
    }

    _eventDecisionButton(candidate, decision, label) {
        const selected = candidate.confirmation === decision;
        const button = this._identify(this._button(
            `xpuwlm-event-decision${selected ? " xpuwlm-event-decision-selected" : ""}`,
            format(_("%s %s"), label, candidate.title),
            () => this._actions.decideEventCandidate(candidate.candidateId, decision),
            "TOGGLE_BUTTON",
        ), `event-${decision}:${candidate.candidateId}`);
        this._setAccessibleState(button, "CHECKED", selected);
        button.set_child(this._label(label, "xpuwlm-button-label"));
        return button;
    }

    _renderEventConfirmation(model) {
        const confirmed = model.candidates.filter((candidate) => candidate.kept);
        this._addGroupHeading(_("Confirm calendar export"), format(
            ngettext("%d event will be written", "%d events will be written", confirmed.length),
            confirmed.length,
        ));
        this._body.add_child(this._label(
            _("No source file is changed or removed. The chosen output must be a new file."),
            "xpuwlm-event-confirmation",
            true,
        ));
        for (const candidate of confirmed) {
            this._body.add_child(this._label(
                `${candidate.title} · ${candidate.start}`,
                "xpuwlm-event-confirmed",
                true,
            ));
        }
        return true;
    }

    _renderEventActions(model) {
        const controls = this._box("xpuwlm-event-controls");
        if (["idle", "selected", "preview", "complete", "error"].includes(model.phase)) {
            controls.add_child(this._eventAction(
                _("Choose files"), _("Choose event source files"), "event-choose-files",
                this._actions.chooseEventFiles, model.chooserEnabled,
            ));
            controls.add_child(this._eventAction(
                _("Choose folder"), _("Choose one event source folder"), "event-choose-folder",
                this._actions.chooseEventFolder, model.chooserEnabled,
            ));
        }
        if (model.phase === "selected") {
            controls.add_child(this._eventAction(
                _("Extract events"), _("Extract events from selected files"), "event-start",
                this._actions.startEventImport, model.startEnabled, true,
            ));
        }
        if (model.cancelEnabled) {
            controls.add_child(this._eventAction(
                _("Cancel"), _("Cancel event extraction"), "event-cancel",
                this._actions.cancelEventImport, true,
            ));
        }
        if (model.phase === "preview") {
            controls.add_child(this._eventAction(
                _("Review export"), _("Review confirmed events before export"), "event-review-export",
                this._actions.beginEventExport, model.exportRefusal === "", true,
            ));
        }
        if (model.phase === "confirm-export") {
            controls.add_child(this._eventAction(
                _("Write calendar file"), _("Confirm and write a new calendar file"), "event-confirm-export",
                this._actions.confirmEventExport, true, true,
            ));
            controls.add_child(this._eventAction(
                _("Back"), _("Return to event preview"), "event-back-preview",
                this._actions.backEventPreview, true,
            ));
        }
        if (model.complete) {
            controls.add_child(this._eventAction(
                _("New import"), _("Start a new event import"), "event-reset",
                this._actions.resetEventImport, true,
            ));
        }
        this._body.add_child(controls);
        return true;
    }

    _eventAction(label, accessibleName, identity, action, enabled, primary = false) {
        const button = this._identify(
            this._button(
                primary ? "xpuwlm-primary-button" : "xpuwlm-secondary-button",
                accessibleName,
                action,
            ),
            identity,
        );
        button.set_child(this._label(label, "xpuwlm-button-label"));
        this._setButtonEnabled(button, enabled);
        return button;
    }

    // The runtime's input root is both the permission boundary and the way in:
    // a picture inside it is one the service will read, and a picture anywhere
    // else is one it refuses. So the root is the list, and there is no file
    // chooser to reconcile with a directory the service was never told about.
    _renderRun(run) {
        if (!run) {
            return false;
        }
        this._addSectionHeading(run.title, this._runSubtitle(run));
        this._renderJobOutcome(run.job);
        if (run.reason !== "") {
            this._body.add_child(this._label(run.reason, "xpuwlm-run-note", true));
            return false;
        }
        if (run.omitted > 0) {
            this._body.add_child(this._label(
                format(ngettext(
                    "%d more picture is not shown",
                    "%d more pictures are not shown",
                    run.omitted,
                ), run.omitted),
                "xpuwlm-run-note",
                true,
            ));
        }
        for (const profile of run.profiles) {
            this._addGroupHeading(profile.title, format(
                ngettext("%d picture", "%d pictures", run.pictures.length),
                run.pictures.length,
            ));
            for (const picture of run.pictures) {
                this._body.add_child(this._pictureRow(profile, picture));
            }
        }
        return true;
    }

    _runSubtitle(run) {
        return run.roots.length === 0
            ? _("No input directory")
            : run.roots.join(" · ");
    }

    _pictureRow(profile, picture) {
        const button = this._identify(
            this._button(
                "xpuwlm-run-row",
                format(_("Run %s on %s"), profile.title, picture.name),
                () => this._actions.submitJob(profile.id, picture),
            ),
            `run:${profile.id}:${picture.name}`,
        );
        button.set_child(this._label(picture.name, "xpuwlm-button-label", true));
        return button;
    }

    // One line, and it says which picture and which profile: a bare "accepted"
    // beside a list of pictures does not say which of them was accepted. The
    // state comes second because it is the part that changes — accepted is a
    // receipt, and only a terminal state is an outcome.
    _renderJobOutcome(job) {
        if (job === null || job === undefined) {
            return false;
        }
        this._body.add_child(this._label(
            `${job.title} · ${job.sourceName} — ${jobDetail(job)}`,
            `xpuwlm-job-outcome xpuwlm-job-${job.tone}`,
            true,
        ));
        this._renderReading(job.reading);
        return true;
    }

    // The answer the job was run for. Rendered as its own rows rather than
    // folded into the outcome line, because a list of candidates read as one
    // run-on sentence is a list nobody reads.
    _renderReading(reading) {
        if (reading === null || reading === undefined) {
            return false;
        }
        for (const entry of reading.entries) {
            this._body.add_child(this._label(entry, "xpuwlm-job-reading", true));
        }
        return true;
    }

}

const WORKFLOW_RENDERER_NAMES = Object.freeze(
    Object.getOwnPropertyNames(WorkflowMenuView.prototype)
        .filter((name) => name !== "constructor"),
);

function installWorkflowRenderers(prototype) {
    for (const name of WORKFLOW_RENDERER_NAMES) {
        Object.defineProperty(
            prototype,
            name,
            Object.getOwnPropertyDescriptor(WorkflowMenuView.prototype, name),
        );
    }
    return prototype;
}

module.exports = {
    WORKFLOW_RENDERER_NAMES,
    WorkflowMenuView,
    installWorkflowRenderers,
    jobDetail,
};
