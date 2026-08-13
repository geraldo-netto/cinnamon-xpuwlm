"use strict";

const I18n = require("./i18n.js");
const RenderHost = require("./menu-render-host.js");

const {_, format} = I18n;
const hostOf = RenderHost.renderHostOf;

class MediaMenuView {
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
}

module.exports = {MediaMenuView};
