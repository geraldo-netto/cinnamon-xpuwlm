"use strict";

const I18n = require("./i18n.js");
const RenderHost = require("./menu-render-host.js");

const {_, format, ngettext} = I18n;
const hostOf = RenderHost.renderHostOf;

class EventImportMenuView {
    _renderEventImport(model) {
        if (model === null || model === undefined) {
            return false;
        }
        hostOf(this).headings.section(
            model.title,
            _("Selected files stay private to the isolated workload worker"),
        );
        if (model.message !== "") {
            hostOf(this).body.addChild(hostOf(this).label(
                model.message, "xpuwlm-event-message", true,
            ));
        }
        if (model.progressText !== "") {
            hostOf(this).body.addChild(hostOf(this).label(
                model.progressText, "xpuwlm-event-progress", true,
            ));
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
            hostOf(this).body.addChild(hostOf(this).label(
                model.exportRefusal, "xpuwlm-run-note", true,
            ));
        }
        return true;
    }

    _eventCandidate(candidate) {
        const card = hostOf(this).events.box("xpuwlm-event-card", true);
        const fields = {
            title: hostOf(this).events.entry(
                candidate.title,
                format(_("%s title"), candidate.title),
                `event-title:${candidate.candidateId}`,
            ),
            start: hostOf(this).events.entry(
                candidate.start,
                format(_("%s start"), candidate.title),
                `event-start:${candidate.candidateId}`,
            ),
            end: hostOf(this).events.entry(
                candidate.endText,
                format(_("%s end"), candidate.title),
                `event-end:${candidate.candidateId}`,
            ),
            timezone: hostOf(this).events.entry(
                candidate.timezone,
                format(_("%s timezone"), candidate.title),
                `event-timezone:${candidate.candidateId}`,
            ),
            location: hostOf(this).events.entry(
                candidate.locationText,
                format(_("%s location"), candidate.title),
                `event-location:${candidate.candidateId}`,
            ),
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
                _("Write calendar file"),
                _("Confirm and write a new calendar file"),
                "event-confirm-export",
                hostOf(this).actions.confirmEventExport,
                true,
                true,
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
}

module.exports = {EventImportMenuView};
