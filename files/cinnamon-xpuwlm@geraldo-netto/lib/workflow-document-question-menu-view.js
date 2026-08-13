"use strict";

const I18n = require("./i18n.js");
const RenderHost = require("./menu-render-host.js");

const {_, format, ngettext} = I18n;
const hostOf = RenderHost.renderHostOf;

class DocumentQuestionMenuView {
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
        const entry = hostOf(this).events.entry(
            "", _("Question for selected documents"), "document-question-input",
        );
        hostOf(this).body.addChild(entry);
        return entry;
    }

    _renderDocumentQuestionResult(model) {
        if (!model.complete) {
            return false;
        }
        hostOf(this).headings.group(
            _("Grounded answer"),
            `${model.providerId} · ${model.accelerator.toUpperCase()}`,
        );
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
}

module.exports = {DocumentQuestionMenuView};
