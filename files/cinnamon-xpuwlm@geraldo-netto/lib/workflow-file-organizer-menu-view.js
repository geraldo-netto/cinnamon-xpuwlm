"use strict";

const I18n = require("./i18n.js");
const RenderHost = require("./menu-render-host.js");

const {_, format, ngettext} = I18n;
const hostOf = RenderHost.renderHostOf;

class FileOrganizerMenuView {
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
}

module.exports = {FileOrganizerMenuView};
