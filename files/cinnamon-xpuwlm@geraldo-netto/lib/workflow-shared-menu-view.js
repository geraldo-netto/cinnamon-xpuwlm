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

class SharedMenuView {
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

module.exports = {SharedMenuView, jobDetail};
