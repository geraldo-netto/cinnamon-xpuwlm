"use strict";

const I18n = require("./i18n.js");
const RenderHost = require("./menu-render-host.js");

const {_, format, ngettext} = I18n;
const hostOf = RenderHost.renderHostOf;

class GenericWorkflowMenuView {
    _renderGenericWorkflowSurface(model) {
        if (model === null || model === undefined) {
            return false;
        }
        hostOf(this).headings.section(model.title, model.description);
        this._renderGenericUnavailable(model.unavailable);
        this._renderGenericConsent(model.consent);
        this._renderGenericProgress(model.progress);
        this._renderGenericWarning(model.warning);
        this._renderGenericResult(model.result, model.reviewOnly);
        this._renderGenericRetention(model.retention);
        this._renderGenericActions(model);
        return true;
    }

    _renderGenericUnavailable(unavailable) {
        if (!unavailable.visible) {
            return false;
        }
        hostOf(this).headings.group(_("Unavailable"), "");
        hostOf(this).body.addChild(hostOf(this).label(
            unavailable.detail || _("Required service, source, or hardware is unavailable"),
            "xpuwlm-run-note",
            true,
        ));
        return true;
    }

    _renderGenericConsent(consent) {
        if (!consent.visible) {
            return false;
        }
        const labels = {
            required: _("Consent required"),
            granted: _("Consent granted"),
            denied: _("Consent denied"),
            "not-required": _("Consent not required"),
        };
        hostOf(this).headings.group(_("Consent"), labels[consent.state]);
        hostOf(this).body.addChild(hostOf(this).label(
            consent.purpose, "xpuwlm-event-evidence", true,
        ));
        return true;
    }

    _renderGenericProgress(progress) {
        if (!progress.visible) {
            return false;
        }
        hostOf(this).headings.group(_("Progress"), progress.text);
        return true;
    }

    _renderGenericWarning(warning) {
        if (warning === "") {
            return false;
        }
        hostOf(this).body.addChild(hostOf(this).label(
            warning, "xpuwlm-control-feedback xpuwlm-control-error", true,
        ));
        return true;
    }

    _renderGenericResult(result, reviewOnly) {
        if (result === null) {
            return false;
        }
        hostOf(this).headings.group(
            reviewOnly ? _("Review result") : _("Result"),
            `${result.kind} · ${result.operationId}`,
        );
        if (reviewOnly) {
            hostOf(this).body.addChild(hostOf(this).label(
                _("Review only: no system action is performed from this result"),
                "xpuwlm-run-note",
                true,
            ));
        }
        for (const row of result.rows) {
            hostOf(this).headings.group(row.title, row.detail);
        }
        if (result.omitted > 0) {
            hostOf(this).body.addChild(hostOf(this).label(format(
                ngettext("%d additional evidence row omitted", "%d additional evidence rows omitted", result.omitted),
                result.omitted,
            ), "xpuwlm-run-note", true));
        }
        return true;
    }

    _renderGenericRetention(retention) {
        const count = format(
            ngettext("%d retained result", "%d retained results", retention.count),
            retention.count,
        );
        hostOf(this).headings.group(_("Retention"), count);
        hostOf(this).body.addChild(hostOf(this).label(
            retention.text, "xpuwlm-event-evidence", true,
        ));
        return true;
    }

    _renderGenericActions(model) {
        const controls = hostOf(this).events.box("xpuwlm-event-controls");
        for (const action of model.actions) {
            const button = hostOf(this).events.action(
                action.label,
                action.label,
                `generic-${model.id}-${action.id}`,
                () => hostOf(this).actions.dispatchGenericWorkflow(model.id, action.id, !action.pressed),
                action.enabled,
                action.id === "run-now" || action.id === "cancel",
            );
            if (action.id === "toggle-background") {
                hostOf(this).events.setAccessibleRole(button, "TOGGLE_BUTTON");
                hostOf(this).events.setAccessibleState(button, "CHECKED", action.pressed);
            }
            controls.add_child(button);
        }
        hostOf(this).body.addChild(controls);
        return true;
    }
}

const GENERIC_RENDERER_NAMES = Object.freeze(
    Object.getOwnPropertyNames(GenericWorkflowMenuView.prototype)
        .filter((name) => name !== "constructor"),
);

function installGenericWorkflowRenderers(prototype) {
    for (const name of GENERIC_RENDERER_NAMES) {
        Object.defineProperty(
            prototype,
            name,
            Object.getOwnPropertyDescriptor(GenericWorkflowMenuView.prototype, name),
        );
    }
    return prototype;
}

module.exports = {
    GENERIC_RENDERER_NAMES,
    GenericWorkflowMenuView,
    installGenericWorkflowRenderers,
};
