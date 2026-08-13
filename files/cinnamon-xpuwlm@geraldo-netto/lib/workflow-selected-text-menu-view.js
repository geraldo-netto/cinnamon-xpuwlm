"use strict";

const I18n = require("./i18n.js");
const RenderHost = require("./menu-render-host.js");

const {_, format, ngettext} = I18n;
const hostOf = RenderHost.renderHostOf;

class SelectedTextMenuView {
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
        const language = hostOf(this).events.entry(
            "", _("Translation target language"), "selected-text-language",
        );
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
        hostOf(this).body.addChild(hostOf(this).label(
            model.evidenceText, "xpuwlm-event-evidence", true,
        ));
        return true;
    }
}

module.exports = {SelectedTextMenuView};
