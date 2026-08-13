"use strict";

const I18n = require("./i18n.js");
const RenderHost = require("./menu-render-host.js");

const {_, format, ngettext} = I18n;
const hostOf = RenderHost.renderHostOf;

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
        hostOf(this).headings.section(
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
        hostOf(this).headings.section(
            model.title,
            _("Audio becomes timestamped speech; document pages, images, video, and slides add visible text and scenes"),
        );
        this._renderMediaStatus(model);
        if (model.sources.length > 0) {
            hostOf(this).headings.group(_("Selected media"), model.sources[0].name);
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
                hostOf(this).body.addChild(hostOf(this).label(text, style, true));
            }
        }
        if (!model.available && model.phase === "idle") {
            hostOf(this).body.addChild(hostOf(this).label(
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
        hostOf(this).headings.group(
            _("Transcription"),
            `${model.providerId} · ${model.accelerator.toUpperCase()}`,
        );
        if (model.speech.length > 0) {
            hostOf(this).headings.group(
                _("Speech"),
                model.language === "" ? _("Language unknown") : model.language,
            );
            for (const segment of model.speech) {
                hostOf(this).body.addChild(hostOf(this).label(
                    `${segment.timeText} · ${segment.text}`,
                    "xpuwlm-event-evidence",
                    true,
                ));
            }
        }
        for (const visual of model.visuals) {
            hostOf(this).headings.group(visual.timeText, visual.visibleText);
            if (visual.visibleText !== "") {
                hostOf(this).body.addChild(hostOf(this).label(
                    format(_("Visible text: %s"), visual.visibleText),
                    "xpuwlm-event-confirmation",
                    true,
                ));
            }
            hostOf(this).body.addChild(hostOf(this).label(
                visual.description,
                "xpuwlm-event-evidence",
                true,
            ));
        }
        return true;
    }

    _renderMediaActions(model) {
        const controls = hostOf(this).events.box("xpuwlm-event-controls");
        if (["idle", "selected", "complete", "error"].includes(model.phase)) {
            controls.add_child(hostOf(this).events.action(
                _("Choose media"),
                _("Choose one audio, document, image, video, or presentation file"),
                "media-choose", hostOf(this).actions.chooseMediaFile, model.chooserEnabled,
            ));
        }
        if (model.phase === "selected") {
            controls.add_child(hostOf(this).events.action(
                _("Transcribe"), _("Transcribe the explicitly selected media locally"),
                "media-start", hostOf(this).actions.startMediaTranscription,
                model.startEnabled, true,
            ));
        }
        if (model.cancelEnabled) {
            controls.add_child(hostOf(this).events.action(
                _("Cancel"), _("Cancel media transcription"), "media-cancel",
                hostOf(this).actions.cancelMediaTranscription, true,
            ));
        }
        if (model.complete) {
            controls.add_child(hostOf(this).events.action(
                _("Copy transcript"), _("Copy this media transcription"), "media-copy",
                () => hostOf(this).actions.copyReport(model.copyText), true,
            ));
        }
        if (model.complete || model.phase === "error") {
            controls.add_child(hostOf(this).events.action(
                _("Clear"), _("Clear media transcription"), "media-reset",
                hostOf(this).actions.resetMediaTranscription, true,
            ));
        }
        hostOf(this).body.addChild(controls);
        return true;
    }

    _renderFileOrganizerStatus(model) {
        for (const [text, style] of [
            [model.message, "xpuwlm-event-message"],
            [model.progressText, "xpuwlm-event-progress"],
        ]) {
            if (text !== "") {
                hostOf(this).body.addChild(hostOf(this).label(text, style, true));
            }
        }
        if (!model.available && model.phase === "idle") {
            hostOf(this).body.addChild(hostOf(this).label(
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
        hostOf(this).headings.group(_("Selected files for organization"), format(
            ngettext("%d file", "%d files", model.sources.length),
            model.sources.length,
        ));
        for (const source of model.sources) {
            hostOf(this).body.addChild(hostOf(this).label(source.name, "xpuwlm-event-source", true));
        }
        return true;
    }

    _renderFileOrganizerPlan(model) {
        if (!model.complete) {
            return false;
        }
        hostOf(this).headings.group(
            _("Review organization plan"),
            `${model.providerId} · ${model.accelerator.toUpperCase()}`,
        );
        for (const item of model.plan) {
            hostOf(this).headings.group(item.fileName, item.tagsText);
            for (const text of [item.nameText, item.folderText, item.duplicateText, item.reason]) {
                hostOf(this).body.addChild(hostOf(this).label(text, "xpuwlm-event-evidence", true));
            }
            for (const evidence of item.evidence) {
                hostOf(this).body.addChild(hostOf(this).label(evidence.text, "xpuwlm-event-evidence", true));
            }
        }
        return true;
    }

    _renderFileOrganizerActions(model) {
        const controls = hostOf(this).events.box("xpuwlm-event-controls");
        if (["idle", "selected", "complete", "error"].includes(model.phase)) {
            controls.add_child(hostOf(this).events.action(
                _("Choose files"), _("Choose files for a review-only organization plan"),
                "organizer-choose-files", hostOf(this).actions.chooseOrganizerFiles,
                model.chooserEnabled,
            ));
        }
        if (model.phase === "selected") {
            controls.add_child(hostOf(this).events.action(
                _("Create plan"), _("Suggest organization without changing files"),
                "organizer-start", hostOf(this).actions.startFileOrganizer, model.startEnabled, true,
            ));
        }
        if (model.cancelEnabled) {
            controls.add_child(hostOf(this).events.action(
                _("Cancel"), _("Cancel file organization"), "organizer-cancel",
                hostOf(this).actions.cancelFileOrganizer, true,
            ));
        }
        if (model.complete || model.phase === "error") {
            controls.add_child(hostOf(this).events.action(
                _("Clear"), _("Clear the review-only organization plan"), "organizer-reset",
                hostOf(this).actions.resetFileOrganizer, true,
            ));
        }
        hostOf(this).body.addChild(controls);
        return true;
    }

    _renderSelectedText(model) {
        if (model === null || model === undefined) {
            return false;
        }
        hostOf(this).headings.section(
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
                hostOf(this).body.addChild(hostOf(this).label(text, style, true));
            }
        }
        if (!model.available && model.phase === "idle") {
            hostOf(this).body.addChild(hostOf(this).label(
                model.availabilityDetail || _("A qualified selected-text provider is not configured"),
                "xpuwlm-run-note",
                true,
            ));
        }
        return true;
    }

    _renderSelectedTextActions(model) {
        const controls = hostOf(this).events.box("xpuwlm-event-controls");
        if (model.cancelEnabled) {
            controls.add_child(hostOf(this).events.action(
                _("Cancel"), _("Cancel selected-text request"), "selected-text-cancel",
                hostOf(this).actions.cancelSelectedText, true,
            ));
        }
        if (model.complete || model.phase === "error") {
            controls.add_child(hostOf(this).events.action(
                _("Clear"), _("Clear selected-text result"), "selected-text-reset",
                hostOf(this).actions.resetSelectedText, true,
            ));
        }
        hostOf(this).body.addChild(controls);
        return true;
    }

    _renderSelectedTextOperations(model) {
        const controls = hostOf(this).events.box("xpuwlm-event-controls");
        for (const [operation, label] of [
            ["explain", _("Explain")],
            ["summarize", _("Summarize")],
            ["rewrite", _("Rewrite")],
            ["extract-tasks", _("Extract tasks")],
        ]) {
            controls.add_child(hostOf(this).events.action(
                label,
                format(_("%s the explicit clipboard selection"), label),
                `selected-text-${operation}`,
                () => hostOf(this).actions.startSelectedText(operation, null),
                model.operationEnabled,
            ));
        }
        hostOf(this).body.addChild(controls);
        const translation = hostOf(this).events.box("xpuwlm-event-controls");
        const language = hostOf(this).events.entry("", _("Translation target language"), "selected-text-language");
        translation.add_child(language);
        translation.add_child(hostOf(this).events.action(
            _("Translate"), _("Translate the explicit clipboard selection"), "selected-text-translate",
            () => hostOf(this).actions.startSelectedText("translate", language.get_text()),
            model.operationEnabled,
        ));
        hostOf(this).body.addChild(translation);
        return true;
    }

    _renderSelectedTextResult(model) {
        hostOf(this).headings.group(
            _("Review result"),
            `${model.providerId} · ${model.accelerator.toUpperCase()}`,
        );
        hostOf(this).body.addChild(hostOf(this).label(model.result, "xpuwlm-event-confirmation", true));
        if (model.tasks.length > 0) {
            hostOf(this).headings.group(_("Extracted tasks"), format(
                ngettext("%d suggestion", "%d suggestions", model.tasks.length),
                model.tasks.length,
            ));
            for (const task of model.tasks) {
                hostOf(this).body.addChild(hostOf(this).label(task, "xpuwlm-event-evidence", true));
            }
        }
        hostOf(this).body.addChild(hostOf(this).label(model.evidenceText, "xpuwlm-event-evidence", true));
        return true;
    }

    _renderDocumentQuestion(model) {
        if (model === null || model === undefined) {
            return false;
        }
        hostOf(this).headings.section(
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
                hostOf(this).body.addChild(hostOf(this).label(text, style, true));
            }
        }
    }

    _renderDocumentQuestionSources(model) {
        if (model.sources.length === 0) {
            return false;
        }
        hostOf(this).headings.group(_("Selected documents"), format(
            ngettext("%d file", "%d files", model.sources.length),
            model.sources.length,
        ));
        for (const source of model.sources) {
            hostOf(this).body.addChild(hostOf(this).label(source.name, "xpuwlm-event-source", true));
        }
        return true;
    }

    _documentQuestionEntry(model) {
        if (model.phase !== "selected") {
            return null;
        }
        const entry = hostOf(this).events.entry("", _("Question for selected documents"), "document-question-input");
        hostOf(this).body.addChild(entry);
        return entry;
    }

    _renderDocumentQuestionResult(model) {
        if (!model.complete) {
            return false;
        }
        hostOf(this).headings.group(_("Grounded answer"), `${model.providerId} · ${model.accelerator.toUpperCase()}`);
        hostOf(this).body.addChild(hostOf(this).label(model.answer, "xpuwlm-event-confirmation", true));
        for (const citation of model.citations) {
            hostOf(this).body.addChild(hostOf(this).label(citation.text, "xpuwlm-event-evidence", true));
        }
        return true;
    }

    _renderDocumentQuestionActions(model, question) {
        const controls = hostOf(this).events.box("xpuwlm-event-controls");
        if (["idle", "selected", "complete", "error"].includes(model.phase)) {
            controls.add_child(hostOf(this).events.action(
                _("Choose files"), _("Choose documents for one question"), "question-choose-files",
                hostOf(this).actions.chooseQuestionFiles, model.chooserEnabled,
            ));
        }
        if (question !== null) {
            controls.add_child(hostOf(this).events.action(
                _("Ask"), _("Ask the explicit question over selected documents"), "question-start",
                () => hostOf(this).actions.startDocumentQuestion(question.get_text()), model.askEnabled, true,
            ));
        }
        if (model.cancelEnabled) {
            controls.add_child(hostOf(this).events.action(
                _("Cancel"), _("Cancel document question"), "question-cancel",
                hostOf(this).actions.cancelDocumentQuestion, true,
            ));
        }
        if (model.complete) {
            controls.add_child(hostOf(this).events.action(
                _("New question"), _("Clear this answer and start again"), "question-reset",
                hostOf(this).actions.resetDocumentQuestion, true,
            ));
        }
        hostOf(this).body.addChild(controls);
        return true;
    }

    _renderEventImport(model) {
        if (model === null || model === undefined) {
            return false;
        }
        hostOf(this).headings.section(model.title, _("Selected files stay private to the isolated workload worker"));
        if (model.message !== "") {
            hostOf(this).body.addChild(hostOf(this).label(model.message, "xpuwlm-event-message", true));
        }
        if (model.progressText !== "") {
            hostOf(this).body.addChild(hostOf(this).label(model.progressText, "xpuwlm-event-progress", true));
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
                hostOf(this).body.addChild(hostOf(this).label(
                    model.availabilityDetail || _("A qualified event model is not configured"),
                    "xpuwlm-run-note",
                    true,
                ));
            }
            return false;
        }
        hostOf(this).headings.group(_("Selected sources"), format(
            ngettext("%d file", "%d files", model.sources.length),
            model.sources.length,
        ));
        for (const source of model.sources) {
            hostOf(this).body.addChild(hostOf(this).label(source.name, "xpuwlm-event-source", true));
        }
        return true;
    }

    _renderEventPreview(model) {
        hostOf(this).headings.group(_("Evidence-backed preview"), format(
            _("%d kept · %d rejected · %d undecided"),
            model.confirmed,
            model.rejected,
            model.pending,
        ));
        if (model.duplicatesDropped > 0) {
            hostOf(this).body.addChild(hostOf(this).label(format(
                ngettext("%d duplicate removed", "%d duplicates removed", model.duplicatesDropped),
                model.duplicatesDropped,
            ), "xpuwlm-event-dedup", true));
        }
        for (const candidate of model.candidates) {
            hostOf(this).body.addChild(this._eventCandidate(candidate));
        }
        if (model.exportRefusal !== "") {
            hostOf(this).body.addChild(hostOf(this).label(model.exportRefusal, "xpuwlm-run-note", true));
        }
        return true;
    }

    _eventCandidate(candidate) {
        const card = hostOf(this).events.box("xpuwlm-event-card", true);
        const fields = {
            title: hostOf(this).events.entry(candidate.title, format(_("%s title"), candidate.title), `event-title:${candidate.candidateId}`),
            start: hostOf(this).events.entry(candidate.start, format(_("%s start"), candidate.title), `event-start:${candidate.candidateId}`),
            end: hostOf(this).events.entry(candidate.endText, format(_("%s end"), candidate.title), `event-end:${candidate.candidateId}`),
            timezone: hostOf(this).events.entry(candidate.timezone, format(_("%s timezone"), candidate.title), `event-timezone:${candidate.candidateId}`),
            location: hostOf(this).events.entry(candidate.locationText, format(_("%s location"), candidate.title), `event-location:${candidate.candidateId}`),
        };
        const labels = {
            title: _("Title"),
            start: _("Starts"),
            end: _("Ends"),
            timezone: _("Timezone"),
            location: _("Location"),
        };
        for (const [name, entry] of Object.entries(fields)) {
            const field = hostOf(this).events.box("xpuwlm-event-field", true);
            field.add_child(hostOf(this).label(labels[name], "xpuwlm-event-field-label"));
            field.add_child(entry);
            card.add_child(field);
        }
        for (const evidence of candidate.evidenceText) {
            card.add_child(hostOf(this).label(evidence, "xpuwlm-event-evidence", true));
        }
        const controls = hostOf(this).events.box("xpuwlm-event-controls");
        controls.add_child(this._eventEditButton(candidate, fields));
        controls.add_child(this._eventDecisionButton(candidate, "confirmed", _("Keep")));
        controls.add_child(this._eventDecisionButton(candidate, "rejected", _("Reject")));
        card.add_child(controls);
        return card;
    }

    _eventEditButton(candidate, fields) {
        const button = hostOf(this).events.identify(hostOf(this).events.button(
            "xpuwlm-secondary-button",
            format(_("Apply edits to %s"), candidate.title),
            () => hostOf(this).actions.editEventCandidate(candidate.candidateId, {
                title: fields.title.get_text(),
                start: fields.start.get_text(),
                end: fields.end.get_text() === "" ? null : fields.end.get_text(),
                timezone: fields.timezone.get_text(),
                location: fields.location.get_text() === "" ? null : fields.location.get_text(),
            }),
        ), `event-edit:${candidate.candidateId}`);
        button.set_child(hostOf(this).label(_("Apply edits"), "xpuwlm-button-label"));
        return button;
    }

    _eventDecisionButton(candidate, decision, label) {
        const selected = candidate.confirmation === decision;
        const button = hostOf(this).events.identify(hostOf(this).events.button(
            `xpuwlm-event-decision${selected ? " xpuwlm-event-decision-selected" : ""}`,
            format(_("%s %s"), label, candidate.title),
            () => hostOf(this).actions.decideEventCandidate(candidate.candidateId, decision),
            "TOGGLE_BUTTON",
        ), `event-${decision}:${candidate.candidateId}`);
        hostOf(this).events.setAccessibleState(button, "CHECKED", selected);
        button.set_child(hostOf(this).label(label, "xpuwlm-button-label"));
        return button;
    }

    _renderEventConfirmation(model) {
        const confirmed = model.candidates.filter((candidate) => candidate.kept);
        hostOf(this).headings.group(_("Confirm calendar export"), format(
            ngettext("%d event will be written", "%d events will be written", confirmed.length),
            confirmed.length,
        ));
        hostOf(this).body.addChild(hostOf(this).label(
            _("No source file is changed or removed. The chosen output must be a new file."),
            "xpuwlm-event-confirmation",
            true,
        ));
        for (const candidate of confirmed) {
            hostOf(this).body.addChild(hostOf(this).label(
                `${candidate.title} · ${candidate.start}`,
                "xpuwlm-event-confirmed",
                true,
            ));
        }
        return true;
    }

    _renderEventActions(model) {
        const controls = hostOf(this).events.box("xpuwlm-event-controls");
        if (["idle", "selected", "preview", "complete", "error"].includes(model.phase)) {
            controls.add_child(hostOf(this).events.action(
                _("Choose files"), _("Choose event source files"), "event-choose-files",
                hostOf(this).actions.chooseEventFiles, model.chooserEnabled,
            ));
            controls.add_child(hostOf(this).events.action(
                _("Choose folder"), _("Choose one event source folder"), "event-choose-folder",
                hostOf(this).actions.chooseEventFolder, model.chooserEnabled,
            ));
        }
        if (model.phase === "selected") {
            controls.add_child(hostOf(this).events.action(
                _("Extract events"), _("Extract events from selected files"), "event-start",
                hostOf(this).actions.startEventImport, model.startEnabled, true,
            ));
        }
        if (model.cancelEnabled) {
            controls.add_child(hostOf(this).events.action(
                _("Cancel"), _("Cancel event extraction"), "event-cancel",
                hostOf(this).actions.cancelEventImport, true,
            ));
        }
        if (model.phase === "preview") {
            controls.add_child(hostOf(this).events.action(
                _("Review export"), _("Review confirmed events before export"), "event-review-export",
                hostOf(this).actions.beginEventExport, model.exportRefusal === "", true,
            ));
        }
        if (model.phase === "confirm-export") {
            controls.add_child(hostOf(this).events.action(
                _("Write calendar file"), _("Confirm and write a new calendar file"), "event-confirm-export",
                hostOf(this).actions.confirmEventExport, true, true,
            ));
            controls.add_child(hostOf(this).events.action(
                _("Back"), _("Return to event preview"), "event-back-preview",
                hostOf(this).actions.backEventPreview, true,
            ));
        }
        if (model.complete) {
            controls.add_child(hostOf(this).events.action(
                _("New import"), _("Start a new event import"), "event-reset",
                hostOf(this).actions.resetEventImport, true,
            ));
        }
        hostOf(this).body.addChild(controls);
        return true;
    }

    _eventAction(label, accessibleName, identity, action, enabled, primary = false) {
        const button = hostOf(this).events.identify(
            hostOf(this).events.button(
                primary ? "xpuwlm-primary-button" : "xpuwlm-secondary-button",
                accessibleName,
                action,
            ),
            identity,
        );
        button.set_child(hostOf(this).label(label, "xpuwlm-button-label"));
        hostOf(this).events.setButtonEnabled(button, enabled);
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
        hostOf(this).headings.section(run.title, this._runSubtitle(run));
        this._renderJobOutcome(run.job);
        if (run.reason !== "") {
            hostOf(this).body.addChild(hostOf(this).label(run.reason, "xpuwlm-run-note", true));
            return false;
        }
        if (run.omitted > 0) {
            hostOf(this).body.addChild(hostOf(this).label(
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
            hostOf(this).headings.group(profile.title, format(
                ngettext("%d picture", "%d pictures", run.pictures.length),
                run.pictures.length,
            ));
            for (const picture of run.pictures) {
                hostOf(this).body.addChild(this._pictureRow(profile, picture));
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
        const button = hostOf(this).events.identify(
            hostOf(this).events.button(
                "xpuwlm-run-row",
                format(_("Run %s on %s"), profile.title, picture.name),
                () => hostOf(this).actions.submitJob(profile.id, picture),
            ),
            `run:${profile.id}:${picture.name}`,
        );
        button.set_child(hostOf(this).label(picture.name, "xpuwlm-button-label", true));
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
        hostOf(this).body.addChild(hostOf(this).label(
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
            hostOf(this).body.addChild(hostOf(this).label(entry, "xpuwlm-job-reading", true));
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
